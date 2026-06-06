import asyncio
import logging
import re
from collections.abc import AsyncIterator, Awaitable, Mapping, Sequence
from enum import StrEnum
from typing import Any, Literal, Protocol, cast
from urllib.parse import urlsplit, urlunsplit

from pydantic import BaseModel, ConfigDict, Field

from flowent.logging import (
    TRACE_LEVEL,
    configure_litellm_logging,
    write_llm_request_diagnostic,
)
from flowent.usage import TokenUsage, token_usage_from_response


class ProviderFormat(StrEnum):
    OPENAI = "openai"
    OPENAI_RESPONSES = "openai_responses"
    ANTHROPIC = "anthropic"
    GEMINI = "gemini"


class ReasoningEffort(StrEnum):
    DEFAULT = "default"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    XHIGH = "xhigh"


class ProviderConnection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1)
    provider: ProviderFormat
    model: str = Field(min_length=1)
    secret_reference: str = Field(min_length=1)
    base_url: str | None = None
    reasoning_effort: ReasoningEffort = ReasoningEffort.DEFAULT


class ChatMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Literal["system", "user", "assistant"]
    content: str


class ToolCallDelta(BaseModel):
    model_config = ConfigDict(extra="forbid")

    arguments: str = ""
    id: str = ""
    index: int = 0
    name: str = ""
    type: str = "function"


class ChatCompletionResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message: ChatMessage
    usage: TokenUsage | None = None


class CompletionCallable(Protocol):
    def __call__(self, **kwargs: Any) -> Awaitable[Any]: ...


class ModelListCallable(Protocol):
    def __call__(self, **kwargs: Any) -> Sequence[str]: ...


logger = logging.getLogger("flowent.llm")

LLM_RETRY_LIMIT = 5
LLM_RETRY_BASE_DELAY_SECONDS = 0.5


class LLMStreamError(RuntimeError):
    pass


async def wait_before_llm_retry(attempt_number: int) -> None:
    await asyncio.sleep(LLM_RETRY_BASE_DELAY_SECONDS * attempt_number)


async def request_litellm_completion(
    completion: CompletionCallable,
    request: Mapping[str, Any],
) -> Any:
    for attempt_number in range(LLM_RETRY_LIMIT + 1):
        try:
            return await completion(**request)
        except Exception:
            if attempt_number >= LLM_RETRY_LIMIT:
                raise
            await wait_before_llm_retry(attempt_number + 1)
    raise RuntimeError("LLM request failed")


MODEL_PREFIXES: dict[ProviderFormat, str] = {
    ProviderFormat.OPENAI: "openai",
    ProviderFormat.OPENAI_RESPONSES: "openai",
    ProviderFormat.ANTHROPIC: "anthropic",
    ProviderFormat.GEMINI: "gemini",
}
OPENAI_RESPONSES_MODEL_PREFIX = "responses/"
_litellm_stream_error_patch_installed = False

PROVIDER_API_VERSIONS: dict[ProviderFormat, str] = {
    ProviderFormat.OPENAI: "v1",
    ProviderFormat.OPENAI_RESPONSES: "v1",
    ProviderFormat.ANTHROPIC: "v1",
    ProviderFormat.GEMINI: "v1beta",
}

VERSION_PATH_SEGMENT = re.compile(r"^v\d+(?:[a-z]+)?$", re.IGNORECASE)


def provider_model_name(connection: ProviderConnection) -> str:
    model = normalize_provider_model_name(connection.provider, connection.model)
    if connection.provider == ProviderFormat.OPENAI_RESPONSES:
        model = f"{OPENAI_RESPONSES_MODEL_PREFIX}{model}"
    return f"{MODEL_PREFIXES[connection.provider]}/{model}"


def provider_litellm_name(provider: ProviderFormat) -> str:
    return MODEL_PREFIXES[provider]


