from __future__ import annotations

import asyncio
from pathlib import Path

from pydantic_ai.models.test import TestModel

from flowent.models import ModelSelection, ModelStore, resolve_model
from flowent.project import Project
from flowent.providers import ProviderStore
from flowent.runtime import AgentRuntime


def test_model_store_persists_the_default_model(tmp_path: Path) -> None:
    async def run() -> None:
        store = ModelStore(tmp_path)
        await store.initialize()
        selection = await store.save("provider-1", "model-1")

        assert selection == ModelSelection("provider-1", "model-1")
        assert await ModelStore(tmp_path).get() == selection
        assert await store.clear_provider("provider-1")
        assert await store.get() is None

    asyncio.run(run())


def test_model_resolver_uses_provider_configuration(tmp_path: Path) -> None:
    async def run() -> None:
        providers = ProviderStore(tmp_path)
        await providers.initialize()
        provider = await providers.save(
            None,
            "Local",
            "openai-compatible",
            "http://localhost:11434/v1",
        )
        requested: list[str] = []

        async def provider_secret(provider_id: str) -> None:
            requested.append(provider_id)

        model = await resolve_model(
            ModelSelection(provider.id, "local-model"),
            providers,
            provider_secret,
        )

        assert type(model).__name__ == "OpenAIChatModel"
        assert requested == [provider.id]

    asyncio.run(run())


def test_agent_runtime_streams_with_the_resolved_model(tmp_path: Path) -> None:
    async def run() -> None:
        emitted: list[dict[str, object]] = []

        async def model() -> TestModel:
            return TestModel(custom_output_text="Flowent")

        runtime = AgentRuntime(
            tmp_path,
            Project("project-1", "Project", tmp_path),
            emitted.append,
            "test",
            model,
        )

        await runtime.run_turn("Hello")

        events = [
            message["params"]["event"]
            for message in emitted
            if message.get("method") == "turn/event"
        ]
        assert (
            "".join(
                event["content"] for event in events if event["kind"] == "text_delta"
            )
            == "Flowent"
        )
        assert runtime.state()["messages"][-1]["status"] == "complete"
        assert runtime.agent_info()["status"] == "idle"

    asyncio.run(run())
