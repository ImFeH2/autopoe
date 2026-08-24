from dataclasses import dataclass

import pytest

from flowent.discussion_paging import select_message_page
from flowent.domain import DomainError, OrganizationState


@dataclass
class Item:
    id: int


def project(item: Item) -> dict[str, int]:
    return {"id": item.id}


def test_latest_before_after_and_overlap_are_stable_id_pages() -> None:
    messages = [Item(i) for i in range(1, 102)]
    latest = select_message_page(messages, discussion_id=7, project=project)
    assert [item["id"] for item in latest["messages"]] == list(range(52, 102))
    assert latest["next_before_message_id"] == 52
    before = select_message_page(
        messages, discussion_id=7, before_message_id=52, project=project
    )
    assert [item["id"] for item in before["messages"]] == list(range(2, 52))
    after = select_message_page(
        messages, discussion_id=7, after_message_id=50, project=project
    )
    assert [item["id"] for item in after["messages"]] == list(range(51, 101))
    assert (
        select_message_page(
            messages, discussion_id=7, before_message_id=52, project=project
        )
        == before
    )


def test_anchor_balances_edges_and_uses_actual_records_with_gaps() -> None:
    messages = [Item(i) for i in [1, 2, 5, 9, 12, 20]]
    anchored = select_message_page(
        messages, discussion_id=1, anchor_message_id=9, limit=5, project=project
    )
    assert [item["id"] for item in anchored["messages"]] == [1, 2, 5, 9, 12]
    assert anchored["anchor_index"] == 3
    assert anchored["has_later"] is True
    assert anchored["has_earlier"] is False
    with pytest.raises(DomainError, match="Message not found"):
        select_message_page(
            messages, discussion_id=1, anchor_message_id=8, project=project
        )


def test_human_page_is_read_only_and_membership_checked() -> None:
    state = OrganizationState()
    state.create_agent("Ada")
    state.create_discussion("Work", 1, [2])
    state.send_message(1, 1, "@Ada read later")
    page = state.human_discussion_messages_page(1, 1)
    assert page["messages"][0]["mentions"][0]["status"] == "pending"
    assert (
        state.snapshot()["discussions"][0]["messages"][0]["mentions"][0]["status"]
        == "pending"
    )
    with pytest.raises(DomainError, match="Member is not a Human"):
        state.human_discussion_messages_page(2, 1)
