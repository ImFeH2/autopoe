from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Scope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    workflow_run_id: str | None = None
    agent_run_id: str | None = None
    run_id: str | None = None


class Envelope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    protocol_version: Literal[1] = 1
    id: str = Field(min_length=1)
    kind: Literal["request", "response", "event"]
    name: str = Field(min_length=1)
    reply_to: str | None = None
    sequence: int | None = Field(default=None, ge=0)
    scope: Scope | None = None
    payload: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_correlation(self) -> "Envelope":
        if self.kind == "response" and self.reply_to is None:
            raise ValueError("responses require reply_to")
        if self.kind != "response" and self.reply_to is not None:
            raise ValueError("reply_to is only valid on responses")
        return self
