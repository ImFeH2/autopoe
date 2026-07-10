from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from flowent.llm import ProviderFormat
from flowent.storage import (
    StoredMcpServer,
    StoredMessage,
    StoredProvider,
    StoredSettings,
    StoredSkill,
    StoredState,
    StoredTelegramBot,
    StoredTelegramSession,
    StoredWorkflow,
    StoredWritablePath,
)
from flowent.usage import TokenUsageInfo


class ProviderModelsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: ProviderFormat
    provider_id: str = ""
    secret_reference: str
    base_url: str | None = None


class ProviderModelsResponse(BaseModel):
    models: list[str]


class ProviderModelsFailureResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: Literal[
        "connection_failed",
        "access_denied",
        "rate_limited",
        "provider_unavailable",
        "request_failed",
    ]


class ProviderSaveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    api_key: str | None = None
    base_url: str
    id: str
    models: list[str]
    name: str
    type: ProviderFormat


class ProviderResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    base_url: str
    has_api_key: bool
    id: str
    models: list[str]
    name: str
    type: ProviderFormat

    @classmethod
    def from_stored(cls, provider: StoredProvider) -> "ProviderResponse":
        return cls(
            base_url=provider.base_url,
            has_api_key=bool(provider.api_key),
            id=provider.id,
            models=provider.models,
            name=provider.name,
            type=provider.type,
        )


class TelegramBotSaveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    bot_token: str | None = None
    enabled: bool


class TelegramBotResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool
    error: str = ""
    has_bot_token: bool
    sessions: list[StoredTelegramSession] = Field(default_factory=list)
    status: str = "disabled"

    @classmethod
    def from_stored(cls, bot: StoredTelegramBot) -> "TelegramBotResponse":
        return cls(
            enabled=bot.enabled,
            error=bot.error,
            has_bot_token=bool(bot.bot_token),
            sessions=bot.sessions,
            status=bot.status,
        )


class AppStateResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    is_compacting: bool = False
    is_responding: bool = False
    mcp_servers: list[StoredMcpServer]
    messages: list[StoredMessage]
    providers: list[ProviderResponse]
    response_event_index: int = 0
    settings: StoredSettings
    skills: list[StoredSkill]
    telegram_bot: TelegramBotResponse
    usage_info: TokenUsageInfo | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    writable_paths: list[StoredWritablePath] = Field(default_factory=list)
    workflows: list[StoredWorkflow] = Field(default_factory=list)

    @classmethod
    def from_stored(cls, state: StoredState) -> "AppStateResponse":
        return cls(
            is_compacting=state.is_compacting,
            is_responding=state.is_responding,
            mcp_servers=state.mcp_servers,
            messages=state.messages,
            providers=[ProviderResponse.from_stored(item) for item in state.providers],
            response_event_index=state.response_event_index,
            settings=state.settings,
            skills=state.skills,
            telegram_bot=TelegramBotResponse.from_stored(state.telegram_bot),
            usage_info=state.usage_info,
            writable_paths=state.writable_paths,
            workflows=state.workflows,
        )


class WorkspaceMessagesRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    messages: list[StoredMessage]


class WorkspaceMessageEditRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: Literal["resend", "save"]
    content: str


class WorkspaceMessageEditResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    is_responding: bool = False
    messages: list[StoredMessage]


class WorkspaceRespondRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content: str
    message_id: str | None = None


class WorkspaceClearResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    messages: list[StoredMessage]
    usage_info: TokenUsageInfo | None = None


class WorkflowRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    input: str = ""
    inputs: dict[str, str] = Field(default_factory=dict)
    timer_id: str = ""


class AboutResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: str


class TelegramSessionApproveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    chat_id: str


class SkillSettingsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool


class McpImportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    server_id: str
    source: Literal["claude_code", "codex"]


class McpImportPreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: Literal["claude_code", "codex"]


class WritablePathRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str


class WritablePathListResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    writable_paths: list[StoredWritablePath]
