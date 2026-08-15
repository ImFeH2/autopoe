import pytest

from flowent.domain import DomainError, OrganizationState


def make_state() -> OrganizationState:
    state = OrganizationState()
    state.create_agent("Ada")
    state.create_discussion("Work", 1, [2])
    return state


def test_activation_is_computed_from_current_unacked_mentions() -> None:
    state = make_state()
    state.send_message(1, 1, "First", [2])
    state.send_message(1, 1, "Second", [2])

    activation, _ = state.claim_next_activation()

    assert activation is not None
    assert activation.agent_id == 2
    assert activation.items[0].discussion_id == 1
    assert activation.items[0].message_ids == (1, 2)
    assert state.snapshot()["members"][1]["status"] == "running"


def test_read_then_ack_stops_future_activation() -> None:
    state = make_state()
    state.send_message(1, 1, "Handle this", [2])
    activation, _ = state.claim_next_activation()
    assert activation is not None

    discussion = state.read_discussion(2, 1, end_message_id=1)
    assert discussion["messages"][0]["mentions"] == [{"member_id": 2, "status": "read"}]
    state.ack_messages(2, 1, [1])
    state.complete_activation(2)

    next_activation, _ = state.claim_next_activation()
    assert next_activation is None
    assert state.snapshot()["members"][1]["status"] == "idle"


def test_unacked_message_reactivates_immediately_after_idle() -> None:
    state = make_state()
    state.send_message(1, 1, "Still pending", [2])
    first, _ = state.claim_next_activation()
    assert first is not None

    state.complete_activation(2)
    second, _ = state.claim_next_activation()

    assert second is not None
    assert second.items == first.items


def test_invalid_read_range_does_not_mark_mentions_read() -> None:
    state = make_state()
    state.send_message(1, 1, "Original", [2])

    with pytest.raises(DomainError, match="cannot exceed"):
        state.read_discussion(
            2,
            1,
            start_message_id=2,
            end_message_id=1,
        )

    assert state.snapshot()["discussions"][0]["messages"][0]["mentions"] == [
        {"member_id": 2, "status": "pending"}
    ]


def test_read_range_includes_messages_that_do_not_mention_agent() -> None:
    state = make_state()
    state.send_message(1, 1, "Context for everyone")
    state.send_message(1, 1, "Please handle this", [2])

    discussion = state.read_discussion(2, 1, end_message_id=2)

    assert [message["id"] for message in discussion["messages"]] == [1, 2]
    assert discussion["messages"][0]["mentions"] == []
    assert discussion["messages"][1]["mentions"] == [{"member_id": 2, "status": "read"}]


def test_new_message_during_run_is_visible_and_enters_next_activation() -> None:
    state = make_state()
    state.send_message(1, 1, "Original", [2])
    first, _ = state.claim_next_activation()
    assert first is not None
    assert first.items[0].message_ids == (1,)

    state.send_message(1, 1, "Arrived while running", [2])
    current = state.read_discussion(2, 1, start_message_id=1, end_message_id=2)
    assert [message["body"] for message in current["messages"]] == [
        "Original",
        "Arrived while running",
    ]
    state.ack_messages(2, 1, [1])
    state.complete_activation(2)

    second, _ = state.claim_next_activation()
    assert second is not None
    assert second.items[0].message_ids == (2,)


def test_acked_work_stays_idle_after_a_late_failure() -> None:
    state = make_state()
    state.send_message(1, 1, "Completed", [2])
    activation, _ = state.claim_next_activation()
    assert activation is not None
    state.read_discussion(2, 1, end_message_id=1)
    state.ack_messages(2, 1, [1])

    state.complete_activation(2, "Late model failure")

    assert state.snapshot()["members"][1] == {
        "id": 2,
        "type": "agent",
        "name": "Ada",
        "status": "idle",
    }
    assert state.claim_next_activation()[0] is None
    with pytest.raises(DomainError, match="Only failed Agents"):
        state.retry_agent(2)


def test_read_unacked_work_can_be_retried_after_failure() -> None:
    state = make_state()
    state.send_message(1, 1, "Retry me", [2])
    activation, _ = state.claim_next_activation()
    assert activation is not None
    state.read_discussion(2, 1, end_message_id=1)

    state.complete_activation(2, "Model request failed")

    assert state.snapshot()["members"][1]["status"] == "error"
    assert state.snapshot()["discussions"][0]["messages"][0]["mentions"] == [
        {"member_id": 2, "status": "read"}
    ]
    state.retry_agent(2)
    retried, _ = state.claim_next_activation()
    assert retried is not None
    assert retried.items[0].message_ids == (1,)


def test_new_mention_during_failed_run_is_scheduled_immediately() -> None:
    state = make_state()
    state.send_message(1, 1, "Original", [2])
    first, _ = state.claim_next_activation()
    assert first is not None

    state.send_message(1, 1, "Arrived while running", [2])
    state.complete_activation(2, "Provider unavailable")

    assert state.snapshot()["members"][1]["status"] == "idle"
    second, _ = state.claim_next_activation()
    assert second is not None
    assert second.items[0].message_ids == (1, 2)


def test_failed_agent_retries_existing_unacked_work_explicitly() -> None:
    state = make_state()
    state.send_message(1, 1, "Fails once", [2])
    first, _ = state.claim_next_activation()
    assert first is not None
    state.complete_activation(2, "Provider unavailable")

    snapshot = state.retry_agent(2)
    retried, _ = state.claim_next_activation()

    assert snapshot["members"][1] == {
        "id": 2,
        "type": "agent",
        "name": "Ada",
        "status": "idle",
    }
    assert retried is not None
    assert retried.items == first.items


@pytest.mark.parametrize("status", ["idle", "running"])
def test_only_failed_agents_can_be_retried(status: str) -> None:
    state = make_state()
    if status == "running":
        state.send_message(1, 1, "Running", [2])
        assert state.claim_next_activation()[0] is not None

    with pytest.raises(DomainError, match="Only failed Agents"):
        state.retry_agent(2)


def test_late_failure_after_old_ack_schedules_only_new_work() -> None:
    state = make_state()
    state.send_message(1, 1, "Original", [2])
    first, _ = state.claim_next_activation()
    assert first is not None
    state.read_discussion(2, 1, end_message_id=1)
    state.ack_messages(2, 1, [1])
    state.send_message(1, 1, "Arrived while running", [2])

    state.complete_activation(2, "Late model failure")

    assert state.snapshot()["members"][1]["status"] == "idle"
    second, _ = state.claim_next_activation()
    assert second is not None
    assert second.items[0].message_ids == (2,)


def test_agent_error_stops_immediate_reactivation_until_new_mention() -> None:
    state = make_state()
    state.send_message(1, 1, "Fails", [2])
    activation, _ = state.claim_next_activation()
    assert activation is not None

    state.complete_activation(2, "Provider unavailable")
    assert state.claim_next_activation()[0] is None
    assert state.snapshot()["members"][1] == {
        "id": 2,
        "type": "agent",
        "name": "Ada",
        "status": "error",
        "error": "Provider unavailable",
    }

    state.create_discussion("Another topic", 1, [2])
    state.send_message(2, 1, "Try again elsewhere", [2])
    next_activation, _ = state.claim_next_activation()
    assert next_activation is not None
    assert [
        (item.discussion_id, item.message_ids) for item in next_activation.items
    ] == [(1, (1,)), (2, (1,))]
