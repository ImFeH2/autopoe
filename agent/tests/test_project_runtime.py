from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from pydantic_ai import ModelMessage
from pydantic_ai.models.function import AgentInfo, DeltaToolCall, FunctionModel
from pydantic_ai.models.test import TestModel

from flowent.collaboration import CollaborationStore
from flowent.project import ProjectStore
from flowent.project_runtime import ProjectRuntime


async def deny_approval(_: dict[str, object]) -> bool:
    return False


async def open_runtime(
    tmp_path: Path,
    model,
    emitted: list[dict[str, object]],
) -> ProjectRuntime:
    workspace = tmp_path / "workspace"
    workspace.mkdir(exist_ok=True)
    projects = ProjectStore(tmp_path)
    await projects.initialize()
    project = await projects.open(str(workspace))
    collaboration = CollaborationStore(tmp_path)
    await collaboration.initialize()
    return await ProjectRuntime.open(
        tmp_path,
        project,
        emitted.append,
        "test",
        model,
        deny_approval,
        collaboration,
    )


def test_project_runtime_gives_leader_worker_management_tools(tmp_path: Path) -> None:
    async def run() -> None:
        emitted: list[dict[str, object]] = []

        async def create_worker(
            messages: list[ModelMessage],
            info: AgentInfo,
        ) -> AsyncIterator[str | dict[int, DeltaToolCall]]:
            if len(messages) == 1:
                assert {tool.name for tool in info.function_tools}.issuperset(
                    {"list_workers", "create_worker"}
                )
                yield {
                    0: DeltaToolCall(
                        "create_worker",
                        '{"name":"Backend Engineer","role":"Backend"}',
                        tool_call_id="create-worker-1",
                    )
                }
                return
            result = messages[-1].parts[0]
            assert result.part_kind == "tool-return"
            assert result.content["name"] == "Backend Engineer"
            yield "Worker created"

        async def model() -> FunctionModel:
            return FunctionModel(stream_function=create_worker)

        runtime = await open_runtime(tmp_path, model, emitted)
        await runtime.run_turn("Create a backend worker")

        agents = runtime.agent_infos()
        worker = next(agent for agent in agents if agent["kind"] == "worker")
        worker_runtime = runtime.runtimes[worker["id"]]
        assert [agent["kind"] for agent in agents] == ["leader", "worker"]
        assert runtime.leader.history
        assert worker_runtime.history == []
        assert "create_worker" in runtime.leader.tool_names
        assert "create_worker" not in worker_runtime.tool_names
        assert (Path(worker["home"]) / "AGENTS.md").is_file()
        assert any(message.get("method") == "agents/updated" for message in emitted)

    asyncio.run(run())


def test_project_runtime_updates_archives_and_restores_workers(tmp_path: Path) -> None:
    async def run() -> None:
        emitted: list[dict[str, object]] = []

        async def model() -> TestModel:
            return TestModel(custom_output_text="Flowent")

        runtime = await open_runtime(tmp_path, model, emitted)
        created = await runtime.create_worker("Tester", "Testing")
        worker_id = created["id"]
        updated = await runtime.update_worker(worker_id, "QA Engineer", "Quality")

        restored = await open_runtime(tmp_path, model, emitted)
        restored_worker = next(
            agent for agent in restored.agent_infos() if agent["id"] == worker_id
        )
        assert updated["name"] == "QA Engineer"
        assert restored_worker["role"] == "Quality"
        assert restored_worker["home"] == created["home"]

        await restored.archive_worker(worker_id)
        reopened = await open_runtime(tmp_path, model, emitted)
        assert [agent["id"] for agent in reopened.agent_infos()] == ["leader"]
        assert Path(created["home"]).is_dir()

    asyncio.run(run())


def test_project_runtime_archives_worker_when_runtime_creation_fails(
    tmp_path: Path,
) -> None:
    async def run() -> None:
        async def model() -> TestModel:
            return TestModel(custom_output_text="Flowent")

        runtime = await open_runtime(tmp_path, model, [])

        async def fail(_: object) -> None:
            raise OSError("home unavailable")

        runtime._build = fail  # type: ignore[method-assign]
        with pytest.raises(OSError, match="home unavailable"):
            await runtime.create_worker("Builder", "Implementation")

        active = await runtime.store.list_agents(runtime.project.id)
        all_agents = await runtime.store.list_agents(
            runtime.project.id,
            include_archived=True,
        )
        assert [agent.id for agent in active] == ["leader"]
        assert len(all_agents) == 2
        assert next(agent for agent in all_agents if agent.kind == "worker").archived

    asyncio.run(run())


def test_project_runtime_binds_chat_tools_to_each_agent(tmp_path: Path) -> None:
    async def run() -> None:
        async def model() -> TestModel:
            return TestModel(custom_output_text="Flowent")

        runtime = await open_runtime(tmp_path, model, [])
        worker = await runtime.create_worker("Researcher", "Research")
        worker_runtime = runtime.runtimes[worker["id"]]
        tools = {tool.__name__: tool for tool in worker_runtime.project_tools}

        assert set(tools) == {
            "list_agents",
            "list_chats",
            "create_chat",
            "read_chat",
            "send_message",
            "mark_processed",
        }
        directory = tools["list_agents"]()
        assert set(directory[0]) == {"id", "name", "role", "kind"}
        chat = await tools["create_chat"](
            "Research",
            "Findings",
            ["leader"],
        )
        message = await tools["send_message"](
            chat["id"],
            "Initial findings",
        )
        leader_view = await runtime.read_chat(chat["id"], "leader")

        assert worker["id"] in chat["members"]
        assert message["author"] == worker["id"]
        assert leader_view["messages"][0]["processing"] == "pending"

    asyncio.run(run())
