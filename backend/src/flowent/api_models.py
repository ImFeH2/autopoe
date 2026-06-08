from typing import Literal

from pydantic import BaseModel, ConfigDict

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


class WorkspaceMessagesRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    messages: list[StoredMessage]


class WorkspaceMessageEditRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: Literal["resend", "save"]
    content: str


class WorkspaceMessageEditResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    messages: list[StoredMessage]
    run_id: str | None = None


class WorkspaceRespondRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content: str


class WorkspaceRunResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_id: str


class WorkspaceClearResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    active_run_id: str | None = None
    messages: list[StoredMessage]
    usage_info: TokenUsageInfo | None = None


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
