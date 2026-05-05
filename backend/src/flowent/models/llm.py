from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class ModelCapabilities:
    input_image: bool = False
    output_image: bool = False
    structured_output: bool = False


@dataclass
class ModelInfo:
    id: str
    capabilities: ModelCapabilities = field(default_factory=ModelCapabilities)
    context_window_tokens: int | None = None


@dataclass
class LLMUsage:
    total_tokens: int
    input_tokens: int | None = None
    output_tokens: int | None = None
    cached_input_tokens: int | None = None
    cache_read_tokens: int | None = None
    cache_write_tokens: int | None = None
    details: dict[str, int] = field(default_factory=dict)


@dataclass
class ToolCallResult:
    id: str
    name: str
    arguments: dict[str, Any]


@dataclass
class LLMOutputTextPart:
    text: str


@dataclass
class LLMOutputImagePart:
    data: bytes
    mime_type: str
    width: int | None = None
    height: int | None = None


LLMOutputPart = LLMOutputTextPart | LLMOutputImagePart


@dataclass
class LLMResponse:
    content: str | None = None
    parts: list[LLMOutputPart] | None = None
    tool_calls: list[ToolCallResult] | None = None
    thinking: str | None = None
    usage: LLMUsage | None = None
    raw_usage: dict[str, Any] | None = None
