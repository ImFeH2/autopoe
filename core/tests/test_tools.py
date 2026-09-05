from __future__ import annotations

from pathlib import Path

import pytest

from huddol.adapters.files.tree import MarkdownTree
from huddol.adapters.sandbox.native import NativeSandbox
from huddol.adapters.sqlite.agent import SqliteAgentStore
from huddol.adapters.sqlite.store import SqliteStore
from huddol.core.errors import DomainError
from huddol.tools import AgentTools, Dependencies, TurnBinding
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


@pytest.mark.parametrize(
    ("watermark", "expected"),
    [(0, [3, 4, 5]), (2, [1, 2, 3, 4, 5])],
)
def test_reading_a_mention_preserves_context_boundaries(
    world, watermark: int, expected: list[int]
) -> None:
    human = tools_for(world, HUMAN)
    room = human.create_discussion("context", [MAIN, OTHER])
    for body in (
        "Earlier background",
        "@Other handle another item",
        "Background for this item",
        "@Main please look",
        "More details",
    ):
        human.send_message(room["id"], body)
    tools_for(world, OTHER).send_message(room["id"], "A different sender")
    world.store.set_watermark(room["id"], MAIN, watermark)

    result = tools_for(world, MAIN).read_discussion(room["id"], message_id=4)

    assert result["read_through"] == watermark
    assert [item["id"] for item in result["messages"]] == expected


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


@pytest.mark.parametrize("member_id", [HUMAN, MAIN])
def test_members_only_revoke_their_own_acknowledgements(world, member_id: int) -> None:
    room = tools_for(world, HUMAN).create_discussion("review", [MAIN, OTHER])
    tools_for(world, OTHER).send_message(room["id"], "@You @Main please review")
    for actor in (HUMAN, MAIN):
        tools = tools_for(world, actor)
        tools.read_discussion(room["id"])
        tools.ack(room["id"], [1])
    tools = tools_for(world, member_id)
    assert tools.read_discussion(room["id"])["acknowledged"] == [1]

    assert tools.revoke_ack(room["id"], [1])["revoked"] == 1

    own = tools.read_discussion(room["id"])
    assert own["acknowledged"] == []
    assert own["awaiting_ack"] == [1]
    other = MAIN if member_id == HUMAN else HUMAN
    assert world.store.acknowledged(room["id"], other) == (1,)
    assert tools.revoke_ack(room["id"], [1])["revoked"] == 0
    world.store.set_discussion_members(room["id"], [other, OTHER])
    with pytest.raises(DomainError, match="do not belong"):
        tools.revoke_ack(room["id"], [1])


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


def test_read_reports_what_is_waiting_for_you(world) -> None:
    human = tools_for(world, HUMAN)
    room = human.create_discussion("waiting", [MAIN])
    human.send_message(room["id"], "background")
    world.store.append_message(room["id"], MAIN, "@You please confirm")

    result = human.read_discussion(room["id"])
    assert result["awaiting_ack"] == [2]

    human.ack(room["id"], [2])
    assert human.read_discussion(room["id"])["awaiting_ack"] == []


def test_read_reports_the_position_you_had_reached_before_reading(world) -> None:
    human = tools_for(world, HUMAN)
    room = human.create_discussion("watermark", [MAIN])
    world.store.append_message(room["id"], MAIN, "one")
    world.store.append_message(room["id"], MAIN, "two")

    first = human.read_discussion(room["id"])
    assert first["read_through"] == 0

    world.store.append_message(room["id"], MAIN, "three")
    second = human.read_discussion(room["id"])
    assert second["read_through"] == 2
    assert second["awaiting_ack"] == []


def test_awaiting_ack_only_covers_the_discussion_you_read(world) -> None:
    human = tools_for(world, HUMAN)
    first = human.create_discussion("first", [MAIN])
    second = human.create_discussion("second", [MAIN])
    world.store.append_message(first["id"], MAIN, "@You here")
    world.store.append_message(second["id"], MAIN, "@You and here")

    assert human.read_discussion(first["id"])["awaiting_ack"] == [1]
    assert human.read_discussion(second["id"])["awaiting_ack"] == [1]


def test_a_turn_records_what_it_produced(world) -> None:
    tools = tools_for(world, MAIN, turn=TurnBinding(MAIN, 1))
    discussion = tools.create_discussion("Work", [OTHER])["id"]
    sent = tools.send_message(discussion, "Starting now")["id"]
    tools.run(["echo", "hi"])
    tools.write_library("notes.md", "content")

    recorded = world.history.effects(MAIN, sequences=[1])
    assert [item.tool for item in recorded] == [
        "send",
        "run",
        "library.write",
    ]
    assert str(sent) in recorded[0].summary


def test_tools_outside_a_turn_record_nothing(world) -> None:
    tools = tools_for(world, MAIN)
    discussion = tools.create_discussion("Work", [OTHER])["id"]
    tools.send_message(discussion, "Starting now")
    assert world.history.effects(MAIN) == ()


def test_an_acknowledging_turn_is_not_counted_as_productive(world) -> None:
    from huddol.core.turn import is_productive

    author = tools_for(world, OTHER)
    discussion = author.create_discussion("Work", [MAIN])["id"]
    message = author.send_message(discussion, "@Main please look")["id"]

    tools = tools_for(world, MAIN, turn=TurnBinding(MAIN, 1))
    tools.read_discussion(discussion, message)
    tools.ack(discussion, [message])

    recorded = world.history.effects(MAIN, sequences=[1])
    assert [item.tool for item in recorded] == ["ack"]
    assert not is_productive([item.tool for item in recorded])