def normalize_provider_base_url(
    provider: ProviderFormat, base_url: str | None
) -> str | None:
    if base_url is None:
        return None
    raw_base_url = base_url.strip()
    if not raw_base_url:
        return None
    if raw_base_url.endswith("#"):
        return raw_base_url[:-1].rstrip("/") or None

    trimmed_base_url = raw_base_url.rstrip("/")
    parsed_base_url = urlsplit(trimmed_base_url)
    path_segments = [segment for segment in parsed_base_url.path.split("/") if segment]
    if any(VERSION_PATH_SEGMENT.fullmatch(segment) for segment in path_segments):
        return trimmed_base_url

    version = PROVIDER_API_VERSIONS[provider]
    if parsed_base_url.scheme and parsed_base_url.netloc:
        path = parsed_base_url.path.rstrip("/")
        normalized_path = f"{path}/{version}" if path else f"/{version}"
        return urlunsplit(
            (
                parsed_base_url.scheme,
                parsed_base_url.netloc,
                normalized_path,
                parsed_base_url.query,
                parsed_base_url.fragment,
            )
        )

    return f"{trimmed_base_url}/{version}"


def normalize_provider_model_name(provider: ProviderFormat, model: str) -> str:
    prefix = f"{provider_litellm_name(provider)}/"
    normalized_model = model.removeprefix(prefix) if model.startswith(prefix) else model
    if provider == ProviderFormat.OPENAI_RESPONSES:
        return normalized_model.removeprefix(OPENAI_RESPONSES_MODEL_PREFIX)
    return normalized_model


def stream_failure_message(chunk: Any) -> str:
    if isinstance(chunk, BaseModel):
        chunk = chunk.model_dump()
    if not isinstance(chunk, Mapping):
        return ""

    event_type = getattr(chunk.get("type"), "value", chunk.get("type"))
    event_type = str(event_type or "")
    if event_type == "error":
        error = chunk.get("error", {})
    elif event_type == "response.failed":
        response = chunk.get("response", {})
        error = value_at(response, "error", {})
    else:
        return ""

    message = value_at(error, "message", "")
    if isinstance(message, str) and message:
        return message
    code = value_at(error, "code", "")
    if isinstance(code, str) and code:
        return code
    return "Upstream request failed"


def raise_for_stream_failure(chunk: Any) -> None:
    message = stream_failure_message(chunk)
    if message:
        raise LLMStreamError(message)


def configure_litellm_stream_error_handling() -> None:
    global _litellm_stream_error_patch_installed

    if _litellm_stream_error_patch_installed:
        return
    try:
        from litellm.completion_extras.litellm_responses_transformation.transformation import (
            OpenAiResponsesToChatCompletionStreamIterator,
        )
    except Exception:
        return

    if getattr(
        OpenAiResponsesToChatCompletionStreamIterator,
        "_flowent_stream_error_patch_installed",
        False,
    ):
        _litellm_stream_error_patch_installed = True
        return

    transformer = cast(Any, OpenAiResponsesToChatCompletionStreamIterator)
    original = transformer.translate_responses_chunk_to_openai_stream

    def translate_responses_chunk_to_openai_stream(parsed_chunk: Any) -> Any:
        raise_for_stream_failure(parsed_chunk)
        return original(parsed_chunk)

    transformer.translate_responses_chunk_to_openai_stream = staticmethod(
        translate_responses_chunk_to_openai_stream
    )
    transformer._flowent_stream_error_patch_installed = True
    _litellm_stream_error_patch_installed = True


def unique_model_names(provider: ProviderFormat, models: Sequence[str]) -> list[str]:
    seen: set[str] = set()
    normalized_models: list[str] = []
    for model in models:
        normalized_model = normalize_provider_model_name(provider, model)
        if normalized_model in seen:
            continue
        seen.add(normalized_model)
        normalized_models.append(normalized_model)
    return normalized_models


def list_provider_models(
    *,
    provider: ProviderFormat,
    secret_reference: str,
    base_url: str | None = None,
    model_lister: ModelListCallable | None = None,
) -> list[str]:
    if model_lister is None:
        from litellm import get_valid_models

        configure_litellm_logging()
        model_lister = get_valid_models

    models = model_lister(
        api_base=normalize_provider_base_url(provider, base_url),
        api_key=secret_reference,
        check_provider_endpoint=True,
        custom_llm_provider=provider_litellm_name(provider),
    )
    return unique_model_names(provider, models)


