from __future__ import annotations

from pathlib import Path

import pytest

from huddol.adapters.files.tree import MarkdownTree
from huddol.adapters.sandbox.native import NativeSandbox
from huddol.adapters.sqlite.agent import SqliteAgentStore
from huddol.adapters.sqlite.store import SqliteStore
from huddol.core.errors import DomainError
from huddol.tools import AgentTools, Dependencies
from huddol.tools.authorize import Actor, Authorizer

HUMAN = 1
MAIN = 2
OTHER = 3


@pytest.fixture
def world(tmp_path: Path):
    store = SqliteStore(tmp_path / "huddol.sqlite3")
    agent_store = SqliteAgentStore(store._db)
    store.create_member("human", "You")
    store.create_member("agent", "Main")
    store.create_member("agent", "Other")
    deps = Dependencies(
        store=store,
        todos=agent_store,
        history=agent_store,
        settings=agent_store,
        sandbox=NativeSandbox(tmp_path, [str(tmp_path)], enforce=False),
        library_tree=MarkdownTree(tmp_path / "library"),
        memory_tree_for=lambda member_id: MarkdownTree(
            tmp_path / "agents" / str(member_id) / "memory"
        ),
    )
    yield deps
    store.close()


def tools_for(deps: Dependencies, member_id: int, **kwargs) -> AgentTools:
    member = deps.store.get_member(member_id)
    assert member is not None
    return AgentTools(deps, Actor(member_id, member.is_agent), **kwargs)


def test_creating_a_discussion_always_includes_the_creator(world) -> None:
    tools = tools_for(world, HUMAN)
    room = tools.create_discussion("plan the rewrite", [MAIN])
    assert room["member_ids"] == [HUMAN, MAIN]


def test_a_discussion_needs_at_least_one_other_member(world) -> None:
    with pytest.raises(DomainError) as error:
        tools_for(world, HUMAN).create_discussion("alone", [HUMAN])
    assert error.value.code == "needs_members"


def test_non_members_cannot_read_or_send(world) -> None:
    room = tools_for(world, HUMAN).create_discussion("private", [MAIN])
    outsider = tools_for(world, OTHER)
    with pytest.raises(DomainError) as error:
        outsider.read_discussion(room["id"])
    assert error.value.code == "not_a_member"
    with pytest.raises(DomainError):
        outsider.send_message(room["id"], "hello")


def test_reading_a_mention_returns_surrounding_context(world) -> None:
    human = tools_for(world, HUMAN)
    room = human.create_discussion("context", [MAIN])
    human.send_message(room["id"], "background one")
    human.send_message(room["id"], "background two")
    human.send_message(room["id"], "@Main please look")

    result = tools_for(world, MAIN).read_discussion(room["id"], message_id=3)
    assert [item["id"] for item in result["messages"]] == [1, 2, 3]
    assert result["total_messages"] == 3


def test_reading_advances_the_watermark_and_clears_unread(world) -> None:
    human = tools_for(world, HUMAN)
    room = human.create_discussion("unread", [MAIN])
    human.send_message(room["id"], "@Main hello")

    agent = tools_for(world, MAIN)
    assert agent.list_discussions()[0]["unread"] == 1
    agent.read_discussion(room["id"], message_id=1)
    assert agent.list_discussions()[0]["unread"] == 0


def test_ack_requires_the_message_to_have_been_read(world) -> None:
    human = tools_for(world, HUMAN)
    room = human.create_discussion("ack", [MAIN])
    human.send_message(room["id"], "@Main do this")

    agent = tools_for(world, MAIN)
    with pytest.raises(DomainError) as error:
        agent.ack(room["id"], [1])
    assert error.value.code == "not_read"

    agent.read_discussion(room["id"], message_id=1)
    assert agent.ack(room["id"], [1])["acked"] == 1
    assert world.store.pending(MAIN) == ()


def test_sending_marks_your_own_message_as_read(world) -> None:
    human = tools_for(world, HUMAN)
    room = human.create_discussion("self", [MAIN])
    human.send_message(room["id"], "mine")
    assert human.list_discussions()[0]["unread"] == 0


def test_search_only_returns_discussions_you_belong_to(world) -> None:
    human = tools_for(world, HUMAN)
    mine = human.create_discussion("mine", [MAIN])
    human.send_message(mine["id"], "findme here")

    assert len(tools_for(world, MAIN).search_messages("findme")) == 1
    assert tools_for(world, OTHER).search_messages("findme") == []


def test_duplicate_agent_names_are_rejected(world) -> None:
    with pytest.raises(DomainError) as error:
        tools_for(world, HUMAN).create_agent("main")
    assert error.value.code == "duplicate_name"


def test_running_agents_cannot_be_deleted(world) -> None:
    world.store.set_agent_state(MAIN, "running")
    with pytest.raises(DomainError) as error:
        tools_for(world, HUMAN).delete_agent(MAIN)
    assert error.value.code == "agent_running"

    world.store.set_agent_state(MAIN, "paused")
    assert tools_for(world, HUMAN).delete_agent(MAIN)["deleted"] is True


def test_library_conflict_returns_the_current_content(world) -> None:
    author = tools_for(world, MAIN)
    author.write_library("shared.md", "first")
    result = author.write_library("shared.md", "second", expected_hash="0" * 16)
    assert result["conflict"] is True
    assert result["current_content"] == "first"


def test_memory_is_private_to_each_agent(world) -> None:
    tools_for(world, MAIN).write_memory("notes.md", "mine")
    assert tools_for(world, OTHER).list_memory() == []
    assert len(tools_for(world, MAIN).list_memory()) == 1


def test_library_is_shared_across_members(world) -> None:
    tools_for(world, MAIN).write_library("shared.md", "for everyone")
    assert (
        tools_for(world, OTHER).read_library("shared.md")["content"] == "for everyone"
    )


def test_authorization_hook_can_deny_a_capability(world) -> None:
    def deny_sending(actor, capability, target):
        return "deny" if capability == "discussion.send" else "allow"

    tools = tools_for(world, HUMAN, authorizer=Authorizer(deny_sending))
    room = tools.create_discussion("guarded", [MAIN])
    with pytest.raises(DomainError) as error:
        tools.send_message(room["id"], "blocked")
    assert error.value.code == "not_permitted"


def test_todo_hard_constraint_surfaces_through_the_tool(world) -> None:
    tools = tools_for(world, MAIN)
    first = tools.add_todo("one", "detail one")
    second = tools.add_todo("two")
    tools.start_todo(first["id"])
    with pytest.raises(DomainError) as error:
        tools.start_todo(second["id"])
    assert error.value.code == "todo_already_in_progress"
