from __future__ import annotations

from typing import TYPE_CHECKING

from pydantic import ValidationError

from flowent.storage import StoredWorkflow
from flowent.tools import ToolResult, text_tool_result
from flowent.workflows import WorkflowRunResponse

if TYPE_CHECKING:
    from flowent.workflow_service import WorkflowService

MAX_WORKFLOW_TOOL_DEPTH = 3


def workflow_tool_specs() -> list[dict[str, object]]:
    workflow_schema: dict[str, object] = {"type": "object"}
    return [
        {
            "type": "function",
            "function": {
                "name": "list_workflows",
                "description": "List saved workflows with their ids, names, node counts, and edge counts.",
                "parameters": {"type": "object", "properties": {}},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_workflow",
                "description": "Read a saved workflow definition by id before answering questions or editing it.",
                "parameters": {
                    "type": "object",
                    "properties": {"workflow_id": {"type": "string"}},
                    "required": ["workflow_id"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "run_workflow",
                "description": "Run a saved workflow. Pass input when the user's current message contains the content the workflow should process.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "workflow_id": {"type": "string"},
                        "input": {"type": "string"},
                        "inputs": {
                            "type": "object",
                            "additionalProperties": {"type": "string"},
                        },
                    },
                    "required": ["workflow_id"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "create_workflow",
                "description": "Create a workflow. workflow must include id, name, and definition with version, nodes, and edges.",
                "parameters": {
                    "type": "object",
                    "properties": {"workflow": workflow_schema},
                    "required": ["workflow"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "update_workflow",
                "description": "Replace an existing workflow. Read it first and provide the complete updated workflow object.",
                "parameters": {
                    "type": "object",
                    "properties": {"workflow": workflow_schema},
                    "required": ["workflow"],
                },
            },
        },
    ]


def workflow_tool_title(name: str) -> str | None:
    if name == "list_workflows":
        return "Listing workflows"
    if name == "get_workflow":
        return "Reading workflow"
    if name == "run_workflow":
        return "Running workflow"
    if name == "create_workflow":
        return "Creating workflow"
    if name == "update_workflow":
        return "Updating workflow"
    return None


class WorkflowAgentTools:
    def __init__(self, service: WorkflowService, *, workflow_depth: int = 0) -> None:
        self.service = service
        self.workflow_depth = workflow_depth

    async def run_tool(
        self, name: str, arguments: dict[str, object]
    ) -> ToolResult | None:
        title = workflow_tool_title(name)
        if title is None:
            return None
        try:
            if name == "list_workflows":
                return self.list_workflows()
            if name == "get_workflow":
                return self.get_workflow(arguments)
            if name == "run_workflow":
                return await self.run_workflow(arguments)
            if name == "create_workflow":
                return self.create_workflow(arguments)
            if name == "update_workflow":
                return self.update_workflow(arguments)
        except Exception as error:
            return ToolResult(
                result=text_tool_result(str(error) or "Workflow tool failed."),
                ok=False,
                title=title,
            )
        return None

    def list_workflows(self) -> ToolResult:
        workflows = self.service.list_workflows()
        summaries = [workflow_summary(workflow) for workflow in workflows]
        if summaries:
            output = "\n".join(
                f"{summary['id']}: {summary['name']} ({summary['node_count']} nodes, {summary['edge_count']} edges)"
                for summary in summaries
            )
        else:
            output = "No workflows are saved."
        return ToolResult(
            result={
                "type": "workflow_list",
                "output": output,
                "workflows": summaries,
            },
            title="Listed workflows",
        )

    def get_workflow(self, arguments: dict[str, object]) -> ToolResult:
        workflow = self.service.get_workflow(str(arguments["workflow_id"]))
        summary = workflow_summary(workflow)
        output = (
            f"{workflow.name} has {summary['node_count']} nodes and "
            f"{summary['edge_count']} edges."
        )
        return ToolResult(
            result={
                "type": "workflow",
                "output": output,
                "summary": summary,
                "workflow": workflow.model_dump(mode="json"),
            },
            title=f"Read {workflow.name}",
        )

    async def run_workflow(self, arguments: dict[str, object]) -> ToolResult:
        if self.workflow_depth >= MAX_WORKFLOW_TOOL_DEPTH:
            raise ValueError("Workflow nesting is too deep.")
        workflow_id = str(arguments["workflow_id"])
        workflow = self.service.get_workflow(workflow_id)
        result = await self.service.run_workflow(
            workflow_id,
            default_input=string_argument(arguments, "input"),
            input_values=string_map_argument(arguments, "inputs"),
            workflow_depth=self.workflow_depth + 1,
        )
        output = workflow_run_output(workflow.name, result)
        return ToolResult(
            result={
                "type": "workflow_run",
                "node_results": [
                    node_result.model_dump(mode="json")
                    for node_result in result.node_results
                ],
                "output": output,
                "outputs": dict(result.outputs),
                "status": result.status,
                "workflow_id": workflow.id,
                "workflow_name": workflow.name,
            },
            ok=result.status == "success",
            title=f"Ran {workflow.name}",
        )

    def create_workflow(self, arguments: dict[str, object]) -> ToolResult:
        workflow = workflow_argument(arguments)
        try:
            self.service.get_workflow(workflow.id)
        except ValueError:
            saved = self.service.save_workflow(workflow)
        else:
            raise ValueError("Workflow already exists.")
        return saved_workflow_result(saved, "Created")

    def update_workflow(self, arguments: dict[str, object]) -> ToolResult:
        workflow = workflow_argument(arguments)
        self.service.get_workflow(workflow.id)
        saved = self.service.save_workflow(workflow)
        return saved_workflow_result(saved, "Updated")


def string_argument(arguments: dict[str, object], name: str) -> str:
    value = arguments.get(name, "")
    if value is None:
        return ""
    return value if isinstance(value, str) else str(value)


def string_map_argument(
    arguments: dict[str, object], name: str
) -> dict[str, str] | None:
    value = arguments.get(name)
    if not isinstance(value, dict):
        return None
    return {str(key): str(item) for key, item in value.items()}


def workflow_argument(arguments: dict[str, object]) -> StoredWorkflow:
    value = arguments.get("workflow")
    if not isinstance(value, dict):
        raise ValueError("Workflow must be an object.")
    try:
        return StoredWorkflow.model_validate(value)
    except ValidationError as error:
        raise ValueError(error.errors()[0]["msg"]) from error


def workflow_summary(workflow: StoredWorkflow) -> dict[str, object]:
    return {
        "edge_count": len(workflow.definition.edges),
        "id": workflow.id,
        "name": workflow.name,
        "node_count": len(workflow.definition.nodes),
        "nodes": [
            {"id": node.id, "name": node.name, "type": node.type}
            for node in workflow.definition.nodes
        ],
    }


def workflow_run_output(name: str, result: WorkflowRunResponse) -> str:
    if result.status == "success":
        if result.outputs:
            rendered_outputs = "\n".join(
                f"{key}: {value}" for key, value in result.outputs.items()
            )
            return f"{name} completed.\n{rendered_outputs}"
        return f"{name} completed."
    failures = [
        f"{node_result.id}: {node_result.error}"
        for node_result in result.node_results
        if node_result.status == "failed"
    ]
    return f"{name} failed.\n" + ("\n".join(failures) or "No failure details.")


def saved_workflow_result(workflow: StoredWorkflow, action: str) -> ToolResult:
    summary = workflow_summary(workflow)
    output = (
        f"{action} {workflow.name} with {summary['node_count']} nodes and "
        f"{summary['edge_count']} edges."
    )
    return ToolResult(
        result={
            "type": "workflow",
            "output": output,
            "summary": summary,
            "workflow": workflow.model_dump(mode="json"),
        },
        title=f"{action} {workflow.name}",
    )
