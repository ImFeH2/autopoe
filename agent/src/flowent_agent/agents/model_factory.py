import asyncio
import json
from collections.abc import AsyncIterator

from pydantic_ai.messages import ModelMessage, ModelRequest, UserPromptPart
from pydantic_ai.models import Model
from pydantic_ai.models.anthropic import AnthropicModel
from pydantic_ai.models.function import AgentInfo, FunctionModel
from pydantic_ai.models.openai import OpenAIChatModel, OpenAIResponsesModel
from pydantic_ai.providers.anthropic import AnthropicProvider
from pydantic_ai.providers.openai import OpenAIProvider

from flowent_agent.agents.models import ModelConfiguration


def create_model(configuration: ModelConfiguration) -> Model:
    if configuration.provider == "default":
        raise ValueError("Default model configuration must be resolved before use")
    if configuration.provider == "demo":
        return FunctionModel(
            stream_function=stream_demo_response,
            model_name=configuration.model,
        )

    api_key = (
        configuration.api_key.get_secret_value()
        if configuration.api_key is not None
        else None
    )
    if configuration.provider in {"openai", "openai_compatible"}:
        provider = OpenAIProvider(
            api_key=api_key,
            base_url=configuration.base_url,
        )
        if configuration.api_mode == "chat":
            return OpenAIChatModel(configuration.model, provider=provider)
        return OpenAIResponsesModel(configuration.model, provider=provider)

    provider = AnthropicProvider(
        api_key=api_key,
        base_url=configuration.base_url,
    )
    return AnthropicModel(configuration.model, provider=provider)


async def stream_demo_response(
    messages: list[ModelMessage],
    _: AgentInfo,
) -> AsyncIterator[str]:
    prompts = extract_user_prompts(messages)
    latest = prompts[-1] if prompts else ""
    if "respond with json" in latest.lower():
        response = json.dumps(
            {
                "approved": True,
                "findings": [],
                "summary": "Demo verification passed",
            },
            separators=(",", ":"),
        )
        for chunk in chunk_text(response):
            await asyncio.sleep(0.012)
            yield chunk
        return
    preview = latest[:96]
    suffix = "…" if len(latest) > 96 else ""
    if len(prompts) > 1:
        response = (
            f"I received “{preview}{suffix}” as turn {len(prompts)}. "
            "This response is running through the Python Agent loop and streaming "
            "over stdio JSONL."
        )
    else:
        response = (
            f"I received “{preview}{suffix}”. This response is running through the "
            "Python Agent loop and streaming over stdio JSONL."
        )
    for chunk in chunk_text(response):
        await asyncio.sleep(0.012)
        yield chunk


def extract_user_prompts(messages: list[ModelMessage]) -> list[str]:
    prompts: list[str] = []
    for message in messages:
        if not isinstance(message, ModelRequest):
            continue
        for part in message.parts:
            if isinstance(part, UserPromptPart) and isinstance(part.content, str):
                prompts.append(part.content)
    return prompts


def chunk_text(value: str) -> list[str]:
    chunks = value.split(" ")
    return [
        chunk if index == len(chunks) - 1 else f"{chunk} "
        for index, chunk in enumerate(chunks)
    ]
