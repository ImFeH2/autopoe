from collections.abc import Iterable, Sequence
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class HumanReadState:
    """Normalized read state belonging to exactly one Human member."""

    human_member_id: int
    read_through_message_id: int | None = None
    sparse_seen_message_ids: tuple[int, ...] = ()


def _unique_ordered_message_ids(ordered_message_ids: Sequence[int]) -> tuple[int, ...]:
    ordered = tuple(ordered_message_ids)
    if len(set(ordered)) != len(ordered):
        raise ValueError("ordered_message_ids must be unique")
    return ordered


def normalize_human_read_state(
    *,
    human_member_id: int,
    ordered_message_ids: Sequence[int],
    read_through_message_id: int | None = None,
    sparse_seen_message_ids: Iterable[int] = (),
) -> HumanReadState:
    """Collapse a Human's continuous prefix while retaining later sparse seen IDs.

    Unknown sparse IDs are ignored because the caller's ordered discussion snapshot
    defines the normalization domain. No Agent read state or persistence is touched.
    """

    ordered = _unique_ordered_message_ids(ordered_message_ids)
    positions = {message_id: index for index, message_id in enumerate(ordered)}

    if read_through_message_id is None:
        prefix_index = -1
    else:
        try:
            prefix_index = positions[read_through_message_id]
        except KeyError as error:
            raise ValueError(
                "read_through_message_id must belong to ordered_message_ids"
            ) from error

    seen_positions = {
        positions[message_id]
        for message_id in sparse_seen_message_ids
        if message_id in positions and positions[message_id] > prefix_index
    }

    while prefix_index + 1 in seen_positions:
        prefix_index += 1
        seen_positions.remove(prefix_index)

    sparse = tuple(ordered[index] for index in sorted(seen_positions))
    read_through = ordered[prefix_index] if prefix_index >= 0 else None
    return HumanReadState(
        human_member_id=human_member_id,
        read_through_message_id=read_through,
        sparse_seen_message_ids=sparse,
    )


def mark_human_messages_seen(
    state: HumanReadState,
    *,
    human_member_id: int,
    ordered_message_ids: Sequence[int],
    message_ids: Iterable[int],
) -> HumanReadState:
    """Idempotently add seen IDs without allowing cross-Human state reuse."""

    if state.human_member_id != human_member_id:
        raise ValueError("Human read state cannot be shared across members")

    return normalize_human_read_state(
        human_member_id=human_member_id,
        ordered_message_ids=ordered_message_ids,
        read_through_message_id=state.read_through_message_id,
        sparse_seen_message_ids=(*state.sparse_seen_message_ids, *message_ids),
    )
