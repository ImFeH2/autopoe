import pytest

from huddol.human_read_state import (
    HumanReadState,
    mark_human_messages_seen,
    normalize_human_read_state,
)


def test_normalizes_continuous_prefix_and_retains_sparse_seen_ids() -> None:
    state = normalize_human_read_state(
        human_member_id=7,
        ordered_message_ids=[10, 20, 30, 40, 50],
        sparse_seen_message_ids=[10, 20, 40],
    )

    assert state == HumanReadState(
        human_member_id=7,
        read_through_message_id=20,
        sparse_seen_message_ids=(40,),
    )


def test_out_of_order_and_duplicate_updates_are_idempotent() -> None:
    initial = HumanReadState(human_member_id=7)
    first = mark_human_messages_seen(
        initial,
        human_member_id=7,
        ordered_message_ids=[10, 20, 30, 40],
        message_ids=[30, 10, 30],
    )
    second = mark_human_messages_seen(
        first,
        human_member_id=7,
        ordered_message_ids=[10, 20, 30, 40],
        message_ids=[20, 10, 30],
    )
    repeated = mark_human_messages_seen(
        second,
        human_member_id=7,
        ordered_message_ids=[10, 20, 30, 40],
        message_ids=[30, 20, 10],
    )

    assert first == HumanReadState(7, 10, (30,))
    assert second == HumanReadState(7, 30, ())
    assert repeated == second


def test_existing_prefix_advances_only_across_a_contiguous_seen_run() -> None:
    state = HumanReadState(7, read_through_message_id=20, sparse_seen_message_ids=(40,))

    updated = mark_human_messages_seen(
        state,
        human_member_id=7,
        ordered_message_ids=[10, 20, 30, 40, 50],
        message_ids=[30, 50],
    )

    assert updated == HumanReadState(7, 50, ())


def test_unknown_sparse_ids_are_ignored_within_the_caller_snapshot() -> None:
    state = normalize_human_read_state(
        human_member_id=7,
        ordered_message_ids=[10, 20, 30],
        sparse_seen_message_ids=[999, 20],
    )

    assert state == HumanReadState(7, None, (20,))


def test_human_state_is_never_reused_for_another_member() -> None:
    state = HumanReadState(human_member_id=7)

    with pytest.raises(ValueError, match="cannot be shared"):
        mark_human_messages_seen(
            state,
            human_member_id=8,
            ordered_message_ids=[10],
            message_ids=[10],
        )


def test_rejects_ambiguous_order_or_an_unknown_prefix() -> None:
    with pytest.raises(ValueError, match="must be unique"):
        normalize_human_read_state(
            human_member_id=7,
            ordered_message_ids=[10, 10],
        )

    with pytest.raises(ValueError, match="must belong"):
        normalize_human_read_state(
            human_member_id=7,
            ordered_message_ids=[10, 20],
            read_through_message_id=30,
        )
