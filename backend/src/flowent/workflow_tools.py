from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime
from typing import Annotated, Literal, Protocol
from uuid import uuid4
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from flowent.state.models import (
    WorkflowAgentNodeConfig,
    WorkflowCodeNodeConfig,
    WorkflowInputNodeConfig,
    WorkflowMergeNodeConfig,
    WorkflowOutputNodeConfig,
    WorkflowTimerNodeConfig,
)
from flowent.storage import (
    StoredWorkflow,
    StoredWorkflowRevision,
    StoredWorkflowRun,
    StoredWorkflowSchedule,
    WorkflowDraft,
    WorkflowRevisionConflictError,
)
from flowent.tool_protocol import ToolResult, text_tool_result
from flowent.workflows import WorkflowRunResponse

MAX_WORKFLOW_TOOL_DEPTH = 3


class WorkflowOperations(Protocol):
    def list_workflows(self) -> list[StoredWorkflow]: ...

    def get_workflow(self, workflow_id: str) -> StoredWorkflow: ...

    def get_workflow_revision(
        self, workflow_id: str, revision: int
    ) -> StoredWorkflowRevision: ...

    def get_workflow_run(self, run_id: str) -> StoredWorkflowRun: ...

    def get_workflow_schedule(self, workflow_id: str) -> StoredWorkflowSchedule: ...

    async def save_workflow(
        self,
        workflow: WorkflowDraft,
        *,
        base_revision: int | None,
        require_executable: bool = False,
    ) -> StoredWorkflow: ...

    async def delete_workflow(self, workflow_id: str) -> StoredWorkflow: ...

    async def run_workflow(
        self,
        workflow_id: str,
        *,
        default_input: str = "",
        input_values: Mapping[str, str] | None = None,
        workflow_revision: int | None = None,
        workflow_depth: int = 0,
    ) -> WorkflowRunResponse: ...

    async def start_workflow_schedule(
        self,
        workflow_id: str,
        *,
        default_input: str | None = None,
        inputs: dict[str, str] | None = None,
        timezone: str | None = None,
        workflow_revision: int | None = None,
    ) -> StoredWorkflowSchedule: ...

    async def stop_workflow_schedule(
        self, workflow_id: str
    ) -> StoredWorkflowSchedule: ...


class WorkflowToolNodeBase(BaseModel):
    model_config = ConfigDict(extra="forbid")

    description: str
    id: str
    name: str


class WorkflowToolInputNode(WorkflowToolNodeBase):
    config: WorkflowInputNodeConfig
    kind: Literal["input"]


class WorkflowToolAgentNode(WorkflowToolNodeBase):
    config: WorkflowAgentNodeConfig
    kind: Literal["agent"]


class WorkflowToolMergeNode(WorkflowToolNodeBase):
    config: WorkflowMergeNodeConfig
    kind: Literal["merge"]


class WorkflowToolCodeNode(WorkflowToolNodeBase):
    config: WorkflowCodeNodeConfig
    kind: Literal["code"]


class WorkflowToolTimerNode(WorkflowToolNodeBase):
    config: WorkflowTimerNodeConfig
    kind: Literal["timer"]


class WorkflowToolOutputNode(WorkflowToolNodeBase):
    config: WorkflowOutputNodeConfig
    kind: Literal["output"]


WorkflowToolNode = Annotated[
    WorkflowToolInputNode
    | WorkflowToolAgentNode
    | WorkflowToolMergeNode
    | WorkflowToolCodeNode
    | WorkflowToolTimerNode
    | WorkflowToolOutputNode,
    Field(discriminator="kind"),
]


class WorkflowToolConnectionEnd(BaseModel):
    model_config = ConfigDict(extra="forbid")

    node_id: str
    port: Literal["input", "output"]


class WorkflowToolConnection(BaseModel):
    model_config = ConfigDict(
        extra="forbid", populate_by_name=True, serialize_by_alias=True
    )

    from_: WorkflowToolConnectionEnd = Field(alias="from")
    id: str = ""
    label: str = ""
    to: WorkflowToolConnectionEnd


class WorkflowToolSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    connections: list[WorkflowToolConnection]
    name: str
    nodes: list[WorkflowToolNode]


def strict_parameters(properties: dict[str, object], required: list[str]):
    return {
        "type": "object",
        "properties": properties,
        "required": required,
        "additionalProperties": False,
    }


