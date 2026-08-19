import pytest

from flowent.domain import DomainError, OrganizationState


def make_state() -> OrganizationState:
    state = OrganizationState()
    state.create_agent("Ada")
    state.create_discussion("Work", 1, [2])
    return state


def test_reminder_contains_all_pending_mentions() -> None:
    state = make_state()
    state.send_message(1, 1, "@Ada First")
    state.send_message(1, 1, "@Ada Second")

    reminder, _ = state.claim_next_reminder()

    assert reminder is not None
    assert reminder.agent_id == 2
    assert [
        (item.message_id, item.body, item.previously_reminded)
        for item in reminder.mentions
    ] == [
        (1, "@Ada First", False),
        (2, "@Ada Second", False),
    ]


def test_unacked_mentions_are_marked_previously_reminded_on_the_next_turn() -> None:
    state = make_state()
    state.send_message(1, 1, "@Ada Pending")
    assert state.claim_next_reminder()[0] is not None
    state.complete_turn(2)

    reminder, _ = state.claim_next_reminder()

    assert reminder is not None
    assert reminder.mentions[0].previously_reminded is True


def test_acknowledging_any_pending_mention_resets_unproductive_turns() -> None:
    state = make_state()
    state.send_message(1, 1, "@Ada First")
    state.send_message(1, 1, "@Ada Second")
    assert state.claim_next_reminder()[0] is not None
    state.complete_turn(2)
    assert state.claim_next_reminder()[0] is not None
    state.ack_messages(2, 1, [1])
    state.complete_turn(2)

    reminder, _ = state.claim_next_reminder()

    assert reminder is not None
    assert [item.message_id for item in reminder.mentions] == [2]
    assert state.member(2)["status"] == "running"


def test_three_turns_without_ack_put_the_agent_in_error() -> None:
    state = make_state()
    state.send_message(1, 1, "@Ada Pending")

    for _ in range(3):
        assert state.claim_next_reminder()[0] is not None
        state.complete_turn(2)

    assert state.member(2) == {
        "id": 2,
        "type": "agent",
        "name": "Ada",
        "status": "error",
        "error": "Agent did not acknowledge any pending Mentions in three consecutive Turns",
    }
    assert state.claim_next_reminder()[0] is None


def test_message_can_create_pending_mentions_for_multiple_agents() -> None:
    state = OrganizationState()
    state.create_agent("Ada")
    state.create_agent("Lin")
    state.create_discussion("Work", 1, [2, 3])
    state.send_message(1, 1, "@Ada @Lin Coordinate")

    first, _ = state.claim_next_reminder()
    second, _ = state.claim_next_reminder()

    assert first is not None and first.agent_id == 2
    assert second is not None and second.agent_id == 3
    assert first.mentions[0].message_id == second.mentions[0].message_id == 1


def test_ack_requires_a_read_mentioned_message() -> None:
    state = make_state()
    state.send_message(1, 1, "@Ada Pending")

    with pytest.raises(DomainError, match="must be read"):
        state.ack_messages(2, 1, [1])
