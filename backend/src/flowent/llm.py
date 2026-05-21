import logging
from collections.abc import AsyncIterator, Awaitable, Mapping, Sequence
from enum import StrEnum
from typing import Any, Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field

from flowent.logging import TRACE_LEVEL, configure_litellm_logging


class ProviderFormat(StrEnum):
    OPENAI = "openai"
    OPENAI_RESPONSES = "openai_responses"
    ANTHROPIC = "anthropic"
    GEMINI = "gemini"


class ProviderConnection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1)
    provider: ProviderFormat
    model: str = Field(min_length=1)
    secret_reference: str = Field(min_length=1)
    base_url: str | None = None


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


class CompletionCallable(Protocol):
    def __call__(self, **kwargs: Any) -> Awaitable[Any]: ...


class ModelListCallable(Protocol):
    def __call__(self, **kwargs: Any) -> Sequence[str]: ...


logger = logging.getLogger("flowent.llm")


MODEL_PREFIXES: dict[ProviderFormat, str] = {
    ProviderFormat.OPENAI: "openai",
    ProviderFormat.OPENAI_RESPONSES: "openai",
    ProviderFormat.ANTHROPIC: "anthropic",
    ProviderFormat.GEMINI: "gemini",
}


def provider_model_name(connection: ProviderConnection) -> str:
    return f"{MODEL_PREFIXES[connection.provider]}/{connection.model}"


def provider_litellm_name(provider: ProviderFormat) -> str:
    return MODEL_PREFIXES[provider]


def normalize_provider_model_name(provider: ProviderFormat, model: str) -> str:
    prefix = f"{provider_litellm_name(provider)}/"
    if model.startswith(prefix):
        return model.removeprefix(prefix)
    return model


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
        api_base=base_url,
        api_key=secret_reference,
        check_provider_endpoint=True,
        custom_llm_provider=provider_litellm_name(provider),
    )
    return unique_model_names(provider, models)


def build_litellm_request(
    connection: ProviderConnection,
    messages: Sequence[ChatMessage | Mapping[str, Any]],
    *,
    stream: bool = False,
    tools: Sequence[Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    request_messages = [
        message.model_dump() if isinstance(message, ChatMessage) else dict(message)
        for message in messages
    ]
    request: dict[str, Any] = {
        "api_key": connection.secret_reference,
        "messages": request_messages,
        "model": provider_model_name(connection),
    }
    if tools:
        request["tools"] = list(tools)
    if stream:
        request["stream"] = True
    if connection.base_url:
        request["api_base"] = connection.base_url
    logger.log(
        TRACE_LEVEL,
        "Built LiteLLM request provider=%s model=%s base_url=%s stream=%s tools=%s messages=%r",
        connection.provider,
        connection.model,
        connection.base_url or "",
        stream,
        bool(tools),
        request_messages,
    )
    return request


async def complete_chat(
    connection: ProviderConnection,
    messages: Sequence[ChatMessage | Mapping[str, Any]],
    *,
    completion: CompletionCallable | None = None,
    tools: Sequence[Mapping[str, Any]] | None = None,
) -> ChatMessage:
    if completion is None:
        from litellm import acompletion

        configure_litellm_logging()
        completion = acompletion

    logger.debug(
        "Starting LLM completion provider=%s model=%s",
        connection.provider,
        connection.model,
    )
    response = await completion(
        **build_litellm_request(connection, messages, tools=tools)
    )
    logger.log(TRACE_LEVEL, "LLM completion response=%r", response)
    choice = response["choices"][0]["message"]
    return ChatMessage(role=choice.get("role", "assistant"), content=choice["content"])


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
        completion = acompletion

    logger.debug(
        "Starting streaming LLM completion provider=%s model=%s",
        connection.provider,
        connection.model,
    )
    response = await completion(
        **build_litellm_request(connection, messages, stream=True, tools=tools)
    )
    async for chunk in response:
        logger.log(TRACE_LEVEL, "LLM stream chunk=%r", chunk)
        yield chunk


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
