from __future__ import annotations

import asyncio
from pathlib import Path

from pydantic_ai import Agent
from pydantic_ai.models.test import TestModel
from pydantic_core import to_jsonable_python

from flowent.collaboration import CollaborationStore
from flowent.project import Project, ProjectStore


async def open_project(data_dir: Path, name: str = "workspace") -> Project:
    workspace = data_dir / name
    workspace.mkdir()
    projects = ProjectStore(data_dir)
    await projects.initialize()
    return await projects.open(str(workspace))


def test_collaboration_store_creates_the_project_leader_and_general_chat(
    tmp_path: Path,
) -> None:
    async def run() -> None:
        project = await open_project(tmp_path)
        store = CollaborationStore(tmp_path)
        await store.initialize()

        snapshot = await store.open_project(project.id)

        assert snapshot.agent.id == "leader"
        assert snapshot.agent.kind == "leader"
        assert snapshot.chat.title == "General"
        assert snapshot.messages == []
        assert snapshot.last_turn is None
        assert snapshot.history == []

    asyncio.run(run())


def test_collaboration_store_persists_messages_turns_and_model_history(
    tmp_path: Path,
) -> None:
    async def run() -> None:
        project = await open_project(tmp_path)
        store = CollaborationStore(tmp_path)
        await store.initialize()
        initial = await store.open_project(project.id)
        start = await store.start_turn(
            project.id,
            initial.agent.id,
            initial.chat.id,
            "Hello",
            "Be concise",
            [],
            ["read_home_file"],
        )
        result = await Agent().run(
            "Hello",
            model=TestModel(custom_output_text="Flowent"),
        )
        history = result.all_messages()
        start.snapshot["status"] = "completed"
        start.snapshot["context"]["messages"] = to_jsonable_python(history)
        start.snapshot["events"].append({"kind": "completed"})
        await store.complete_turn(
            project.id,
            initial.agent.id,
            start.agent_message.id,
            "Flowent",
            start.snapshot,
            history,
        )

        restored = await CollaborationStore(tmp_path).snapshot(project.id)

        assert [message.content for message in restored.messages] == [
            "Hello",
            "Flowent",
        ]
        assert restored.messages[-1].status == "complete"
        assert restored.last_turn is not None
        assert restored.last_turn["status"] == "completed"
        assert restored.history == history

    asyncio.run(run())


def test_collaboration_store_recovers_interrupted_turns(tmp_path: Path) -> None:
    async def run() -> None:
        project = await open_project(tmp_path)
        store = CollaborationStore(tmp_path)
        await store.initialize()
        initial = await store.open_project(project.id)
        await store.start_turn(
            project.id,
            initial.agent.id,
            initial.chat.id,
            "Hello",
            "",
            [],
            ["read_home_file"],
        )

        restarted = CollaborationStore(tmp_path)
        await restarted.initialize()
        restored = await restarted.snapshot(project.id)

        assert restored.last_turn is not None
        assert restored.last_turn["status"] == "interrupted"
        assert restored.last_turn["error"] == "Runtime interrupted"
        assert restored.messages[-1].status == "interrupted"
        assert restored.messages[-1].content == "Runtime interrupted"

    asyncio.run(run())


def test_collaboration_store_isolates_projects(tmp_path: Path) -> None:
    async def run() -> None:
        first_project = await open_project(tmp_path, "first")
        second_project = await open_project(tmp_path, "second")
        store = CollaborationStore(tmp_path)
        await store.initialize()
        first = await store.open_project(first_project.id)
        await store.open_project(second_project.id)
        turn = await store.start_turn(
            first_project.id,
            first.agent.id,
            first.chat.id,
            "Hello",
            "",
            [],
            ["read_home_file"],
        )
        turn.snapshot["status"] = "failed"
        turn.snapshot["error"] = "Failed"
        turn.snapshot["events"].append({"kind": "failed", "message": "Failed"})
        await store.fail_turn(turn.agent_message.id, "Failed", turn.snapshot)

        assert len((await store.snapshot(first_project.id)).messages) == 2
        assert (await store.snapshot(second_project.id)).messages == []

    asyncio.run(run())
