import json
import re
import sys
import tempfile
from collections import defaultdict, deque
from collections.abc import Mapping
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field

from flowent.llm import (
    ChatMessage,
    CompletionCallable,
    ProviderConnection,
    complete_chat,
)
from flowent.sandbox import SandboxRunner
from flowent.storage import (
    StoredWorkflow,
    StoredWorkflowDefinition,
    StoredWorkflowEdge,
    StoredWorkflowNode,
)


class WorkflowNodeRunResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    error: str = ""
    id: str
    output: str = ""
    status: str


class WorkflowRunResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    node_results: list[WorkflowNodeRunResult] = Field(default_factory=list)
    outputs: dict[str, str] = Field(default_factory=dict)
    status: str
    workflow_id: str


PLACEHOLDER_PATTERN = re.compile(r"\{\{\s*([A-Za-z0-9_.-]+)\.output\s*\}\}")
PYTHON_CODE_RUNNER = r"""
import contextlib
import io
import json
import sys

payload = json.loads(sys.stdin.read() or "{}")
namespace = {
    "input": payload.get("input", ""),
    "inputs": payload.get("inputs", []),
    "output": "",
}
stdout = io.StringIO()
with contextlib.redirect_stdout(stdout):
    exec(str(payload.get("code", "")), namespace)
captured = stdout.getvalue()
result = namespace.get("output")
if result is None:
    result = ""
if result == "" and captured:
    result = captured.rstrip("\n")
if not isinstance(result, str):
    result = json.dumps(result, ensure_ascii=False)
print(result, end="")
"""


def validate_workflow(workflow: StoredWorkflow) -> StoredWorkflow:
    validate_workflow_definition(workflow.definition)
    return workflow


def validate_workflow_draft(workflow: StoredWorkflow) -> StoredWorkflow:
    validate_workflow_draft_definition(workflow.definition)
    return workflow


def validate_workflow_draft_definition(definition: StoredWorkflowDefinition) -> None:
    node_ids = [node.id for node in definition.nodes]
    if any(not node_id.strip() for node_id in node_ids):
        raise ValueError("Workflow node ids must not be empty.")
    if len(set(node_ids)) != len(node_ids):
        raise ValueError("Workflow node ids must be unique.")

    edge_ids = [edge.id for edge in definition.edges]
    if any(not edge_id.strip() for edge_id in edge_ids):
        raise ValueError("Workflow edge ids must not be empty.")
    if len(set(edge_ids)) != len(edge_ids):
        raise ValueError("Workflow edge ids must be unique.")

    node_id_set = set(node_ids)
    for edge in definition.edges:
        if edge.source not in node_id_set or edge.target not in node_id_set:
            raise ValueError("Workflow edges must connect existing nodes.")


def validate_workflow_definition(definition: StoredWorkflowDefinition) -> list[str]:
    node_ids = [node.id for node in definition.nodes]
    if not node_ids:
        raise ValueError("Workflow needs at least one node.")
    if any(not node_id.strip() for node_id in node_ids):
        raise ValueError("Workflow node ids must not be empty.")
    if len(set(node_ids)) != len(node_ids):
        raise ValueError("Workflow node ids must be unique.")
    if not any(node.type == "input" for node in definition.nodes):
        raise ValueError("Workflow needs an input node.")
    if not any(node.type == "output" for node in definition.nodes):
        raise ValueError("Workflow needs an output node.")

    edge_ids = [edge.id for edge in definition.edges]
    if any(not edge_id.strip() for edge_id in edge_ids):
        raise ValueError("Workflow edge ids must not be empty.")
    if len(set(edge_ids)) != len(edge_ids):
        raise ValueError("Workflow edge ids must be unique.")

    node_id_set = set(node_ids)
    for edge in definition.edges:
        if edge.source not in node_id_set or edge.target not in node_id_set:
            raise ValueError("Workflow edges must connect existing nodes.")

    return topological_node_ids(definition)


def workflow_requires_connection(definition: StoredWorkflowDefinition) -> bool:
    return any(node.type == "agent" for node in definition.nodes)


def topological_node_ids(definition: StoredWorkflowDefinition) -> list[str]:
    node_ids = [node.id for node in definition.nodes]
    outgoing: dict[str, list[str]] = defaultdict(list)
    indegree = {node_id: 0 for node_id in node_ids}
    for edge in definition.edges:
        outgoing[edge.source].append(edge.target)
        indegree[edge.target] += 1

    node_order = {node_id: index for index, node_id in enumerate(node_ids)}
    ready = deque(
        sorted(
            [node_id for node_id, degree in indegree.items() if degree == 0],
            key=lambda node_id: node_order[node_id],
        )
    )
    ordered: list[str] = []
    while ready:
        node_id = ready.popleft()
        ordered.append(node_id)
        for target in sorted(
            outgoing[node_id], key=lambda node_id: node_order[node_id]
        ):
            indegree[target] -= 1
            if indegree[target] == 0:
                ready.append(target)

    if len(ordered) != len(node_ids):
        raise ValueError("Workflow cannot contain cycles.")
    return ordered