def normalize_system_messages(
    messages: Sequence[Mapping[str, Any]],
    provider: ProviderFormat,
) -> list[dict[str, Any]]:
    normalized_messages = [dict(message) for message in messages]
    if provider in {ProviderFormat.ANTHROPIC, ProviderFormat.GEMINI}:
        return [
            {**message, "role": "user"}
            if message.get("role") == "system" and index > 0
            else message
            for index, message in enumerate(normalized_messages)
        ]
    return normalized_messages


def build_litellm_request(
    connection: ProviderConnection,
    messages: Sequence[ChatMessage | Mapping[str, Any]],
    *,
    stream: bool = False,
    tools: Sequence[Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    request_messages = normalize_system_messages(
        [
            message.model_dump() if isinstance(message, ChatMessage) else dict(message)
            for message in messages
        ],
        connection.provider,
    )
    request: dict[str, Any] = {
        "api_key": connection.secret_reference,
        "messages": request_messages,
        "model": provider_model_name(connection),
    }
    if tools:
        request["tools"] = list(tools)
    if stream:
        request["stream"] = True
        request["stream_options"] = {"include_usage": True}
    normalized_base_url = normalize_provider_base_url(
        connection.provider, connection.base_url
    )
    if normalized_base_url:
        request["api_base"] = normalized_base_url
    if connection.reasoning_effort != ReasoningEffort.DEFAULT:
        request["reasoning_effort"] = connection.reasoning_effort.value
    logger.log(
        TRACE_LEVEL,
        "Built LiteLLM request provider=%s model=%s base_url=%s stream=%s tools=%s reasoning_effort=%s messages=%r",
        connection.provider,
        connection.model,
        normalized_base_url or "",
        stream,
        bool(tools),
        connection.reasoning_effort,
        request_messages,
    )
    return request


def record_litellm_request_diagnostic(
    connection: ProviderConnection,
    request: Mapping[str, Any],
) -> None:
    write_llm_request_diagnostic(
        {
            "base_url": request.get("api_base"),
            "litellm_model": request["model"],
            "messages": request["messages"],
            "model": connection.model,
            "provider": connection.provider.value,
            "reasoning_effort": connection.reasoning_effort.value,
            "stream": request.get("stream", False),
            "tools": request.get("tools", []),
        }
    )


async def complete_chat(
    connection: ProviderConnection,
    messages: Sequence[ChatMessage | Mapping[str, Any]],
    *,
    completion: CompletionCallable | None = None,
    tools: Sequence[Mapping[str, Any]] | None = None,
) -> ChatMessage:
    return (
        await complete_chat_with_usage(
            connection,
            messages,
            completion=completion,
            tools=tools,
        )
    ).message


async def complete_chat_with_usage(
    connection: ProviderConnection,
    messages: Sequence[ChatMessage | Mapping[str, Any]],
    *,
    completion: CompletionCallable | None = None,
    tools: Sequence[Mapping[str, Any]] | None = None,
) -> ChatCompletionResult:
    if completion is None:
        from litellm import acompletion

        configure_litellm_logging()
        completion = acompletion

    logger.debug(
        "Starting LLM completion provider=%s model=%s",
        connection.provider,
        connection.model,
    )
    request = build_litellm_request(connection, messages, tools=tools)
    record_litellm_request_diagnostic(connection, request)
    response = await request_litellm_completion(completion, request)
    logger.log(TRACE_LEVEL, "LLM completion response=%r", response)
    choice = response["choices"][0]["message"]
    return ChatCompletionResult(
        message=ChatMessage(
            role=choice.get("role", "assistant"), content=choice["content"]
        ),
        usage=token_usage_from_response(response),
    )


def value_at(value: Any, key: str, default: Any = None) -> Any:
    if isinstance(value, Mapping):
        return value.get(key, default)
    return getattr(value, key, default)


def chunk_delta_content(chunk: Any) -> str:
    try:
        content = chunk.choices[0].delta.content
    except (AttributeError, IndexError, TypeError):
        try:
            content = chunk["choices"][0]["delta"].get("content")
        except (KeyError, IndexError, TypeError, AttributeError):
            return ""
    return content if isinstance(content, str) else ""


def chunk_delta_reasoning(chunk: Any) -> str:
    try:
        choice = chunk.choices[0]
        delta = choice.delta
    except (AttributeError, IndexError, TypeError):
        try:
            delta = chunk["choices"][0]["delta"]
        except (KeyError, IndexError, TypeError):
            return ""

    content = value_at(delta, "reasoning_content", "")
    if isinstance(content, str) and content:
        return content

    return reasoning_text_from_items(
        [
            *list(value_at(delta, "thinking_blocks", []) or []),
            *list(value_at(delta, "reasoning_items", []) or []),
        ]
    )


def reasoning_text_from_items(items: Sequence[Any]) -> str:
    parts: list[str] = []
    for item in items:
        for key in ["thinking", "text", "content", "summary"]:
            value = value_at(item, key, "")
            if isinstance(value, str) and value:
                parts.append(value)
            elif isinstance(value, Sequence) and not isinstance(
                value, str | bytes | bytearray
            ):
                parts.append(reasoning_text_from_items(value))
    return "".join(parts)


def chunk_delta_tool_calls(chunk: Any) -> list[ToolCallDelta]:
    try:
        choice = chunk.choices[0]
        delta = choice.delta
    except (AttributeError, IndexError, TypeError):
        try:
            delta = chunk["choices"][0]["delta"]
        except (KeyError, IndexError, TypeError):
            return []

    raw_tool_calls = value_at(delta, "tool_calls", [])
    if not raw_tool_calls:
        return []

    tool_call_deltas: list[ToolCallDelta] = []
    for position, raw_tool_call in enumerate(raw_tool_calls):
        function = value_at(raw_tool_call, "function", {})
        index = value_at(raw_tool_call, "index", position)
        tool_call_deltas.append(
            ToolCallDelta(
                arguments=value_at(function, "arguments", "") or "",
                id=value_at(raw_tool_call, "id", "") or "",
                index=index if isinstance(index, int) else position,
                name=value_at(function, "name", "") or "",
                type=value_at(raw_tool_call, "type", "function") or "function",
            )
        )
    return tool_call_deltas


def chunk_token_usage(chunk: Any) -> TokenUsage | None:
    return token_usage_from_response(chunk)


async def stream_chat_chunks(
    connection: ProviderConnection,
    messages: Sequence[ChatMessage | Mapping[str, Any]],
    *,
    completion: CompletionCallable | None = None,
    tools: Sequence[Mapping[str, Any]] | None = None,
) -> AsyncIterator[Any]:
    if completion is None:
        from litellm import acompletion

        configure_litellm_logging()
        configure_litellm_stream_error_handling()
        completion = acompletion

    logger.debug(
        "Starting streaming LLM completion provider=%s model=%s",
        connection.provider,
        connection.model,
    )
    request = build_litellm_request(connection, messages, stream=True, tools=tools)
    record_litellm_request_diagnostic(connection, request)
    for attempt_number in range(LLM_RETRY_LIMIT + 1):
        yielded_chunk = False
        try:
            response = await completion(**request)
            async for chunk in response:
                raise_for_stream_failure(chunk)
                logger.log(TRACE_LEVEL, "LLM stream chunk=%r", chunk)
                yielded_chunk = True
                yield chunk
            return
        except Exception:
            if yielded_chunk or attempt_number >= LLM_RETRY_LIMIT:
                raise
            await wait_before_llm_retry(attempt_number + 1)


async def stream_chat(
    connection: ProviderConnection,
    messages: Sequence[ChatMessage | Mapping[str, Any]],
    *,
    completion: CompletionCallable | None = None,
) -> AsyncIterator[str]:
    async for chunk in stream_chat_chunks(connection, messages, completion=completion):
        content = chunk_delta_content(chunk)
        if content:
            yield content
