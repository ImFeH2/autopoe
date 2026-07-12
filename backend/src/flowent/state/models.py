from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, PositiveInt

from flowent.llm import ChatMessage, ProviderFormat, ReasoningEffort
from flowent.usage import TokenUsageInfo


class StoredTelegramSession(BaseModel):
    model_config = ConfigDict(extra="forbid")

    chat_id: str
    display_name: str = ""
    recent_message: str = ""
    status: str
    updated_at: int = 0
    user_id: str = ""
    username: str = ""


class StoredTelegramBot(BaseModel):
    model_config = ConfigDict(extra="forbid")

    bot_token: str
    enabled: bool
    error: str = ""
    sessions: list[StoredTelegramSession] = Field(default_factory=list)
    status: str = "disabled"


class StoredMcpTool(BaseModel):
    model_config = ConfigDict(extra="forbid")

    description: str = ""
    input_schema: dict[str, object] = Field(default_factory=dict)
    name: str
    output_schema: dict[str, object] | None = None


class StoredMcpServer(BaseModel):
    model_config = ConfigDict(extra="forbid")

    args: list[str] = Field(default_factory=list)
    command: str = ""
    config: dict[str, object] = Field(default_factory=dict)
    enabled: bool = True
    error: str = ""
    id: str
    name: str
    status: str = "disabled"
    tools: list[StoredMcpTool] = Field(default_factory=list)
    type: str
    url: str = ""


class StoredSkill(BaseModel):
    model_config = ConfigDict(extra="forbid")

    description: str
    enabled: bool = True
    error: str = ""
    id: str
    name: str
    path: str
    scope: str
    slug: str


class StoredWritablePath(BaseModel):
    model_config = ConfigDict(extra="forbid")

    created_at: int = 0
    path: str


class StoredWorkflowNodePosition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    x: FiniteFloat
    y: FiniteFloat


class WorkflowInputNodeConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    default_value: str = ""
    input_type: Literal["text", "json", "file"] = "text"


class WorkflowAgentNodeConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    agent: Literal["Default agent"] = "Default agent"
    prompt: str = ""


class WorkflowMergeNodeConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    merge_strategy: Literal["text", "json"] = "text"


class WorkflowCodeNodeConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str = ""


class WorkflowTimerNodeConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    cron: str = ""
    interval_seconds: FiniteFloat = 5
    mode: Literal["interval", "cron"] = "interval"
    payload: str = ""


class WorkflowOutputNodeConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    output_key: str = ""
    transform: str = ""


class WorkflowInputNode(BaseModel):
    model_config = ConfigDict(extra="forbid")

    config: WorkflowInputNodeConfig
    id: str
    kind: Literal["input"]


class WorkflowAgentNode(BaseModel):
    model_config = ConfigDict(extra="forbid")

    config: WorkflowAgentNodeConfig
    id: str
    kind: Literal["agent"]


class WorkflowMergeNode(BaseModel):
    model_config = ConfigDict(extra="forbid")

    config: WorkflowMergeNodeConfig
    id: str
    kind: Literal["merge"]


class WorkflowCodeNode(BaseModel):
    model_config = ConfigDict(extra="forbid")

    config: WorkflowCodeNodeConfig
    id: str
    kind: Literal["code"]


class WorkflowTimerNode(BaseModel):
    model_config = ConfigDict(extra="forbid")

    config: WorkflowTimerNodeConfig
    id: str
    kind: Literal["timer"]


class WorkflowOutputNode(BaseModel):
    model_config = ConfigDict(extra="forbid")

    config: WorkflowOutputNodeConfig
    id: str
    kind: Literal["output"]


StoredWorkflowNode = Annotated[
    WorkflowInputNode
    | WorkflowAgentNode
    | WorkflowMergeNode
    | WorkflowCodeNode
    | WorkflowTimerNode
    | WorkflowOutputNode,
    Field(discriminator="kind"),
]


class StoredWorkflowConnectionEnd(BaseModel):
    model_config = ConfigDict(extra="forbid")

    node_id: str
    port: Literal["input", "output"]


class StoredWorkflowConnection(BaseModel):
    model_config = ConfigDict(
        extra="forbid", populate_by_name=True, serialize_by_alias=True
    )

    from_: StoredWorkflowConnectionEnd = Field(alias="from")
    id: str
    to: StoredWorkflowConnectionEnd


class StoredWorkflowSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    connections: list[StoredWorkflowConnection]
    nodes: list[StoredWorkflowNode] = Field(default_factory=list)


class StoredWorkflowNodePresentation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    description: str
    name: str
    position: StoredWorkflowNodePosition


class StoredWorkflowConnectionPresentation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: str


class StoredWorkflowPresentation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    connections: dict[str, StoredWorkflowConnectionPresentation]
    nodes: dict[str, StoredWorkflowNodePresentation]


class WorkflowDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    presentation: StoredWorkflowPresentation
    spec: StoredWorkflowSpec


class WorkflowSaveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    base_revision: int | None
    workflow: WorkflowDraft