def workflow_tool_specs() -> list[dict[str, object]]:
    workflow_schema = compact_json_schema(WorkflowToolSpec.model_json_schema())
    string_map_schema = {
        "type": "object",
        "additionalProperties": {"type": "string"},
    }
    return [
        tool_spec(
            "list_workflows",
            "List saved workflows with their ids, names, node counts, and connection counts.",
            strict_parameters({}, []),
        ),
        tool_spec(
            "get_workflow",
            "Read a saved workflow by id before answering questions or editing it.",
            strict_parameters({"workflow_id": {"type": "string"}}, ["workflow_id"]),
        ),
        tool_spec(
            "get_workflow_run",
            "Read a workflow run by id with its complete trace and the immutable revision spec that was executed.",
            strict_parameters({"run_id": {"type": "string"}}, ["run_id"]),
        ),
        tool_spec(
            "run_workflow",
            "Run the active content of a saved workflow once. For a Timer workflow, use start_workflow_schedule instead.",
            strict_parameters(
                {
                    "workflow_id": {"type": "string"},
                    "workflow_revision": {"type": "integer", "minimum": 1},
                    "input": {"type": "string"},
                    "inputs": string_map_schema,
                },
                ["workflow_id"],
            ),
        ),
        tool_spec(
            "start_workflow_schedule",
            "Start or restart a Timer workflow schedule.",
            strict_parameters(
                {
                    "workflow_id": {"type": "string"},
                    "workflow_revision": {"type": "integer", "minimum": 1},
                    "input": {"type": "string"},
                    "inputs": string_map_schema,
                    "timezone": {"type": "string"},
                },
                ["workflow_id"],
            ),
        ),
        tool_spec(
            "stop_workflow_schedule",
            "Stop a Timer workflow schedule.",
            strict_parameters({"workflow_id": {"type": "string"}}, ["workflow_id"]),
        ),
        tool_spec(
            "get_workflow_schedule",
            "Get the current Timer workflow schedule and latest run trace.",
            strict_parameters({"workflow_id": {"type": "string"}}, ["workflow_id"]),
        ),
        tool_spec(
            "create_workflow",
            "Create a complete workflow with semantic nodes and canonical connections.",
            strict_parameters({"workflow": workflow_schema}, ["workflow"]),
        ),
        tool_spec(
            "update_workflow",
            "Replace a complete workflow after reading its latest revision.",
            strict_parameters(
                {
                    "workflow_id": {"type": "string"},
                    "base_revision": {"type": "integer", "minimum": 1},
                    "workflow": workflow_schema,
                },
                ["workflow_id", "base_revision", "workflow"],
            ),
        ),
        tool_spec(
            "delete_workflow",
            "Delete a saved workflow by id after the user clearly asks to remove it. List workflows first when the name is ambiguous.",
            strict_parameters({"workflow_id": {"type": "string"}}, ["workflow_id"]),
        ),
    ]


def compact_json_schema(value):
    if isinstance(value, dict):
        return {
            key: compact_json_schema(item)
            for key, item in value.items()
            if key not in {"default", "title"}
        }
    if isinstance(value, list):
        return [compact_json_schema(item) for item in value]
    return value


def tool_spec(name: str, description: str, parameters: dict[str, object]):
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": parameters,
        },
    }


def workflow_tool_title(name: str) -> str | None:
    return {
        "list_workflows": "Listing workflows",
        "get_workflow": "Reading workflow",
        "get_workflow_run": "Reading workflow run",
        "run_workflow": "Running workflow",
        "start_workflow_schedule": "Starting workflow schedule",
        "stop_workflow_schedule": "Stopping workflow schedule",
        "get_workflow_schedule": "Reading workflow schedule",
        "create_workflow": "Creating workflow",
        "update_workflow": "Updating workflow",
        "delete_workflow": "Deleting workflow",
    }.get(name)


