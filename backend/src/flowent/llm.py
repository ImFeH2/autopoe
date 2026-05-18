from collections.abc import AsyncIterator, Awaitable, Sequence
from enum import StrEnum
from typing import Any, Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field


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


class CompletionCallable(Protocol):
    def __call__(self, **kwargs: Any) -> Awaitable[Any]: ...


class ModelListCallable(Protocol):
    def __call__(self, **kwargs: Any) -> Sequence[str]: ...


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
    messages: Sequence[ChatMessage],
    *,
    stream: bool = False,
) -> dict[str, Any]:
    request: dict[str, Any] = {
        "api_key": connection.secret_reference,
        "messages": [message.model_dump() for message in messages],
        "model": provider_model_name(connection),
    }
    if stream:
        request["stream"] = True
    if connection.base_url:
        request["api_base"] = connection.base_url
    return request


async def complete_chat(
    connection: ProviderConnection,
    messages: Sequence[ChatMessage],
    *,
    completion: CompletionCallable | None = None,
) -> ChatMessage:
    if completion is None:
        from litellm import acompletion

        completion = acompletion

    response = await completion(**build_litellm_request(connection, messages))
    choice = response["choices"][0]["message"]
    return ChatMessage(role=choice.get("role", "assistant"), content=choice["content"])


def chunk_delta_content(chunk: Any) -> str:
    try:
        content = chunk.choices[0].delta.content
    except (AttributeError, IndexError, TypeError):
        try:
            content = chunk["choices"][0]["delta"].get("content")
        except (KeyError, IndexError, TypeError, AttributeError):
            return ""
    return content if isinstance(content, str) else ""


async def stream_chat(
    connection: ProviderConnection,
    messages: Sequence[ChatMessage],
    *,
    completion: CompletionCallable | None = None,
) -> AsyncIterator[str]:
    if completion is None:
        from litellm import acompletion

        completion = acompletion

    response = await completion(
        **build_litellm_request(connection, messages, stream=True)
    )
    async for chunk in response:
        content = chunk_delta_content(chunk)
        if content:
            yield content
