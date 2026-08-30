from __future__ import annotations

import random
from pathlib import Path

import pytest

from huddol.adapters.sqlite.store import SqliteStore
from huddol.core.mention import Mention
from huddol.core.pending import Ack, ack_keys, pending_for


@pytest.fixture
def store(tmp_path: Path) -> SqliteStore:
    created = SqliteStore(tmp_path / "huddol.sqlite3")
    yield created
    created.close()


def reference_pending(store: SqliteStore, member_id: int) -> tuple[tuple[int, int], ...]:
    discussions = {item.id: item for item in store.list_discussions(include_archived=True)}
    mentions: list[Mention] = []
    acks: list[Ack] = []
    for discussion in discussions.values():
        for message_id, members in store.mentions_by_message(discussion.id).items():
            for other in members:
                mentions.append(Mention(discussion.id, message_id, other, 0))
        for row in store._db.execute(
            "SELECT message_id, member_id FROM acks WHERE discussion_id = ?",
            (discussion.id,),
        ):
            acks.append(Ack(discussion.id, int(row["message_id"]), int(row["member_id"])))
    found = pending_for(member_id, mentions, ack_keys(acks), discussions)
    return tuple(sorted((item.discussion_id, item.message_id) for item in found))


def sql_pending(store: SqliteStore, member_id: int) -> tuple[tuple[int, int], ...]:
    return tuple(
        sorted((item.discussion_id, item.message_id) for item in store.pending(member_id))
    )


def test_sql_pending_matches_the_core_formula_under_random_operations(
    store: SqliteStore,
) -> None:
    rng = random.Random(20260830)
    human = store.create_member("human", "You")
    agents = [store.create_member("agent", f"Agent{index}") for index in range(4)]
    everyone = [human, *agents]
    rooms = [
        store.create_discussion(f"topic {index}", [human.id, *[a.id for a in agents]])
        for index in range(3)
    ]

    for _ in range(300):
        action = rng.random()
        room = rng.choice(rooms)
        member = rng.choice(everyone)
        if action < 0.45:
            target = rng.choice(agents)
            store.append_message(room.id, member.id, f"hello @{target.name} please")
        elif action < 0.6:
            pending = store.pending(member.id)
            if pending:
                pick = rng.choice(pending)
                store.ack(pick.discussion_id, [pick.message_id], member.id)
        elif action < 0.7:
            pending_any = store._db.execute(
                "SELECT discussion_id, message_id, member_id FROM acks LIMIT 5"
            ).fetchall()
            if pending_any:
                row = rng.choice(pending_any)
                store.revoke_ack(
                    int(row["discussion_id"]),
                    [int(row["message_id"])],
                    int(row["member_id"]),
                )
        elif action < 0.85:
            current = store.get_discussion(room.id)
            assert current is not None
            ids = set(current.member_ids)
            victim = rng.choice(agents)
            if victim.id in ids and len(ids) > 1:
                ids.discard(victim.id)
            else:
                ids.add(victim.id)
            store.set_discussion_members(room.id, sorted(ids))
        else:
            current = store.get_discussion(room.id)
            assert current is not None
            store.set_archived(room.id, not current.archived)

        for candidate in everyone:
            assert sql_pending(store, candidate.id) == reference_pending(
                store, candidate.id
            ), f"divergence for member {candidate.id}"


def test_removing_a_member_clears_pending_without_touching_acks(
    store: SqliteStore,
) -> None:
    human = store.create_member("human", "You")
    agent = store.create_member("agent", "Main")
    room = store.create_discussion("topic", [human.id, agent.id])
    store.append_message(room.id, human.id, "@Main first")
    store.append_message(room.id, human.id, "@Main second")
    assert len(store.pending(agent.id)) == 2

    store.ack(room.id, [1], agent.id)
    assert [item.message_id for item in store.pending(agent.id)] == [2]

    store.set_discussion_members(room.id, [human.id])
    assert store.pending(agent.id) == ()

    store.set_discussion_members(room.id, [human.id, agent.id])
    assert [item.message_id for item in store.pending(agent.id)] == [2]


def test_deleting_a_discussion_leaves_no_pending(store: SqliteStore) -> None:
    human = store.create_member("human", "You")
    agent = store.create_member("agent", "Main")
    room = store.create_discussion("topic", [human.id, agent.id])
    store.append_message(room.id, human.id, "@Main hello")
    assert len(store.pending(agent.id)) == 1
    store.delete_discussion(room.id)
    assert store.pending(agent.id) == ()


def test_message_ids_restart_per_discussion(store: SqliteStore) -> None:
    human = store.create_member("human", "You")
    first = store.create_discussion("a", [human.id])
    second = store.create_discussion("b", [human.id])
    message_a, _ = store.append_message(first.id, human.id, "one")
    message_b, _ = store.append_message(second.id, human.id, "one")
    assert message_a.id == 1
    assert message_b.id == 1


def test_names_are_unique_and_survive_deletion(store: SqliteStore) -> None:
    store.create_member("agent", "Main")
    assert store.name_taken("main") is True
    member = store.list_members()[0]
    store.delete_member(member.id)
    assert store.name_taken("Main") is True
    assert store.list_members() == ()
    assert len(store.list_members(include_deleted=True)) == 1


def test_unread_counts_ignore_own_messages(store: SqliteStore) -> None:
    human = store.create_member("human", "You")
    agent = store.create_member("agent", "Main")
    room = store.create_discussion("topic", [human.id, agent.id])
    store.append_message(room.id, human.id, "one")
    store.append_message(room.id, agent.id, "two")
    assert store.unread_counts(human.id)[room.id] == 1
    assert store.unread_counts(agent.id)[room.id] == 1
    store.set_watermark(room.id, human.id, 2)
    assert store.unread_counts(human.id)[room.id] == 0
