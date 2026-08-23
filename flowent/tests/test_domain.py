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
        "mention_syntax": {"enabled": True, "issues": []},
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
                "human_read_states": [
                    {
                        "member_id": 1,
                        "read_through_message_id": 1,
                        "seen_message_ids": [],
                    }
                ],
                "messages": [
                    {
                        "id": 1,
                        "sender_id": 1,
                        "body": "Start with the domain model.",
                        "references": [],
                        "mentions": [],
                    },
                    {
                        "id": 2,
                        "sender_id": 2,
                        "body": "I will take it.",
                        "references": [],
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


def test_references_cover_all_occurrences_but_notifications_only_target_peers() -> None:
    state = OrganizationState()
    state.create_agent("Ada")
    state.create_agent("Ada-Lovelace")
    state.create_agent("Grace")
    state.create_discussion("Work", 1, [2, 3])

    snapshot = state.send_message(
        1,
        1,
        "Ask @Ada-Lovelace, then @ADA twice @Ada. Keep @Grace and ignore @AdaX.",
    )
    message = snapshot["discussions"][0]["messages"][0]

    assert message["mentions"] == [
        {"member_id": 3, "status": "pending"},
        {"member_id": 2, "status": "pending"},
    ]
    assert [
        (
            reference["member_id"],
            reference["name"],
            reference["in_discussion"],
            reference["notified"],
            reference["deleted"],
        )
        for reference in message["references"]
    ] == [
        (3, "Ada-Lovelace", True, True, False),
        (2, "Ada", True, True, False),
        (2, "Ada", True, True, False),
        (4, "Grace", False, False, False),
    ]


def test_agent_names_are_legal_and_nfkc_casefold_unique() -> None:
    state = OrganizationState()
    state.create_agent("Ada")

    with pytest.raises(DomainError, match="unique"):
        state.create_agent("ADA")
    with pytest.raises(DomainError, match="unique"):
        state.create_agent("Ａｄａ")
    with pytest.raises(DomainError, match="only Unicode"):
        state.create_agent("Ada@Work")


def test_legacy_name_issue_disables_syntax_but_restores_notification_identity() -> None:
    state = OrganizationState(
        persisted={
            "members": [
                {"id": 1, "type": "human", "name": "You"},
                {"id": 2, "type": "agent", "name": "Bad Name"},
                {"id": 3, "type": "agent", "name": "Lin"},
            ],
            "discussions": [
                {
                    "id": 1,
                    "topic": "Legacy",
                    "member_ids": [1, 2, 3],
                    "messages": [
                        {
                            "id": 1,
                            "sender_id": 1,
                            "body": "legacy notification",
                            "mentions": [
                                {"member_id": 3, "read": False, "acked": False}
                            ],
                        }
                    ],
                }
            ],
        }
    )

    snapshot = state.send_message(1, 1, "@Lin must not partially resolve")

    assert snapshot["mention_syntax"] == {
        "enabled": False,
        "issues": [
            {
                "code": "invalid_name",
                "member_ids": [2],
                "names": ["Bad Name"],
            }
        ],
    }
    legacy = snapshot["discussions"][0]["messages"][0]
    assert legacy["references"] == [
        {
            "member_id": 3,
            "name": "Lin",
            "start": None,
            "end": None,
            "in_discussion": True,
            "notified": True,
            "deleted": False,
        }
    ]
    assert legacy["mentions"] == [{"member_id": 3, "status": "pending"}]
    current = snapshot["discussions"][0]["messages"][1]
    assert current["references"] == []
    assert current["mentions"] == []


def test_restore_keeps_historical_self_reference_display_without_status() -> None:
    state = OrganizationState(
        persisted={
            "members": [
                {"id": 1, "type": "human", "name": "Owner"},
                {"id": 2, "type": "agent", "name": "Ada"},
            ],
            "discussions": [
                {
                    "id": 1,
                    "topic": "Legacy",
                    "member_ids": [1, 2],
                    "messages": [
                        {
                            "id": 1,
                            "sender_id": 1,
                            "body": "@Owner historical",
                            "references": [
                                {
                                    "member_id": 1,
                                    "name": "Owner",
                                    "start": 0,
                                    "end": 6,
                                    "in_discussion": True,
                                    "notified": True,
                                }
                            ],
                            "mentions": [],
                            "human_mentions": [{"member_id": 1, "read": False}],
                        },
                        {
                            "id": 2,
                            "sender_id": 2,
                            "body": "@Ada historical",
                            "references": [
                                {
                                    "member_id": 2,
                                    "name": "Ada",
                                    "start": 0,
                                    "end": 4,
                                    "in_discussion": True,
                                    "notified": True,
                                }
                            ],
                            "mentions": [
                                {"member_id": 2, "read": False, "acked": False}
                            ],
                        },
                    ],
                }
            ],
        }
    )

    messages = state.snapshot()["discussions"][0]["messages"]
    assert messages[0]["references"][0]["notified"] is False
    assert "human_mentions" not in messages[0]
    assert messages[1]["references"][0]["notified"] is False
    assert messages[1]["mentions"] == []


def test_active_agent_conflicting_with_human_name_disables_syntax() -> None:
    state = OrganizationState(
        persisted={
            "members": [
                {"id": 1, "type": "human", "name": "You"},
                {"id": 2, "type": "agent", "name": "Ｙｏｕ"},
            ],
            "discussions": [
                {
                    "id": 1,
                    "topic": "Legacy",
                    "member_ids": [1, 2],
                    "messages": [],
                }
            ],
        }
    )

    snapshot = state.send_message(1, 1, "@You")

    assert snapshot["mention_syntax"] == {
        "enabled": False,
        "issues": [
            {
                "code": "duplicate_name",
                "member_ids": [1, 2],
                "names": ["You", "Ｙｏｕ"],
                "normalized_name": "you",
            }
        ],
    }
    assert snapshot["discussions"][0]["messages"][0]["references"] == []


def test_deleting_legacy_invalid_agent_recovers_gate() -> None:
    state = OrganizationState(
        persisted={
            "members": [
                {"id": 1, "type": "human", "name": "You"},
                {"id": 2, "type": "agent", "name": "Bad Name"},
                {"id": 3, "type": "agent", "name": "Lin"},
            ],
            "discussions": [
                {
                    "id": 1,
                    "topic": "Legacy",
                    "member_ids": [1, 2, 3],
                    "messages": [],
                }
            ],
        }
    )
    assert state.snapshot()["mention_syntax"]["enabled"] is False

    state.delete_agent(2)
    snapshot = state.send_message(1, 1, "@Lin works again")

    assert snapshot["mention_syntax"] == {"enabled": True, "issues": []}
    assert snapshot["discussions"][0]["messages"][0]["mentions"] == [
        {"member_id": 3, "status": "pending"}
    ]


def test_deleted_name_can_be_safely_reused_without_rewriting_history() -> None:
    state = OrganizationState()
    state.create_agent("Ada")
    state.create_agent("Lin")
    state.create_discussion("Work", 1, [2, 3])
    state.send_message(1, 1, "@Ada old identity")
    state.delete_agent(2)

    snapshot = state.create_agent("Ada")
    new_id = snapshot["members"][-1]["id"]
    snapshot = state.send_message(1, 1, "@Ada new identity")
    messages = snapshot["discussions"][0]["messages"]

    assert messages[0]["references"][0] == {
        "member_id": 2,
        "name": "Ada",
        "start": 0,
        "end": 4,
        "in_discussion": True,
        "notified": True,
        "deleted": True,
    }
    assert messages[1]["references"][0]["member_id"] == new_id
    assert messages[1]["references"][0]["deleted"] is False


def test_sender_cannot_mention_itself_by_name() -> None:
    state = OrganizationState()
    state.create_agent("Ada")
    state.create_agent("Lin")
    state.create_discussion("Work", 1, [2, 3])

    snapshot = state.send_message(1, 2, "@Ada handled this for @Lin")

    message = snapshot["discussions"][0]["messages"][0]
    assert message["mentions"] == [{"member_id": 3, "status": "pending"}]
    assert [
        (reference["member_id"], reference["in_discussion"], reference["notified"])
        for reference in message["references"]
    ] == [(3, True, True)]


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
            f"{'@Ada ' if message_id == 4 else ''}Message {message_id}",
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


def test_deleting_agent_preserves_discussions_and_messages() -> None:
    state = OrganizationState()
    state.create_agent("Ada")
    state.create_agent("Lin")
    state.create_discussion("Shared", 1, [2, 3])
    state.create_discussion("Ada only", 1, [2])
    state.send_message(1, 2, "Keep my message")

    snapshot = state.delete_agent(2)

    assert [member["name"] for member in snapshot["members"]] == ["You", "Lin"]
    assert [discussion["topic"] for discussion in snapshot["discussions"]] == [
        "Shared",
        "Ada only",
    ]
    assert snapshot["discussions"][0]["member_ids"] == [1, 3]
    assert snapshot["discussions"][1]["member_ids"] == [1]
    assert snapshot["discussions"][0]["messages"] == [
        {
            "id": 1,
            "sender_id": 2,
            "sender_name": "Ada",
            "body": "Keep my message",
            "references": [],
            "mentions": [],
        }
    ]
    with pytest.raises(DomainError, match="Member not found"):
        state.member(2)


def test_running_agent_cannot_be_deleted_but_their_discussion_can() -> None:
    state = OrganizationState()
    state.create_agent("Ada")
    state.create_discussion("Work", 1, [2])
    state.send_message(1, 1, "@Ada Handle this")
    assert state.claim_next_reminder()[0] is not None

    with pytest.raises(DomainError, match="Running Agents"):
        state.delete_agent(2)
    assert state.delete_discussion(1)["discussions"] == []


def test_paused_agent_keeps_pending_mentions_until_resumed() -> None:
    state = OrganizationState()
    state.create_agent("Ada")
    state.create_discussion("Work", 1, [2])
    state.send_message(1, 1, "@Ada Handle this")

    paused = state.pause_agent(2)
    assert paused["members"][1]["status"] == "paused"
    assert state.claim_next_reminder()[0] is None

    resumed = state.resume_agent(2)
    assert resumed["members"][1]["status"] == "idle"
    reminder, _ = state.claim_next_reminder()
    assert reminder is not None
    assert reminder.mentions[0].previously_reminded is False

    pausing = state.pause_agent(2)
    assert pausing["members"][1]["status"] == "pausing"
    assert state.agent_execution_diagnostics(2)["status"] == "pausing"
    assert state.resume_agent(2)["members"][1]["status"] == "running"
    assert state.pause_agent(2)["members"][1]["status"] == "pausing"

    state.complete_turn(2)
    assert state.snapshot()["members"][1]["status"] == "paused"
    assert state.agent_execution_diagnostics(2)["status"] == "paused"
    assert state.claim_next_reminder()[0] is None

    state.resume_agent(2)
    next_reminder, _ = state.claim_next_reminder()
    assert next_reminder is not None
    assert next_reminder.mentions[0].previously_reminded is True


def test_deleting_agent_marks_references_without_removing_mention_status() -> None:
    state = OrganizationState()
    state.create_agent("Ada")
    state.create_agent("Lin")
    state.create_discussion("Work", 1, [2, 3])
    state.send_message(1, 1, "@Ada twice @Ada and @Lin")
    state.read_discussion(2, 1)

    snapshot = state.delete_agent(2)
    message = snapshot["discussions"][0]["messages"][0]

    assert [reference["deleted"] for reference in message["references"]] == [
        True,
        True,
        False,
    ]
    assert message["mentions"] == [
        {"member_id": 2, "status": "read"},
        {"member_id": 3, "status": "pending"},
    ]
    reminder, _ = state.claim_next_reminder()
    assert reminder is not None and reminder.agent_id == 3

    later = state.send_message(1, 1, "Deleted @Ada is no longer resolvable")
    assert later["discussions"][0]["messages"][1]["references"] == []


def test_human_seen_messages_advance_prefix_and_keep_sparse_state() -> None:
    state = OrganizationState()
    state.create_agent("Ada")
    state.create_discussion("Unread", 1, [2])
    state.send_message(1, 2, "First")
    state.send_message(1, 2, "Second")
    state.send_message(1, 2, "Third")

    sparse = state.see_human_messages(1, 1, [3])
    assert sparse["discussions"][0]["human_read_states"] == [
        {
            "member_id": 1,
            "read_through_message_id": None,
            "seen_message_ids": [3],
        }
    ]

    advanced = state.see_human_messages(1, 1, [2, 1, 2])
    assert advanced["discussions"][0]["human_read_states"] == [
        {
            "member_id": 1,
            "read_through_message_id": 3,
            "seen_message_ids": [],
        }
    ]


def test_human_seen_messages_validate_identity_membership_and_ids() -> None:
    state = OrganizationState()
    state.create_agent("Ada")
    state.create_agent("Lin")
    state.create_discussion("Unread", 1, [2])
    state.send_message(1, 2, "First")

    with pytest.raises(DomainError, match="not a Human"):
        state.see_human_messages(2, 1, [1])
    with pytest.raises(DomainError, match="Discussion not found"):
        state.see_human_messages(1, 99, [1])
    with pytest.raises(DomainError, match="Message not found"):
        state.see_human_messages(1, 1, [2])
    with pytest.raises(DomainError, match="At least one"):
        state.see_human_messages(1, 1, [])


def test_member_rename_and_human_notifications_are_separate_from_agent_mentions() -> (
    None
):
    state = OrganizationState()
    state.create_agent("Ada")
    state.create_discussion("Work", 1, [2])

    first = state.send_message(1, 2, "@You please review @You")
    message = first["discussions"][0]["messages"][0]
    assert len(message["references"]) == 2
    assert message["mentions"] == []
    assert message["human_mentions"] == [{"member_id": 1, "status": "unread"}]
    assert state.claim_next_reminder()[0] is None

    renamed = state.rename_member(1, "Owner")
    assert renamed["members"][0]["name"] == "Owner"
    assert renamed["discussions"][0]["messages"][0]["references"][0]["name"] == "You"
    assert renamed["discussions"][0]["messages"][0]["human_mentions"] == [
        {"member_id": 1, "status": "unread"}
    ]

    read = state.read_human_mention(1, 1, 1)
    assert read["discussions"][0]["messages"][0]["human_mentions"] == [
        {"member_id": 1, "status": "read"}
    ]


def test_member_rename_uses_shared_validation_and_active_uniqueness() -> None:
    state = OrganizationState()
    state.create_agent("Ada")

    with pytest.raises(DomainError, match="unique"):
        state.rename_member(1, "ＡＤＡ")
    with pytest.raises(DomainError, match="only Unicode"):
        state.rename_member(1, "Bad Name")

    snapshot = state.rename_member(2, "Builder")
    assert snapshot["members"][1]["name"] == "Builder"


def test_human_self_and_out_of_discussion_mentions_never_notify() -> None:
    state = OrganizationState()
    state.create_agent("Ada")
    state.create_agent("Lin")
    state.create_discussion("Human present", 1, [2])
    own = state.send_message(1, 1, "@You note")
    own_message = own["discussions"][0]["messages"][0]
    assert own_message["references"] == []
    assert "human_mentions" not in own_message

    state.create_discussion("Agents only", 2, [3])
    outside = state.send_message(2, 2, "@You heads up")
    message = outside["discussions"][1]["messages"][0]
    assert message["references"][0]["in_discussion"] is False
    assert message["references"][0]["notified"] is False
    assert "human_mentions" not in message


def test_human_self_mention_uses_stable_id_after_rename_and_deleted_name_reuse() -> (
    None
):
    state = OrganizationState()
    state.create_agent("Owner")
    state.create_discussion("Work", 1, [2])
    state.delete_agent(2)
    state.rename_member(1, "Owner")

    snapshot = state.send_message(1, 1, "@Owner remains ordinary text")
    message = snapshot["discussions"][0]["messages"][0]

    assert message["body"] == "@Owner remains ordinary text"
    assert message["references"] == []
    assert message["mentions"] == []
    assert "human_mentions" not in message


def test_member_rename_preserves_historical_author_name_snapshot() -> None:
    state = OrganizationState()
    state.create_agent("Ada")
    state.create_discussion("Work", 1, [2])
    state.send_message(1, 1, "Before rename")

    snapshot = state.rename_member(1, "Owner")
    message = snapshot["discussions"][0]["messages"][0]

    assert snapshot["members"][0]["name"] == "Owner"
    assert message["sender_id"] == 1
    assert message["sender_name"] == "You"
    assert message["body"] == "Before rename"


def test_rename_member_preserves_identity_and_structured_reference_snapshot() -> None:
    state = OrganizationState()
    state.create_agent("Ada")
    state.create_discussion("Work", 1, [2])
    state.send_message(1, 1, "@Ada review")

    renamed = state.rename_member(2, "Grace")

    assert renamed["members"][1] == {
        "id": 2,
        "type": "agent",
        "name": "Grace",
        "status": "idle",
    }
    message = renamed["discussions"][0]["messages"][0]
    assert message["body"] == "@Ada review"
    assert message["references"][0]["member_id"] == 2
    assert message["references"][0]["name"] == "Ada"
    assert message["mentions"] == [{"member_id": 2, "status": "pending"}]


def test_rename_member_enforces_shared_validation_and_active_uniqueness() -> None:
    state = OrganizationState()
    state.create_agent("Ada")
    state.create_agent("Grace")

    with pytest.raises(DomainError) as whitespace:
        state.rename_member(2, " Ada")
    assert whitespace.value.code == "invalid_name"
    with pytest.raises(DomainError) as invalid:
        state.rename_member(2, "Bad Name")
    assert invalid.value.code == "invalid_name"
    with pytest.raises(DomainError) as duplicate:
        state.rename_member(2, "ＧＲＡＣＥ")
    assert duplicate.value.code == "duplicate_name"

    renamed = state.rename_member(2, "ADA")
    assert renamed["members"][1]["name"] == "ADA"


def test_rename_member_rejects_running_pausing_and_deleted_agents() -> None:
    state = OrganizationState()
    state.create_agent("Ada")
    state.create_discussion("Work", 1, [2])
    state.send_message(1, 1, "@Ada run")
    reminder, _revision = state.claim_next_reminder()
    assert reminder is not None

    with pytest.raises(DomainError) as running:
        state.rename_member(2, "Grace")
    assert running.value.code == "agent_busy"

    state.pause_agent(2)
    with pytest.raises(DomainError) as pausing:
        state.rename_member(2, "Grace")
    assert pausing.value.code == "agent_busy"

    state.complete_turn(2)
    paused = state.rename_member(2, "Grace")
    assert paused["members"][1]["status"] == "paused"

    state.resume_agent(2)
    state.delete_agent(2)
    with pytest.raises(DomainError) as deleted:
        state.rename_member(2, "Later")
    assert deleted.value.code == "member_deleted"


@pytest.mark.parametrize(
    "members",
    [
        [],
        [{"id": 1, "type": "agent", "name": "Ada"}],
        [{"id": 1, "type": "human", "name": "Owner", "deleted": True}],
    ],
)
def test_restore_requires_active_human_member_one(
    members: list[dict[str, object]],
) -> None:
    with pytest.raises(RuntimeError, match="missing its Human Member"):
        OrganizationState(persisted={"members": members, "discussions": []})