class StoredWorkflow(BaseModel):
    model_config = ConfigDict(extra="forbid")

    active_revision: int | None
    created_at: int = 0
    id: str
    name: str
    presentation: StoredWorkflowPresentation
    revision: PositiveInt
    spec: StoredWorkflowSpec
    updated_at: int = 0


class StoredWorkflowRevision(BaseModel):
    model_config = ConfigDict(extra="forbid")

    created_at: int = 0
    revision: PositiveInt
    spec: StoredWorkflowSpec
    workflow_id: str


class StoredWorkflowRunInputs(BaseModel):
    model_config = ConfigDict(extra="forbid")

    default_input: str = ""
    values: dict[str, str] = Field(default_factory=dict)


class StoredWorkflowRunNodeError(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    message: str


class StoredWorkflowRunNodeResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    error: StoredWorkflowRunNodeError | None = None
    id: str
    inputs: list[str] = Field(default_factory=list)
    output: str = ""
    status: Literal["failed", "pending", "running", "success"]


class StoredWorkflowRun(BaseModel):
    model_config = ConfigDict(extra="forbid")

    created_at: int = 0
    inputs: StoredWorkflowRunInputs
    node_results: list[StoredWorkflowRunNodeResult] = Field(default_factory=list)
    outputs: dict[str, str] = Field(default_factory=dict)
    run_id: str
    status: Literal["failed", "success"]
    trigger: Literal["manual", "schedule"]
    updated_at: int = 0
    workflow_id: str
    workflow_revision: PositiveInt


class StoredWorkflowScheduleTimer(BaseModel):
    model_config = ConfigDict(extra="forbid")

    next_run_at: float | None = None
    timer_node_id: str


class StoredWorkflowSchedule(BaseModel):
    model_config = ConfigDict(extra="forbid")

    default_input: str = ""
    generation: int = 0
    inputs: dict[str, str] = Field(default_factory=dict)
    last_error: str = ""
    last_result: dict[str, object] | None = None
    last_run_at: float | None = None
    running_revision: PositiveInt | None = None
    running_run_id: str = ""
    running_timer_node_id: str = ""
    scheduled_revision: PositiveInt | None = None
    status: Literal["stopped", "scheduled", "running", "error"] = "stopped"
    timers: list[StoredWorkflowScheduleTimer] = Field(default_factory=list)
    timezone: str = "UTC"
    workflow_id: str


class StoredProvider(BaseModel):
    model_config = ConfigDict(extra="forbid")

    api_key: str
    base_url: str
    id: str
    models: list[str]
    name: str
    type: ProviderFormat


class StoredSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    agent_prompt: str = Field(default="", exclude_if=lambda value: value == "")
    context_window_limit: PositiveInt | None = None
    reasoning_effort: ReasoningEffort = ReasoningEffort.DEFAULT
    selected_model: str
    selected_provider_id: str


class StoredToolItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    status: str
    title: str
    arguments: dict[str, object] | None = None
    result: dict[str, object] | None = None


class StoredThinkingOutputItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content: str
    id: str
    type: Literal["thinking"]


class StoredTextOutputItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content: str
    id: str
    type: Literal["text"]


class StoredErrorOutputItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    detail: str = Field(default="", exclude_if=lambda value: value == "")
    id: str
    message: str
    title: str
    type: Literal["error"]


class StoredToolOutputItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    tool: StoredToolItem
    type: Literal["tool"]


StoredOutputItem = Annotated[
    StoredThinkingOutputItem
    | StoredTextOutputItem
    | StoredErrorOutputItem
    | StoredToolOutputItem,
    Field(discriminator="type"),
]


class StoredAssistantOutputGroup(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    items: list[StoredOutputItem]


class StoredMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    author: str
    content: str
    groups: list[StoredAssistantOutputGroup] = Field(
        default_factory=list, exclude_if=lambda value: value == []
    )
    id: str
    status: str = Field(
        default="completed", exclude_if=lambda value: value == "completed"
    )
    summary: str = Field(default="", exclude_if=lambda value: value == "")
    thinking: str = Field(default="", exclude_if=lambda value: value == "")
    tools: list[StoredToolItem] = Field(default_factory=list)
    usage_info: TokenUsageInfo | None = Field(
        default=None, exclude_if=lambda value: value is None
    )


class StoredCompactionCheckpoint(BaseModel):
    model_config = ConfigDict(extra="forbid")

    created_at: int = 0
    id: str
    method: str
    replacement_history: list[ChatMessage]
    source_message_id: str | None = None
    summary: str
    token_after: int = 0
    token_before: int = 0
    trigger: str


class StoredState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    is_responding: bool = False
    response_event_index: int = 0
    is_compacting: bool = False
    mcp_servers: list[StoredMcpServer]
    messages: list[StoredMessage]
    providers: list[StoredProvider]
    settings: StoredSettings
    skills: list[StoredSkill]
    telegram_bot: StoredTelegramBot
    usage_info: TokenUsageInfo | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    writable_paths: list[StoredWritablePath] = Field(default_factory=list)
    workflows: list[StoredWorkflow] = Field(default_factory=list)
