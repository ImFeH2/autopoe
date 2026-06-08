from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, PositiveInt

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

    x: float = 0
    y: float = 0


class StoredWorkflowNode(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: dict[str, object] = Field(default_factory=dict)
    description: str = ""
    id: str
    name: str
    position: StoredWorkflowNodePosition = Field(
        default_factory=StoredWorkflowNodePosition
    )
    type: Literal["input", "agent", "merge", "output"]


class StoredWorkflowEdge(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    label: str = ""
    source: str
    source_handle: str = ""
    target: str
    target_handle: str = ""


class StoredWorkflowDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    edges: list[StoredWorkflowEdge] = Field(default_factory=list)
    nodes: list[StoredWorkflowNode] = Field(default_factory=list)
    version: int = 1


class StoredWorkflow(BaseModel):
    model_config = ConfigDict(extra="forbid")

    created_at: int = 0
    definition: StoredWorkflowDefinition
    id: str
    name: str
    updated_at: int = 0


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
    content: str | None = None
    data: dict[str, object] | None = None


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

    active_run_event_index: int = 0
    active_run_id: str | None = None
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
