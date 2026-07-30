from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, SecretStr, model_validator

from flowent_agent.tools.workspace import WorkspaceConfiguration


class AgentMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Literal["user", "assistant"]
    content: str


class ModelConfiguration(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: Literal[
        "default",
        "demo",
        "openai",
        "openai_compatible",
        "anthropic",
    ] = "demo"
    model: str = Field(default="flowent-demo", min_length=1)
    api_mode: Literal["responses", "chat"] = "responses"
    api_key: SecretStr | None = Field(default=None, exclude=True)
    credential_id: str | None = Field(default="default", min_length=1, max_length=120)
    base_url: str | None = Field(default=None, min_length=1)

    @model_validator(mode="after")
    def validate_provider(self) -> "ModelConfiguration":
        if self.provider == "openai_compatible" and self.base_url is None:
            raise ValueError("OpenAI-compatible providers require base_url")
        if self.provider == "openai_compatible" and self.api_mode != "chat":
            raise ValueError("OpenAI-compatible providers require chat API mode")
        return self


class AgentLimits(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_limit: int = Field(default=24, ge=1, le=100)
    tool_calls_limit: int = Field(default=48, ge=1, le=500)
    input_tokens_limit: int | None = Field(default=None, ge=1)
    output_tokens_limit: int | None = Field(default=None, ge=1)
    total_tokens_limit: int | None = Field(default=None, ge=1)
    max_output_tokens: int | None = Field(default=None, ge=1)
    timeout_seconds: float = Field(default=300, gt=0, le=3600)


class AgentConfiguration(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str | None = None
    name: str = Field(default="Assistant", min_length=1)
    instructions: str = "You are a precise and helpful engineering assistant."
    model: ModelConfiguration = Field(default_factory=ModelConfiguration)
    limits: AgentLimits = Field(default_factory=AgentLimits)
    temperature: float | None = Field(default=None, ge=0, le=2)
    retries: int = Field(default=2, ge=0, le=10)
    tools: list[str] = Field(default_factory=list)


class AgentRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_id: str = Field(min_length=1)
    conversation_id: str | None = None
    workflow_run_id: str | None = None
    work_item_id: str | None = None
    node_id: str | None = None
    workspace: WorkspaceConfiguration | None = None
    messages: list[AgentMessage] = Field(min_length=1)
    agent: AgentConfiguration = Field(default_factory=AgentConfiguration)

    @model_validator(mode="after")
    def validate_last_message(self) -> "AgentRunRequest":
        if self.messages[-1].role != "user":
            raise ValueError("The last message must be from the user")
        return self


class AgentExecutionResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_id: str
    status: Literal["completed", "failed"]
    output: str | None = None
    usage: dict[str, Any] = Field(default_factory=dict)
    error: str | None = None