class WorkflowAgentTools:
    def __init__(self, service: WorkflowOperations, *, workflow_depth: int = 0) -> None:
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
            if name == "get_workflow_run":
                return self.get_workflow_run(arguments)
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
        except WorkflowRevisionConflictError as error:
            return workflow_conflict_result(error.workflow, title)
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
        output = (
            "\n".join(
                f"{summary['id']}: {summary['name']} ({summary['node_count']} nodes, {summary['connection_count']} connections)"
                for summary in summaries
            )
            if summaries
            else "No workflows are saved."
        )
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
            f"{summary['connection_count']} connections."
        )
        return ToolResult(
            result={
                "type": "workflow_read",
                "output": output,
                "summary": summary,
                "workflow_id": workflow.id,
                "base_revision": workflow.revision,
                "workflow": workflow_tool_spec_from_stored(workflow),
            },
            title=f"Read {workflow.name}",
        )

    def get_workflow_run(self, arguments: dict[str, object]) -> ToolResult:
        run = self.service.get_workflow_run(str(arguments["run_id"]))
        revision = self.service.get_workflow_revision(
            run.workflow_id, run.workflow_revision
        )
        return ToolResult(
            result={
                "type": "workflow_run_read",
                "output": (
                    f"Read workflow run {run.run_id} for revision "
                    f"{run.workflow_revision}."
                ),
                "trace": run.model_dump(mode="json"),
                "workflow_revision": revision.model_dump(mode="json", by_alias=True),
            },
            title="Read workflow run",
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
            workflow_revision=positive_int_argument(arguments, "workflow_revision"),
            workflow_depth=self.workflow_depth + 1,
        )
        output = workflow_run_output(workflow.name, result)
        payload = result.model_dump(mode="json")
        payload.update(
            {
                "type": "workflow_run",
                "output": output,
                "workflow_name": workflow.name,
            }
        )
        return ToolResult(
            result=payload,
            ok=result.status == "success",
            title=f"Ran {workflow.name}",
        )

    async def create_workflow(self, arguments: dict[str, object]) -> ToolResult:
        semantic = workflow_tool_spec_argument(arguments)
        workflow = workflow_draft_from_tool_spec(
            semantic,
            workflow_id=str(uuid4()),
        )
        saved = await self.service.save_workflow(
            workflow,
            base_revision=None,
            require_executable=True,
        )
        return saved_workflow_result(saved, "Created")

    async def update_workflow(self, arguments: dict[str, object]) -> ToolResult:
        workflow_id = str(arguments["workflow_id"])
        base_revision_value = arguments["base_revision"]
        if isinstance(base_revision_value, bool) or not isinstance(
            base_revision_value, int
        ):
            raise ValueError("base_revision must be an integer.")
        base_revision = base_revision_value
        current = self.service.get_workflow(workflow_id)
        semantic = workflow_tool_spec_argument(arguments)
        workflow = workflow_draft_from_tool_spec(
            semantic,
            workflow_id=workflow_id,
            current=current,
        )
        saved = await self.service.save_workflow(
            workflow,
            base_revision=base_revision,
            require_executable=True,
        )
        return saved_workflow_result(saved, "Updated")

    async def delete_workflow(self, arguments: dict[str, object]) -> ToolResult:
        workflow_id = str(arguments["workflow_id"])
        workflow = await self.service.delete_workflow(workflow_id)
        return ToolResult(
            result={
                "type": "workflow_delete",
                "output": f"Deleted {workflow.name}.",
                "summary": workflow_summary(workflow),
            },
            title=f"Deleted {workflow.name}",
        )

    async def start_workflow_schedule(self, arguments: dict[str, object]) -> ToolResult:
        schedule = await self.service.start_workflow_schedule(
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
            workflow_revision=positive_int_argument(arguments, "workflow_revision"),
        )
        return ToolResult(
            result=schedule_result(schedule), title="Started workflow schedule"
        )

    async def stop_workflow_schedule(self, arguments: dict[str, object]) -> ToolResult:
        schedule = await self.service.stop_workflow_schedule(
            str(arguments["workflow_id"])
        )
        return ToolResult(
            result=schedule_result(schedule), title="Stopped workflow schedule"
        )

    def get_workflow_schedule(self, arguments: dict[str, object]) -> ToolResult:
        schedule = self.service.get_workflow_schedule(str(arguments["workflow_id"]))
        return ToolResult(
            result=schedule_result(schedule), title="Read workflow schedule"
        )


def workflow_draft_from_tool_spec(
    workflow: WorkflowToolSpec,
    *,
    workflow_id: str,
    current: StoredWorkflow | None = None,
) -> WorkflowDraft:
    current_positions = current.presentation.nodes if current else {}
    current_connection_ids = (
        {
            (connection.from_.node_id, connection.to.node_id): connection.id
            for connection in current.spec.connections
        }
        if current
        else {}
    )
    resolved_connections = [
        (
            connection.id.strip()
            or current_connection_ids.get(
                (connection.from_.node_id, connection.to.node_id)
            )
            or str(uuid4()),
            connection,
        )
        for connection in workflow.connections
    ]
    nodes = [
        {
            "id": node.id,
            "kind": node.kind,
            "config": node.config.model_dump(mode="json", exclude_none=True),
        }
        for node in workflow.nodes
    ]
    presentation_nodes = {}
    for index, node in enumerate(workflow.nodes):
        existing = current_positions.get(node.id)
        position = (
            existing.position.model_dump(mode="json")
            if existing
            else {"x": float(index * 260), "y": 0.0}
        )
        presentation_nodes[node.id] = {
            "name": node.name,
            "description": node.description,
            "position": position,
        }
    return WorkflowDraft.model_validate(
        {
            "id": workflow_id,
            "name": workflow.name,
            "spec": {
                "nodes": nodes,
                "connections": [
                    {
                        "id": connection_id,
                        "from": connection.from_.model_dump(mode="json"),
                        "to": connection.to.model_dump(mode="json"),
                    }
                    for connection_id, connection in resolved_connections
                ],
            },
            "presentation": {
                "nodes": presentation_nodes,
                "connections": {
                    connection_id: {"label": connection.label}
                    for connection_id, connection in resolved_connections
                },
            },
        }
    )


