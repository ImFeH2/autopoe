import json
from collections.abc import Mapping, Sequence
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

DEFAULT_MODEL_CONTEXT_WINDOW = 120_000
APPROX_BYTES_PER_TOKEN = 4

MODEL_CONTEXT_WINDOWS: dict[str, int] = {
    "claude-3-7-sonnet-20250219": 200_000,
    "claude-3-haiku-20240307": 200_000,
    "claude-3-opus-20240229": 200_000,
    "claude-4-opus-20250514": 200_000,
    "claude-4-sonnet-20250514": 1_000_000,
    "claude-haiku-4-5": 200_000,
    "claude-haiku-4-5-20251001": 200_000,
    "claude-opus-4-1": 200_000,
    "claude-opus-4-1-20250805": 200_000,
    "claude-opus-4-20250514": 200_000,
    "claude-opus-4-5": 200_000,
    "claude-opus-4-5-20251101": 200_000,
    "claude-opus-4-6": 1_000_000,
    "claude-opus-4-6-20260205": 1_000_000,
    "claude-opus-4-7": 1_000_000,
    "claude-opus-4-7-20260416": 1_000_000,
    "claude-opus-4-8": 1_000_000,
    "claude-sonnet-4-20250514": 1_000_000,
    "claude-sonnet-4-5": 200_000,
    "claude-sonnet-4-5-20250929": 200_000,
    "claude-sonnet-4-5-20250929-v1:0": 200_000,
    "claude-sonnet-4-6": 1_000_000,
    "gemini-2.5-computer-use-preview-10-2025": 128_000,
    "gemini-2.5-flash": 1_048_576,
    "gemini-2.5-flash-image": 32_768,
    "gemini-2.5-flash-lite": 1_048_576,
    "gemini-2.5-flash-lite-preview-06-17": 1_048_576,
    "gemini-2.5-flash-lite-preview-09-2025": 1_048_576,
    "gemini-2.5-flash-native-audio-latest": 1_048_576,
    "gemini-2.5-flash-native-audio-preview-09-2025": 1_048_576,
    "gemini-2.5-flash-native-audio-preview-12-2025": 1_048_576,
    "gemini-2.5-flash-preview-09-2025": 1_048_576,
    "gemini-2.5-pro": 1_048_576,
    "gemini-2.5-pro-preview-tts": 1_048_576,
    "gemini-3-flash-preview": 1_048_576,
    "gemini-3-pro-image-preview": 65_536,
    "gemini-3-pro-preview": 1_048_576,
    "gemini-3.1-flash-image-preview": 65_536,
    "gemini-3.1-flash-lite": 1_048_576,
    "gemini-3.1-flash-lite-preview": 1_048_576,
    "gemini-3.1-flash-live-preview": 131_072,
    "gemini-3.1-pro-preview": 1_048_576,
    "gemini-3.1-pro-preview-customtools": 1_048_576,
    "gemini-3.5-flash": 1_048_576,
    "gpt-4.1": 1_047_576,
    "gpt-4.1-2025-04-14": 1_047_576,
    "gpt-4.1-mini": 1_047_576,
    "gpt-4.1-mini-2025-04-14": 1_047_576,
    "gpt-4.1-nano": 1_047_576,
    "gpt-4.1-nano-2025-04-14": 1_047_576,
    "gpt-5": 272_000,
    "gpt-5-2025-08-07": 272_000,
    "gpt-5-chat": 128_000,
    "gpt-5-chat-latest": 128_000,
    "gpt-5-codex": 272_000,
    "gpt-5-mini": 272_000,
    "gpt-5-mini-2025-08-07": 272_000,
    "gpt-5-nano": 272_000,
    "gpt-5-nano-2025-08-07": 272_000,
    "gpt-5-pro": 128_000,
    "gpt-5-pro-2025-10-06": 128_000,
    "gpt-5-search-api": 272_000,
    "gpt-5-search-api-2025-10-14": 272_000,
    "gpt-5.1": 272_000,
    "gpt-5.1-2025-11-13": 272_000,
    "gpt-5.1-chat-latest": 128_000,
    "gpt-5.1-codex": 272_000,
    "gpt-5.1-codex-max": 272_000,
    "gpt-5.1-codex-mini": 272_000,
    "gpt-5.2": 272_000,
    "gpt-5.2-2025-12-11": 272_000,
    "gpt-5.2-chat-latest": 128_000,
    "gpt-5.2-codex": 272_000,
    "gpt-5.2-pro": 272_000,
    "gpt-5.2-pro-2025-12-11": 272_000,
    "gpt-5.3-chat-latest": 128_000,
    "gpt-5.3-codex": 272_000,
    "gpt-5.4": 1_050_000,
    "gpt-5.4-2026-03-05": 1_050_000,
    "gpt-5.4-mini": 272_000,
    "gpt-5.4-mini-2026-03-17": 272_000,
    "gpt-5.4-nano": 272_000,
    "gpt-5.4-nano-2026-03-17": 272_000,
    "gpt-5.4-pro": 1_050_000,
    "gpt-5.4-pro-2026-03-05": 1_050_000,
    "gpt-5.5": 1_050_000,
    "gpt-5.5-2026-04-23": 1_050_000,
    "gpt-5.5-pro": 1_050_000,
    "gpt-5.5-pro-2026-04-23": 1_050_000,
    "o3": 200_000,
    "o3-2025-04-16": 200_000,
    "o3-deep-research": 200_000,
    "o3-deep-research-2025-06-26": 200_000,
    "o3-mini": 200_000,
    "o3-mini-2025-01-31": 200_000,
    "o3-pro": 200_000,
    "o3-pro-2025-06-10": 200_000,
    "o4-mini": 200_000,
    "o4-mini-2025-04-16": 200_000,
    "o4-mini-deep-research": 200_000,
    "o4-mini-deep-research-2025-06-26": 200_000,
}

MODEL_CONTEXT_WINDOW_NAMES = tuple(sorted(MODEL_CONTEXT_WINDOWS, key=len, reverse=True))


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


def current_model_context_window(model_name: str | None = None) -> int:
    return model_context_window_for(model_name)


def model_context_window_for(model_name: str | None = None) -> int:
    candidates = normalized_model_name_candidates(model_name)
    for candidate in candidates:
        context_window = MODEL_CONTEXT_WINDOWS.get(candidate)
        if context_window is not None:
            return context_window
    for candidate in candidates:
        for known_model in MODEL_CONTEXT_WINDOW_NAMES:
            if is_model_context_window_prefix_match(candidate, known_model):
                return MODEL_CONTEXT_WINDOWS[known_model]
    return DEFAULT_MODEL_CONTEXT_WINDOW


def normalized_model_name_candidates(model_name: str | None) -> tuple[str, ...]:
    if model_name is None:
        return ()
    normalized = model_name.strip().lower()
    if not normalized:
        return ()
    candidates = [normalized]
    if "/" in normalized:
        candidates.append(normalized.rsplit("/", 1)[-1])
    return tuple(dict.fromkeys(candidates))


def is_model_context_window_prefix_match(candidate: str, known_model: str) -> bool:
    if candidate == known_model:
        return True
    if not candidate.startswith(known_model):
        return False
    return candidate[len(known_model)] in {"-", ".", ":", "/"}


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
    input_tokens = sum(estimate_mapping_message_tokens(message) for message in messages)
    output_tokens = approximate_token_count(output_content)
    return TokenUsage(
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=input_tokens + output_tokens,
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
    return max(
        1,
        (len(content.encode("utf-8")) + APPROX_BYTES_PER_TOKEN - 1)
        // APPROX_BYTES_PER_TOKEN,
    )


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
