from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from flowent_agent.agents import AgentConfiguration
from flowent_agent.tools.workspace import WorkspaceConfiguration

NodeId = Annotated[
    str,
    Field(min_length=1, max_length=80, pattern=r"^[A-Za-z][A-Za-z0-9_-]*$"),
]


class Condition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str = Field(min_length=1)
    operator: Literal[
        "equals",
        "not_equals",
        "contains",
        "not_contains",
        "truthy",
        "falsy",
    ] = "truthy"
    value: Any = None


class BaseNode(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: NodeId
    name: str = Field(min_length=1, max_length=120)
    depends_on: list[NodeId] = Field(default_factory=list)


class AgentNode(BaseNode):
    type: Literal["agent"] = "agent"
    agent: AgentConfiguration
    prompt: str = Field(min_length=1)
    output_mode: Literal["text", "json"] = "text"
    max_attempts: int = Field(default=1, ge=1, le=10)


class ApprovalNode(BaseNode):
    type: Literal["approval"] = "approval"
    prompt: str = Field(min_length=1)
    reject_behavior: Literal["continue", "fail"] = "fail"
    timeout_seconds: float | None = Field(default=None, gt=0, le=86400)


class LoopNode(BaseNode):
    type: Literal["loop"] = "loop"
    nodes: list[WorkflowNode] = Field(min_length=1)
    until: Condition | None = None
    max_iterations: int = Field(default=3, ge=1, le=50)
    on_exhausted: Literal["complete", "fail"] = "fail"


WorkflowNode = Annotated[
    AgentNode | ApprovalNode | LoopNode,
    Field(discriminator="type"),
]


class WorkflowDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: NodeId
    name: str = Field(min_length=1, max_length=120)
    description: str = ""
    nodes: list[WorkflowNode] = Field(min_length=1)
    max_parallelism: int = Field(default=4, ge=1, le=16)

    @model_validator(mode="after")
    def validate_graphs(self) -> WorkflowDefinition:
        validate_graph(self.nodes, self.id)
        return self


class WorkflowSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    description: str
    latest_version: int | None = None
    updated_at: str


class WorkflowVersion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    workflow_id: str
    version: int
    definition: WorkflowDefinition
    created_at: str


class WorkflowRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_id: str = Field(min_length=1)
    workflow_id: str = Field(min_length=1)
    version: int | None = Field(default=None, ge=1)
    input: dict[str, Any] = Field(default_factory=dict)
    workspace: WorkspaceConfiguration | None = None


class WorkflowRunResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_id: str
    status: Literal["completed", "failed"]
    output: dict[str, Any] = Field(default_factory=dict)
    error: str | None = None


def validate_graph(nodes: list[WorkflowNode], owner: str) -> None:
    node_ids = [node.id for node in nodes]
    if len(node_ids) != len(set(node_ids)):
        raise ValueError(f"Workflow graph {owner} contains duplicate node IDs")
    available = set(node_ids)
    for node in nodes:
        missing = set(node.depends_on) - available
        if missing:
            names = ", ".join(sorted(missing))
            raise ValueError(f"Node {node.id} has unknown dependencies: {names}")
        if node.id in node.depends_on:
            raise ValueError(f"Node {node.id} cannot depend on itself")
        if isinstance(node, LoopNode):
            validate_graph(node.nodes, node.id)

    visiting: set[str] = set()
    visited: set[str] = set()
    dependencies = {node.id: node.depends_on for node in nodes}

    def visit(node_id: str) -> None:
        if node_id in visiting:
            raise ValueError(f"Workflow graph {owner} contains a dependency cycle")
        if node_id in visited:
            return
        visiting.add(node_id)
        for dependency in dependencies[node_id]:
            visit(dependency)
        visiting.remove(node_id)
        visited.add(node_id)

    for node_id in node_ids:
        visit(node_id)


LoopNode.model_rebuild()