def workflow_tool_spec_from_stored(workflow: StoredWorkflow) -> dict[str, object]:
    return WorkflowToolSpec.model_validate(
        {
            "name": workflow.name,
            "nodes": [
                {
                    "id": node.id,
                    "name": workflow.presentation.nodes[node.id].name,
                    "description": workflow.presentation.nodes[node.id].description,
                    "kind": node.kind,
                    "config": node.config.model_dump(mode="json"),
                }
                for node in workflow.spec.nodes
            ],
            "connections": [
                {
                    "id": connection.id,
                    "label": workflow.presentation.connections[connection.id].label,
                    "from": connection.from_.model_dump(mode="json"),
                    "to": connection.to.model_dump(mode="json"),
                }
                for connection in workflow.spec.connections
            ],
        }
    ).model_dump(mode="json", by_alias=True)


def workflow_tool_spec_argument(arguments: dict[str, object]) -> WorkflowToolSpec:
    value = arguments.get("workflow")
    if not isinstance(value, dict):
        raise ValueError("Workflow must be an object.")
    try:
        return WorkflowToolSpec.model_validate(value)
    except ValidationError as error:
        location = error.errors()[0].get("loc", ())
        context = workflow_validation_context(value, location)
        raise ValueError(f"{context}{error}") from error


def workflow_validation_context(value: dict[str, object], location: tuple) -> str:
    if "nodes" in location:
        index = location[location.index("nodes") + 1]
        nodes = value.get("nodes")
        if isinstance(index, int) and isinstance(nodes, list) and index < len(nodes):
            node = nodes[index]
            if isinstance(node, dict):
                return f"Node {node.get('id', index)}: "
    if "connections" in location:
        index = location[location.index("connections") + 1]
        connections = value.get("connections")
        if (
            isinstance(index, int)
            and isinstance(connections, list)
            and index < len(connections)
        ):
            connection = connections[index]
            if isinstance(connection, dict):
                endpoint = "to" if "to" in location else "from"
                end = connection.get(endpoint)
                node_id = end.get("node_id") if isinstance(end, dict) else index
                return f"Node {node_id}: "
    return ""


def schedule_result(schedule) -> dict[str, object]:
    next_run = min(
        (item.next_run_at for item in schedule.timers if item.next_run_at is not None),
        default=None,
    )
    details = ""
    if schedule.last_error:
        details = f" Last failure: {schedule.last_error}"
    elif schedule.last_result:
        details = f" Latest outputs: {schedule.last_result.get('outputs', {})}"
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


def positive_int_argument(arguments: dict[str, object], name: str) -> int | None:
    value = arguments.get(name)
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise ValueError(f"{name} must be a positive integer.")
    return value


def workflow_summary(workflow: StoredWorkflow) -> dict[str, object]:
    return {
        "connection_count": len(workflow.spec.connections),
        "id": workflow.id,
        "name": workflow.name,
        "node_count": len(workflow.spec.nodes),
        "revision": workflow.revision,
        "active_revision": workflow.active_revision,
        "nodes": [
            {
                "id": node.id,
                "name": workflow.presentation.nodes[node.id].name,
                "kind": node.kind,
            }
            for node in workflow.spec.nodes
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
        f"{node_result.id}: {node_result.error.message}"
        for node_result in result.node_results
        if node_result.error is not None
    ]
    return f"{name} failed.\n" + ("\n".join(failures) or "No failure details.")


def saved_workflow_result(workflow: StoredWorkflow, action: str) -> ToolResult:
    summary = workflow_summary(workflow)
    output = (
        f"{action} {workflow.name} with {summary['node_count']} nodes and "
        f"{summary['connection_count']} connections."
    )
    return ToolResult(
        result={
            "type": "workflow",
            "output": output,
            "summary": summary,
            "workflow": workflow.model_dump(mode="json", by_alias=True),
        },
        title=f"{action} {workflow.name}",
    )


def workflow_conflict_result(workflow: StoredWorkflow, title: str) -> ToolResult:
    return ToolResult(
        result={
            "type": "workflow_conflict",
            "output": "This workflow changed elsewhere. Use the latest version to continue.",
            "workflow_id": workflow.id,
            "base_revision": workflow.revision,
            "workflow": workflow_tool_spec_from_stored(workflow),
        },
        ok=False,
        title=title,
    )
