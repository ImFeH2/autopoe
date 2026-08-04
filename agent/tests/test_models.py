from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from pydantic_ai import ModelMessage
from pydantic_ai.models.function import AgentInfo, DeltaToolCall, FunctionModel
from pydantic_ai.models.test import TestModel

from flowent.collaboration import CollaborationStore
from flowent.models import ModelSelection, ModelStore, resolve_model
from flowent.project import ProjectStore
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

        workspace = tmp_path / "workspace"
        workspace.mkdir()
        projects = ProjectStore(tmp_path)
        await projects.initialize()
        project = await projects.open(str(workspace))
        collaboration = CollaborationStore(tmp_path)
        await collaboration.initialize()
        snapshot = await collaboration.open_project(project.id)
        runtime = AgentRuntime(
            tmp_path,
            project,
            emitted.append,
            "test",
            model,
            collaboration,
            snapshot,
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

        restored = AgentRuntime(
            tmp_path,
            project,
            emitted.append,
            "test",
            model,
            collaboration,
            await collaboration.snapshot(project.id),
        )
        assert restored.state()["messages"][-1]["content"] == "Flowent"
        assert restored.history == runtime.history

        await restored.run_turn("Again")
        assert len(restored.history) > len(runtime.history)

    asyncio.run(run())


def test_agent_runtime_commits_before_the_completed_notification(
    tmp_path: Path,
) -> None:
    async def run() -> None:
        async def model() -> TestModel:
            return TestModel(custom_output_text="Flowent")

        def emit(message: dict[str, object]) -> None:
            if message.get("method") == "turn/completed":
                raise RuntimeError("desktop connection closed")

        workspace = tmp_path / "workspace"
        workspace.mkdir()
        projects = ProjectStore(tmp_path)
        await projects.initialize()
        project = await projects.open(str(workspace))
        collaboration = CollaborationStore(tmp_path)
        await collaboration.initialize()
        runtime = AgentRuntime(
            tmp_path,
            project,
            emit,
            "test",
            model,
            collaboration,
            await collaboration.open_project(project.id),
        )

        with pytest.raises(RuntimeError, match="desktop connection closed"):
            await runtime.run_turn("Hello")

        restored = await collaboration.snapshot(project.id)
        assert restored.last_turn is not None
        assert restored.last_turn["status"] == "completed"
        assert restored.messages[-1].status == "complete"
        assert restored.history

    asyncio.run(run())


def test_agent_runtime_streams_and_persists_file_tool_events(tmp_path: Path) -> None:
    async def run() -> None:
        emitted: list[dict[str, object]] = []

        async def read_workspace(
            messages: list[ModelMessage],
            info: AgentInfo,
        ) -> AsyncIterator[str | dict[int, DeltaToolCall]]:
            if len(messages) == 1:
                assert {tool.name for tool in info.function_tools} == {
                    "list_files",
                    "read_file",
                    "search_files",
                    "write_file",
                    "replace_in_file",
                }
                yield {
                    0: DeltaToolCall(
                        "read_file",
                        '{"space":"workspace","path":"README.md"}',
                    )
                }
                return
            result = messages[-1].parts[0]
            assert result.part_kind == "tool-return"
            assert result.content["content"] == "Flowent"
            yield "Read Flowent"

        async def model() -> FunctionModel:
            return FunctionModel(stream_function=read_workspace)

        workspace = tmp_path / "workspace"
        workspace.mkdir()
        (workspace / "README.md").write_text("Flowent", encoding="utf-8")
        projects = ProjectStore(tmp_path)
        await projects.initialize()
        project = await projects.open(str(workspace))
        collaboration = CollaborationStore(tmp_path)
        await collaboration.initialize()
        runtime = AgentRuntime(
            tmp_path,
            project,
            emitted.append,
            "test",
            model,
            collaboration,
            await collaboration.open_project(project.id),
        )

        await runtime.run_turn("Read the project")

        restored = await collaboration.snapshot(project.id)
        assert restored.last_turn is not None
        events = restored.last_turn["events"]
        assert [event["kind"] for event in events] == [
            "started",
            "tool_call",
            "tool_result",
            "text_delta",
            "completed",
        ]
        assert events[1]["name"] == "read_file"
        assert events[2]["output"]["content"] == "Flowent"
        assert restored.last_turn["context"]["tools"] == runtime.file_tools.names

    asyncio.run(run())
