from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import uuid4
from zoneinfo import ZoneInfo

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
                "description": "Run a saved workflow once. For a Timer workflow, use start_workflow_schedule instead.",
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
                "name": "start_workflow_schedule",
                "description": "Start or restart a Timer workflow schedule.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "workflow_id": {"type": "string"},
                        "input": {"type": "string"},
                        "inputs": {
                            "type": "object",
                            "additionalProperties": {"type": "string"},
                        },
                        "timezone": {"type": "string"},
                    },
                    "required": ["workflow_id"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "stop_workflow_schedule",
                "description": "Stop a Timer workflow schedule.",
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
                "name": "get_workflow_schedule",
                "description": "Get the current Timer workflow schedule and latest run trace.",
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
        {
            "type": "function",
            "function": {
                "name": "delete_workflow",
                "description": "Delete a saved workflow by id after the user clearly asks to remove it. List workflows first when the name is ambiguous.",
                "parameters": {
                    "type": "object",
                    "properties": {"workflow_id": {"type": "string"}},
                    "required": ["workflow_id"],
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
    if name == "start_workflow_schedule":
        return "Starting workflow schedule"
    if name == "stop_workflow_schedule":
        return "Stopping workflow schedule"
    if name == "get_workflow_schedule":
        return "Reading workflow schedule"
    if name == "create_workflow":
        return "Creating workflow"
    if name == "update_workflow":
        return "Updating workflow"
    if name == "delete_workflow":
        return "Deleting workflow"
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
            if name == "start_workflow_schedule":
                return await self.start_workflow_schedule(arguments)
            if name == "stop_workflow_schedule":
                return await self.stop_workflow_schedule(arguments)
            if name == "get_workflow_schedule":
                return self.get_workflow_schedule(arguments)
            if name == "create_workflow":
                return await self.create_workflow(arguments)
            if name == "update_workflow":
                return await self.update_workflow(arguments)
            if name == "delete_workflow":
                return await self.delete_workflow(arguments)
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

    async def create_workflow(self, arguments: dict[str, object]) -> ToolResult:
        workflow = workflow_argument(arguments)
        saved = await self.service.save_workflow(
            workflow.model_copy(update={"id": str(uuid4())})
        )
        return saved_workflow_result(saved, "Created")

    async def update_workflow(self, arguments: dict[str, object]) -> ToolResult:
        workflow = workflow_argument(arguments)
        self.service.get_workflow(workflow.id)
        saved = await self.service.save_workflow(workflow)
        return saved_workflow_result(saved, "Updated")

    async def delete_workflow(self, arguments: dict[str, object]) -> ToolResult:
        workflow_id = str(arguments["workflow_id"])
        workflow = await self.service.delete_workflow(workflow_id)
        summary = workflow_summary(workflow)
        output = f"Deleted {workflow.name}."
        return ToolResult(
            result={
                "type": "workflow_delete",
                "output": output,
                "summary": summary,
            },
            title=f"Deleted {workflow.name}",
        )

    async def start_workflow_schedule(self, arguments: dict[str, object]) -> ToolResult:
        schedule = await self.service.scheduler.start_schedule(
            str(arguments["workflow_id"]),
            default_input=string_argument(arguments, "input")
            if "input" in arguments
            else None,
            inputs=string_map_argument(arguments, "inputs")
            if "inputs" in arguments
            else None,
            timezone=string_argument(arguments, "timezone")
            if "timezone" in arguments
            else None,
        )
        return ToolResult(
            result=schedule_result(schedule), title="Started workflow schedule"
        )

    async def stop_workflow_schedule(self, arguments: dict[str, object]) -> ToolResult:
        schedule = await self.service.scheduler.stop_schedule(
            str(arguments["workflow_id"])
        )
        return ToolResult(
            result=schedule_result(schedule), title="Stopped workflow schedule"
        )

    def get_workflow_schedule(self, arguments: dict[str, object]) -> ToolResult:
        schedule = self.service.scheduler.get(str(arguments["workflow_id"]))
        return ToolResult(
            result=schedule_result(schedule), title="Read workflow schedule"
        )


def schedule_result(schedule) -> dict[str, object]:
    next_run = min(
        (item.next_run_at for item in schedule.timers if item.next_run_at is not None),
        default=None,
    )
    details = ""
    if schedule.last_error:
        details = f" Last failure: {schedule.last_error}"
    elif schedule.last_result:
        outputs = schedule.last_result.get("outputs", {})
        details = f" Latest outputs: {outputs}"
    next_text = (
        f" Next run: {datetime.fromtimestamp(next_run, ZoneInfo(schedule.timezone)).isoformat()}."
        if next_run is not None
        else ""
    )
    return {
        "type": "workflow_schedule",
        "workflow_id": schedule.workflow_id,
        "status": schedule.status,
        "timezone": schedule.timezone,
        "next_run_at": next_run,
        "last_run_at": schedule.last_run_at,
        "last_result": schedule.last_result,
        "last_error": schedule.last_error,
        "output": f"Workflow schedule is {schedule.status}.{next_text}{details}",
    }


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
