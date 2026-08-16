from pathlib import Path

import pytest

from flowent.domain import DomainError, OrganizationState


def test_creates_agents_discussion_and_ordered_messages(tmp_path: Path) -> None:
    state = OrganizationState(tmp_path)

    state.create_agent("Ada")
    state.create_agent("Lin")
    state.create_discussion("Ship the first slice", 1, [2, 3, 2])
    state.send_message(1, 1, "Start with the domain model.")
    snapshot = state.send_message(1, 2, "I will take it.")

    assert snapshot == {
        "organization": {"id": 1},
        "working_directory": str(tmp_path),
        "members": [
            {"id": 1, "type": "human", "name": "You"},
            {"id": 2, "type": "agent", "name": "Ada", "status": "idle"},
            {"id": 3, "type": "agent", "name": "Lin", "status": "idle"},
        ],
        "discussions": [
            {
                "id": 1,
                "topic": "Ship the first slice",
                "member_ids": [1, 2, 3],
                "messages": [
                    {
                        "id": 1,
                        "sender_id": 1,
                        "body": "Start with the domain model.",
                        "mentions": [],
                    },
                    {
                        "id": 2,
                        "sender_id": 2,
                        "body": "I will take it.",
                        "mentions": [],
                    },
                ],
            }
        ],
    }


def test_discussion_requires_another_existing_member() -> None:
    state = OrganizationState()

    with pytest.raises(DomainError, match="at least two"):
        state.create_discussion("Solo", 1, [])

    with pytest.raises(DomainError, match="Member not found"):
        state.create_discussion("Unknown", 1, [99])


def test_only_discussion_members_can_send() -> None:
    state = OrganizationState()
    state.create_agent("Ada")
    state.create_agent("Lin")
    state.create_discussion("Ada only", 1, [2])

    with pytest.raises(DomainError, match="Only Discussion Members"):
        state.send_message(1, 3, "I should not be here.")


def test_agent_can_create_a_discussion_with_another_agent() -> None:
    state = OrganizationState()
    state.create_agent("Ada")
    state.create_agent("Lin")

    snapshot = state.create_discussion("Agent collaboration", 2, [3])

    assert snapshot["discussions"][0]["member_ids"] == [2, 3]


def test_message_ids_are_scoped_to_each_discussion() -> None:
    state = OrganizationState()
    state.create_agent("Ada")
    state.create_discussion("First", 1, [2])
    state.create_discussion("Second", 1, [2])

    state.send_message(1, 1, "First message in first Discussion")
    state.send_message(1, 1, "Second message in first Discussion")
    snapshot = state.send_message(2, 1, "First message in second Discussion")

    assert [message["id"] for message in snapshot["discussions"][0]["messages"]] == [
        1,
        2,
    ]
    assert [message["id"] for message in snapshot["discussions"][1]["messages"]] == [1]


def test_discussion_read_ranges_are_paginated_and_ordered() -> None:
    state = OrganizationState()
    state.create_agent("Ada")
    state.create_discussion("Work", 1, [2])
    for message_id in range(1, 6):
        state.send_message(
            1,
            1,
            f"Message {message_id}",
            [2] if message_id == 4 else [],
        )

    latest = state.read_discussion(2, 1, limit=2)
    ending_at_three = state.read_discussion(2, 1, end_message_id=3, limit=2)
    forward = state.read_discussion(
        2,
        1,
        start_message_id=2,
        end_message_id=4,
        limit=2,
    )

    assert [message["id"] for message in latest["messages"]] == [4, 5]
    assert latest["has_earlier"] is True
    assert latest["has_later"] is False
    assert latest["latest_message_id"] == 5
    assert [message["id"] for message in ending_at_three["messages"]] == [2, 3]
    assert ending_at_three["has_earlier"] is True
    assert ending_at_three["has_later"] is True
    assert [message["id"] for message in forward["messages"]] == [2, 3]
    assert forward["has_earlier"] is True
    assert forward["has_later"] is True
    assert state.snapshot()["discussions"][0]["messages"][3]["mentions"] == [
        {"member_id": 2, "status": "read"}
    ]


def test_discussion_info_returns_member_metadata() -> None:
    state = OrganizationState()
    state.create_agent("Ada")
    state.create_agent("Lin")
    state.create_discussion("Work", 1, [2])
    state.send_message(1, 1, "First")

    assert state.discussion_info(2, 1) == {
        "id": 1,
        "topic": "Work",
        "members": [
            {"id": 1, "type": "human", "name": "You"},
            {"id": 2, "type": "agent", "name": "Ada"},
        ],
        "message_count": 1,
        "latest_message_id": 1,
    }
    with pytest.raises(DomainError, match="Only Discussion Members"):
        state.discussion_info(3, 1)


def test_discussion_topic_and_members_are_snapshot_values() -> None:
    state = OrganizationState()
    state.create_agent("Ada")
    snapshot = state.create_discussion("Fixed topic", 1, [2])

    snapshot["discussions"][0]["topic"] = "Changed"
    snapshot["discussions"][0]["member_ids"].append(99)

    current = state.snapshot()["discussions"][0]
    assert current["topic"] == "Fixed topic"
    assert current["member_ids"] == [1, 2]


def test_deleting_discussion_removes_its_messages() -> None:
    state = OrganizationState()
    state.create_agent("Ada")
    state.create_discussion("Work", 1, [2])
    state.send_message(1, 1, "Delete this")

    snapshot = state.delete_discussion(1)

    assert snapshot["discussions"] == []


def test_deleting_agent_removes_their_discussions() -> None:
    state = OrganizationState()
    state.create_agent("Ada")
    state.create_agent("Lin")
    state.create_discussion("Shared", 1, [2, 3])
    state.create_discussion("Lin only", 1, [3])

    snapshot = state.delete_agent(2)

    assert [member["name"] for member in snapshot["members"]] == ["You", "Lin"]
    assert [discussion["topic"] for discussion in snapshot["discussions"]] == [
        "Lin only"
    ]


def test_running_agent_and_their_discussion_cannot_be_deleted() -> None:
    state = OrganizationState()
    state.create_agent("Ada")
    state.create_discussion("Work", 1, [2])
    state.send_message(1, 1, "Handle this", [2])
    assert state.claim_next_reminder()[0] is not None

    with pytest.raises(DomainError, match="Running Agents"):
        state.delete_agent(2)
    with pytest.raises(DomainError, match="running Agents"):
        state.delete_discussion(1)
