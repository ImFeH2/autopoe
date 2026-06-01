import json
import os
from collections.abc import Mapping, Sequence
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

DEFAULT_MODEL_CONTEXT_WINDOW = 120_000


class TokenUsage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    input_tokens: int = 0
    cached_input_tokens: int = 0
    output_tokens: int = 0
    reasoning_output_tokens: int = 0
    total_tokens: int = 0

    def add(self, other: "TokenUsage") -> "TokenUsage":
        return TokenUsage(
            input_tokens=self.input_tokens + other.input_tokens,
            cached_input_tokens=self.cached_input_tokens + other.cached_input_tokens,
            output_tokens=self.output_tokens + other.output_tokens,
            reasoning_output_tokens=self.reasoning_output_tokens
            + other.reasoning_output_tokens,
            total_tokens=self.total_tokens + other.total_tokens,
        )


class TokenUsageInfo(BaseModel):
    model_config = ConfigDict(extra="forbid")

    total_token_usage: TokenUsage = Field(default_factory=TokenUsage)
    last_token_usage: TokenUsage = Field(default_factory=TokenUsage)
    model_context_window: int | None = None


def current_model_context_window() -> int:
    raw_limit = os.environ.get("FLOWENT_MODEL_CONTEXT_WINDOW", "")
    try:
        limit = int(raw_limit)
    except ValueError:
        return DEFAULT_MODEL_CONTEXT_WINDOW
    return limit if limit > 0 else DEFAULT_MODEL_CONTEXT_WINDOW


def append_token_usage(
    usage_info: TokenUsageInfo | None,
    usage: TokenUsage,
    *,
    model_context_window: int | None = None,
) -> TokenUsageInfo:
    info = usage_info or TokenUsageInfo(model_context_window=model_context_window)
    return TokenUsageInfo(
        total_token_usage=info.total_token_usage.add(usage),
        last_token_usage=usage,
        model_context_window=model_context_window or info.model_context_window,
    )


def recompute_context_usage(
    usage_info: TokenUsageInfo | None,
    active_context_tokens: int,
    *,
    model_context_window: int | None = None,
) -> TokenUsageInfo:
    info = usage_info or TokenUsageInfo(model_context_window=model_context_window)
    return TokenUsageInfo(
        total_token_usage=info.total_token_usage,
        last_token_usage=TokenUsage(total_tokens=max(0, active_context_tokens)),
        model_context_window=model_context_window or info.model_context_window,
    )


def token_usage_from_response(response: Any) -> TokenUsage | None:
    usage = value_at(response, "usage")
    if usage is None:
        return None

    input_tokens = first_int_value(
        value_at(usage, "input_tokens"),
        value_at(usage, "prompt_tokens"),
    )
    output_tokens = first_int_value(
        value_at(usage, "output_tokens"),
        value_at(usage, "completion_tokens"),
    )
    total_tokens = first_int_value(value_at(usage, "total_tokens"))
    cached_input_tokens = first_int_value(
        value_at(usage, "cached_input_tokens"),
        value_at(usage, "cache_read_input_tokens"),
        value_at(usage, "cached_tokens"),
        nested_value_at(usage, "prompt_tokens_details", "cached_tokens"),
        nested_value_at(usage, "input_tokens_details", "cached_tokens"),
        nested_value_at(usage, "cache_read", "input_tokens"),
    )
    reasoning_output_tokens = first_int_value(
        value_at(usage, "reasoning_output_tokens"),
        nested_value_at(usage, "completion_tokens_details", "reasoning_tokens"),
        nested_value_at(usage, "output_tokens_details", "reasoning_tokens"),
    )

    if total_tokens is None:
        total_tokens = (input_tokens or 0) + (output_tokens or 0)

    return TokenUsage(
        input_tokens=input_tokens or 0,
        cached_input_tokens=cached_input_tokens or 0,
        output_tokens=output_tokens or 0,
        reasoning_output_tokens=reasoning_output_tokens or 0,
        total_tokens=total_tokens,
    )


def estimated_token_usage_for_messages(
    messages: Sequence[Mapping[str, object]],
    *,
    output_content: str = "",
) -> TokenUsage:
    total_tokens = sum(estimate_mapping_message_tokens(message) for message in messages)
    output_tokens = approximate_token_count(output_content)
    return TokenUsage(
        input_tokens=max(total_tokens - output_tokens, 0),
        output_tokens=output_tokens,
        total_tokens=total_tokens,
    )


def estimate_mapping_message_tokens(message: Mapping[str, object]) -> int:
    total = approximate_token_count(string_content(message.get("content")))
    tool_calls = message.get("tool_calls")
    if tool_calls:
        total += approximate_token_count(json.dumps(tool_calls, ensure_ascii=False))
    if message.get("role") == "tool":
        total += approximate_token_count(string_content(message.get("tool_call_id")))
    return total


def approximate_token_count(content: str) -> int:
    if not content:
        return 0
    return max(1, (len(content) + 3) // 4)


def string_content(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False)


def value_at(value: Any, key: str, default: Any = None) -> Any:
    if isinstance(value, Mapping):
        return value.get(key, default)
    return getattr(value, key, default)


def nested_value_at(value: Any, *keys: str) -> Any:
    current = value
    for key in keys:
        current = value_at(current, key)
        if current is None:
            return None
    return current


def first_int_value(*values: Any) -> int | None:
    for value in values:
        if isinstance(value, bool) or value is None:
            continue
        if isinstance(value, int):
            return max(0, value)
        if isinstance(value, float):
            return max(0, int(value))
        if isinstance(value, str):
            try:
                return max(0, int(value))
            except ValueError:
                continue
    return None
