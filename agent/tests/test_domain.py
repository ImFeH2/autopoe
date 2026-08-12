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


def test_discussion_topic_and_members_are_snapshot_values() -> None:
    state = OrganizationState()
    state.create_agent("Ada")
    snapshot = state.create_discussion("Fixed topic", 1, [2])

    snapshot["discussions"][0]["topic"] = "Changed"
    snapshot["discussions"][0]["member_ids"].append(99)

    current = state.snapshot()["discussions"][0]
    assert current["topic"] == "Fixed topic"
    assert current["member_ids"] == [1, 2]
