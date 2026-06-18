from __future__ import annotations

import json
import re
import sys
import tempfile
from collections import defaultdict, deque
from collections.abc import Mapping
from pathlib import Path
from typing import TYPE_CHECKING

from pydantic import BaseModel, ConfigDict, Field

from flowent.context import runtime_context_messages
from flowent.llm import ProviderConnection
from flowent.sandbox import SandboxRunner
from flowent.storage import (
    StoredWorkflow,
    StoredWorkflowDefinition,
    StoredWorkflowEdge,
    StoredWorkflowNode,
)

if TYPE_CHECKING:
    from flowent.agent_runtime import FlowentAgentRuntime


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


class WorkflowRunRequestValues(BaseModel):
    model_config = ConfigDict(extra="forbid")

    default_input: str = ""
    input_values: dict[str, str] = Field(default_factory=dict)


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
    if not any(node.type in {"input", "timer"} for node in definition.nodes):
        raise ValueError("Workflow needs an input or timer node.")
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


def timer_run_node_ids(
    definition: StoredWorkflowDefinition, timer_node_id: str
) -> set[str]:
    nodes = {node.id: node for node in definition.nodes}
    timer_node = nodes.get(timer_node_id)
    if timer_node is None or timer_node.type != "timer":
        raise ValueError("Timer node not found.")

    outgoing: dict[str, list[str]] = defaultdict(list)
    incoming: dict[str, list[str]] = defaultdict(list)
    for edge in definition.edges:
        outgoing[edge.source].append(edge.target)
        incoming[edge.target].append(edge.source)

    active = {timer_node_id}
    queue = deque([timer_node_id])
    while queue:
        node_id = queue.popleft()
        for target in outgoing[node_id]:
            if target not in active:
                active.add(target)
                queue.append(target)

    queue = deque(active)
    while queue:
        node_id = queue.popleft()
        for source in incoming[node_id]:
            source_node = nodes[source]
            if source_node.type == "timer" and source != timer_node_id:
                continue
            if source not in active:
                active.add(source)
                queue.append(source)

    return active


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
    connection: ProviderConnection | None,
    definition: StoredWorkflowDefinition,
    default_input: str = "",
    input_values: Mapping[str, str] | None = None,
    runtime: FlowentAgentRuntime | None = None,
    timer_node_id: str = "",
    workflow_depth: int = 0,
    workflow_id: str,
) -> WorkflowRunResponse:
    ordered_ids = validate_workflow_definition(definition)
    if workflow_requires_connection(definition) and connection is None:
        raise ValueError("Choose a provider and model before running.")

    return await run_workflow_once(
        connection=connection,
        definition=definition,
        input_values=WorkflowRunRequestValues(
            default_input=default_input,
            input_values=dict(input_values or {}),
        ),
        ordered_ids=ordered_ids,
        runtime=runtime,
        timer_node_id=timer_node_id,
        workflow_depth=workflow_depth,
        workflow_id=workflow_id,
    )


async def run_workflow_once(
    *,
    connection: ProviderConnection | None,
    definition: StoredWorkflowDefinition,
    input_values: WorkflowRunRequestValues,
    ordered_ids: list[str],
    runtime: FlowentAgentRuntime | None = None,
    timer_node_id: str = "",
    workflow_depth: int = 0,
    workflow_id: str,
) -> WorkflowRunResponse:
    nodes = {node.id: node for node in definition.nodes}
    incoming_edges = edges_by_target(definition.edges)
    active_node_ids = (
        timer_run_node_ids(definition, timer_node_id) if timer_node_id else None
    )
    results: dict[str, WorkflowNodeRunResult] = {
        node.id: WorkflowNodeRunResult(id=node.id, status="pending")
        for node in definition.nodes
    }
    outputs: dict[str, str] = {}
    named_outputs: dict[str, str] = {}
    remaining_default_input = input_values.default_input

    for node_id in ordered_ids:
        node = nodes[node_id]
        if active_node_ids is not None and node.id not in active_node_ids:
            continue
        results[node.id] = WorkflowNodeRunResult(id=node.id, status="running")
        try:
            output = await run_node(
                connection=connection,
                default_input=remaining_default_input,
                input_values=input_values.input_values,
                incoming_edges=incoming_edges[node.id],
                node=node,
                outputs=outputs,
                runtime=runtime,
                workflow_depth=workflow_depth,
            )
            if node.type == "input" and remaining_default_input:
                remaining_default_input = ""
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
    connection: ProviderConnection | None,
    default_input: str,
    input_values: Mapping[str, str],
    incoming_edges: list[StoredWorkflowEdge],
    node: StoredWorkflowNode,
    outputs: Mapping[str, str],
    runtime: FlowentAgentRuntime | None = None,
    workflow_depth: int = 0,
) -> str:
    if node.type == "input":
        if node.id in input_values:
            return input_values[node.id]
        if default_input:
            return default_input
        return node_data_text(node, "default_value")
    if node.type == "agent":
        if connection is None:
            raise ValueError("Choose a provider and model before running.")
        if runtime is None:
            raise ValueError("Agent runtime is not available.")
        prompt = render_template(
            node_data_text(node, "prompt")
            or joined_upstream_outputs(incoming_edges, outputs),
            outputs,
        )
        result = await runtime.complete(
            connection=connection,
            messages=[
                *runtime_context_messages(
                    runtime.cwd, runtime.store.read_state().settings.agent_prompt
                ),
                {"role": "user", "content": prompt},
            ],
            user_request=prompt,
            workflow_depth=workflow_depth,
        )
        return result.content
    if node.type == "merge":
        upstream = upstream_outputs(incoming_edges, outputs)
        if node_data_text(node, "merge_strategy") == "json":
            return merge_json_outputs(upstream)
        return "\n".join(output for output in upstream if output)
    if node.type == "code":
        return await run_code_node(node, upstream_outputs(incoming_edges, outputs))
    if node.type == "timer":
        return timer_payload(node)
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


def timer_payload(node: StoredWorkflowNode) -> str:
    return node_data_text(node, "payload") or "Timer fired."


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