async def run_workflow_definition(
    *,
    completion: CompletionCallable | None,
    connection: ProviderConnection | None,
    definition: StoredWorkflowDefinition,
    workflow_id: str,
) -> WorkflowRunResponse:
    ordered_ids = validate_workflow_definition(definition)
    if workflow_requires_connection(definition) and connection is None:
        raise ValueError("Choose a provider and model before running.")

    nodes = {node.id: node for node in definition.nodes}
    incoming_edges = edges_by_target(definition.edges)
    results: dict[str, WorkflowNodeRunResult] = {
        node.id: WorkflowNodeRunResult(id=node.id, status="pending")
        for node in definition.nodes
    }
    outputs: dict[str, str] = {}
    named_outputs: dict[str, str] = {}

    for node_id in ordered_ids:
        node = nodes[node_id]
        results[node.id] = WorkflowNodeRunResult(id=node.id, status="running")
        try:
            output = await run_node(
                completion=completion,
                connection=connection,
                incoming_edges=incoming_edges[node.id],
                node=node,
                outputs=outputs,
            )
        except Exception as error:
            results[node.id] = WorkflowNodeRunResult(
                error=str(error) or "Node could not be completed.",
                id=node.id,
                status="failed",
            )
            return WorkflowRunResponse(
                node_results=list(results.values()),
                outputs=named_outputs,
                status="failed",
                workflow_id=workflow_id,
            )
        outputs[node.id] = output
        if node.type == "output":
            named_outputs[node_output_key(node)] = output
        results[node.id] = WorkflowNodeRunResult(
            id=node.id,
            output=output,
            status="success",
        )

    return WorkflowRunResponse(
        node_results=list(results.values()),
        outputs=named_outputs,
        status="success",
        workflow_id=workflow_id,
    )


async def run_node(
    *,
    completion: CompletionCallable | None,
    connection: ProviderConnection | None,
    incoming_edges: list[StoredWorkflowEdge],
    node: StoredWorkflowNode,
    outputs: Mapping[str, str],
) -> str:
    if node.type == "input":
        return node_data_text(node, "default_value")
    if node.type == "agent":
        if connection is None:
            raise ValueError("Choose a provider and model before running.")
        prompt = render_template(
            node_data_text(node, "prompt")
            or joined_upstream_outputs(incoming_edges, outputs),
            outputs,
        )
        response = await complete_chat(
            connection,
            [ChatMessage(role="user", content=prompt)],
            completion=completion,
        )
        return response.content
    if node.type == "merge":
        upstream = upstream_outputs(incoming_edges, outputs)
        if node_data_text(node, "merge_strategy") == "json":
            return merge_json_outputs(upstream)
        return "\n".join(output for output in upstream if output)
    if node.type == "code":
        return await run_code_node(node, upstream_outputs(incoming_edges, outputs))
    if node.type == "output":
        return joined_upstream_outputs(incoming_edges, outputs)
    raise ValueError("Node type is not supported.")


async def run_code_node(node: StoredWorkflowNode, upstream: list[str]) -> str:
    code = node_data_text(node, "code")
    if not code.strip():
        return joined_text(upstream)
    with tempfile.TemporaryDirectory(prefix="flowent-workflow-code-") as code_dir:
        result = await SandboxRunner(timeout_seconds=10, cwd=Path(code_dir)).run_async(
            [sys.executable, "-I", "-c", PYTHON_CODE_RUNNER],
            input_text=json.dumps(
                {
                    "code": code,
                    "input": joined_text(upstream),
                    "inputs": upstream,
                },
                ensure_ascii=False,
            ),
            timeout_seconds=10,
        )
    if result.exit_code != 0:
        raise ValueError((result.stderr or result.stdout).strip() or "Code failed.")
    return result.stdout


def edges_by_target(
    edges: list[StoredWorkflowEdge],
) -> dict[str, list[StoredWorkflowEdge]]:
    grouped: dict[str, list[StoredWorkflowEdge]] = defaultdict(list)
    for edge in edges:
        grouped[edge.target].append(edge)
    return grouped


def node_data_text(node: StoredWorkflowNode, key: str) -> str:
    value = node.data.get(key, "")
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return str(value)


def node_output_key(node: StoredWorkflowNode) -> str:
    return node_data_text(node, "output_key") or node.id


def upstream_outputs(
    incoming_edges: list[StoredWorkflowEdge],
    outputs: Mapping[str, str],
) -> list[str]:
    return [outputs[edge.source] for edge in incoming_edges if edge.source in outputs]


def joined_upstream_outputs(
    incoming_edges: list[StoredWorkflowEdge],
    outputs: Mapping[str, str],
) -> str:
    return joined_text(upstream_outputs(incoming_edges, outputs))


def joined_text(values: list[str]) -> str:
    return "\n".join(value for value in values if value)


def render_template(template: str, outputs: Mapping[str, str]) -> str:
    return PLACEHOLDER_PATTERN.sub(
        lambda match: outputs.get(match.group(1), ""),
        template,
    )


def merge_json_outputs(upstream: list[str]) -> str:
    merged: dict[str, object] = {}
    for output in upstream:
        try:
            parsed = json.loads(output)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            merged.update(parsed)
    return json.dumps(merged, ensure_ascii=False)
