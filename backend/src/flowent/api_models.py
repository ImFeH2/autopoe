from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from flowent.llm import ProviderFormat
from flowent.storage import StoredMessage, StoredWritablePath
from flowent.usage import TokenUsageInfo


class ProviderModelsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: ProviderFormat
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
