from __future__ import annotations

import asyncio
import sqlite3
from pathlib import Path

import pytest

from flowent.collaboration import CollaborationStore
from flowent.project import Project, ProjectStore


async def open_store(tmp_path: Path) -> tuple[Project, CollaborationStore, str]:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    projects = ProjectStore(tmp_path)
    await projects.initialize()
    project = await projects.open(str(workspace))
    store = CollaborationStore(tmp_path)
    await store.initialize()
    await store.open_project(project.id)
    worker = await store.create_worker(project.id, "Backend Engineer", "Backend")
    return project, store, worker.id


def test_chat_store_manages_custom_chat_lifecycle(tmp_path: Path) -> None:
    async def run() -> None:
        project, store, worker_id = await open_store(tmp_path)

        chat = await store.chat_store.create_chat(
            project.id,
            " Architecture ",
            " Decisions ",
            ["leader", worker_id],
            "user",
        )

        assert chat.title == "Architecture"
        assert chat.purpose == "Decisions"
        assert chat.members == ("leader", worker_id)
        assert [
            item.kind for item in await store.chat_store.list_chats(project.id)
        ] == ["general", "custom"]
        with pytest.raises(ValueError, match="already exists"):
            await store.chat_store.create_chat(
                project.id,
                "architecture",
                "Duplicate",
                ["leader"],
                "user",
            )

        updated = await store.chat_store.update_chat(
            project.id,
            chat.id,
            "Platform",
            "Interfaces",
            ["leader"],
        )
        assert updated.members == ("leader",)
        with pytest.raises(ValueError, match="cannot be edited"):
            await store.chat_store.update_chat(
                project.id,
                (await store.chat_store.list_chats(project.id))[0].id,
                "General",
                "",
                ["leader"],
            )

        owned = await store.chat_store.create_chat(
            project.id,
            "Worker room",
            "Coordination",
            ["leader"],
            worker_id,
        )
        assert worker_id in owned.members
        await store.archive_worker(project.id, worker_id)
        reassigned = await store.chat_store.update_chat(
            project.id,
            owned.id,
            "Worker room",
            "Coordination",
            ["leader"],
        )
        assert reassigned.members == ("leader",)

        orphan = await store.create_worker(project.id, "Writer", "Writing")
        orphaned_chat = await store.chat_store.create_chat(
            project.id,
            "Draft",
            "Writing",
            [orphan.id],
            "user",
        )
        await store.archive_worker(project.id, orphan.id)
        visible_orphan = await store.chat_store.get_chat(
            project.id,
            orphaned_chat.id,
        )
        assert visible_orphan.members == ()

        await store.chat_store.close_chat(project.id, chat.id)

        assert [
            item.title for item in await store.chat_store.list_chats(project.id)
        ] == ["General", "Draft", "Worker room"]
        archived = await store.chat_store.list_chats(
            project.id,
            include_closed=True,
        )
        assert next(item for item in archived if item.id == chat.id).closed

    asyncio.run(run())


def test_chat_store_tracks_processing_explicitly(tmp_path: Path) -> None:
    async def run() -> None:
        project, store, worker_id = await open_store(tmp_path)
        chat = await store.chat_store.create_chat(
            project.id,
            "Bug",
            "Diagnosis",
            ["leader", worker_id],
            "user",
        )
        user_message = await store.chat_store.send_message(
            project.id,
            chat.id,
            "user",
            "Investigate the failure",
        )
        leader_message = await store.chat_store.send_message(
            project.id,
            chat.id,
            "leader",
            "I will inspect the runtime",
        )

        first_read = await store.chat_store.read_chat(project.id, chat.id, "leader")
        second_read = await store.chat_store.read_chat(project.id, chat.id, "leader")
        worker_read = await store.chat_store.read_chat(
            project.id,
            chat.id,
            worker_id,
        )

        assert [message["processing"] for message in first_read["messages"]] == [
            "pending",
            "processed",
        ]
        assert second_read == first_read
        assert [message["processing"] for message in worker_read["messages"]] == [
            "pending",
            "pending",
        ]
        assert (await store.chat_store.list_agent_chats(project.id, "leader"))[1][
            "pending"
        ] == 1

        assert (
            await store.chat_store.mark_processed(
                project.id,
                chat.id,
                "leader",
                user_message.id,
            )
            == 1
        )
        assert (
            await store.chat_store.mark_processed(
                project.id,
                chat.id,
                worker_id,
                leader_message.id,
            )
            == 2
        )
        assert (await store.chat_store.list_agent_chats(project.id, worker_id))[1][
            "pending"
        ] == 0

        with sqlite3.connect(tmp_path / "flowent.db") as database:
            database.execute("DELETE FROM message_processing")
        await store.initialize()

        restored = await store.chat_store.read_chat(project.id, chat.id, worker_id)
        assert {message["processing"] for message in restored["messages"]} == {
            "processed"
        }

    asyncio.run(run())
