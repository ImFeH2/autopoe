from copy import deepcopy
from pathlib import Path
from threading import Event, Thread

import pytest
from snapshot_helpers import without_delivery

from huddol.domain import DomainError, OrganizationState


def test_current_human_identity_is_explicit_and_not_tied_to_member_one() -> None:
    state = OrganizationState(current_human_member_id=7)
    state.create_agent("Ada")
    snapshot = state.create_discussion("Dynamic Human", 7, [8])

    assert snapshot["organization"] == {
        "id": 1,
        "current_human_member_id": 7,
    }
    assert snapshot["members"][0] == {
        "id": 7,
        "type": "human",
        "name": "You",
    }
    assert snapshot["discussions"][0]["member_ids"] == [7, 8]

    restored = OrganizationState(
        persisted=state._persistence_data(), current_human_member_id=7
    )
    assert restored.snapshot()["organization"]["current_human_member_id"] == 7

    with pytest.raises(RuntimeError, match="missing its current Human Member"):
        OrganizationState(
            persisted=state._persistence_data(), current_human_member_id=1
        )


@pytest.mark.parametrize("invalid_id", [True, 0, -1, "1"])
def test_current_human_identity_rejects_non_positive_integers(
    invalid_id: object,
) -> None:
    with pytest.raises(ValueError, match="positive integer"):
        OrganizationState(current_human_member_id=invalid_id)  # type: ignore[arg-type]


def test_creates_agents_discussion_and_ordered_messages(tmp_path: Path) -> None:
    state = OrganizationState(
        tmp_path, message_clock=lambda: "2026-08-22T12:34:56.789Z"
    )

    state.create_agent("Ada")
    state.create_agent("Lin")
    state.create_discussion("Ship the first slice", 1, [2, 3, 2])
    state.send_message(1, 1, "Start with the domain model.")
    snapshot = state.send_message(1, 2, "I will take it.")

    assert without_delivery(snapshot) == {
        "organization": {"id": 1, "current_human_member_id": 1},
        "working_directory": str(tmp_path),
        "mention_syntax": {"enabled": True, "issues": []},
        "member_name_policy": {
            "normalization": "NFKC",
            "max_code_points": 32,
            "max_utf8_bytes": 128,
        },
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
                        "joined_after_message_id": 0,
                        "read_through_message_id": 1,
                        "seen_message_ids": [],
                    }
                ],
                "messages": [
                    {
                        "id": 1,
                        "sender_id": 1,
                        "body": "Start with the domain model.",
                        "created_at": "2026-08-22T12:34:56.789Z",
                        "references": [],
                        "mentions": [],
                    },
                    {
                        "id": 2,
                        "sender_id": 2,
                        "body": "I will take it.",
                        "created_at": "2026-08-22T12:34:56.789Z",
                        "references": [],
                        "mentions": [],
                    },
                ],
            }
        ],
    }


def test_message_timestamps_are_created_only_for_successful_messages() -> None:
    timestamps = iter(
        [
            "2026-08-22T12:00:00.123Z",
            "2026-08-22T11:59:59.999Z",
        ]
    )
    state = OrganizationState(message_clock=lambda: next(timestamps))
    state.create_agent("Ada")
    state.create_agent("Lin")
    state.create_discussion("Work", 1, [2])

    with pytest.raises(DomainError, match="Only Discussion Members"):
        state.send_message(1, 3, "Rejected")

    state.send_message(1, 1, "First")
    snapshot = state.send_message(1, 2, "Second")
    messages = snapshot["discussions"][0]["messages"]
    assert [message["id"] for message in messages] == [1, 2]
    assert [message["created_at"] for message in messages] == [
        "2026-08-22T12:00:00.123Z",
        "2026-08-22T11:59:59.999Z",
    ]


def test_failed_persistence_does_not_leave_a_message_or_consume_its_id() -> None:
    persisted = {
        "members": [
            {"id": 1, "type": "human", "name": "You"},
            {"id": 2, "type": "agent", "name": "Ada"},
        ],
        "discussions": [
            {
                "id": 1,
                "topic": "Work",
                "member_ids": [1, 2],
                "messages": [],
            }
        ],
    }
    timestamps = iter(
        [
            "2026-08-22T12:00:00.123Z",
            "2026-08-22T12:00:01.456Z",
        ]
    )

    persistence_available = False

    def persist(_snapshot: dict[str, object]) -> None:
        if not persistence_available:
            raise OSError("disk unavailable")

    state = OrganizationState(
        persisted=persisted,
        on_persist=persist,
        message_clock=lambda: next(timestamps),
    )
    before_read_states = state.snapshot()["discussions"][0]["human_read_states"]
    with pytest.raises(OSError, match="disk unavailable"):
        state.send_message(1, 1, "Failed")
    failed_discussion = state.snapshot()["discussions"][0]
    assert failed_discussion["messages"] == []
    assert failed_discussion["human_read_states"] == before_read_states

    persistence_available = True
    discussion = state.send_message(1, 1, "Retried")["discussions"][0]
    message = discussion["messages"][0]
    assert message["id"] == 1
    assert message["created_at"] == "2026-08-22T12:00:01.456Z"
    assert discussion["human_read_states"] == [
        {
            "member_id": 1,
            "joined_after_message_id": 0,
            "read_through_message_id": 1,
            "seen_message_ids": [],
        }
    ]


@pytest.mark.parametrize(
    "action",
    [
        "create_agent",
        "rename_member",
        "delete_agent",
        "pause_agent",
        "resume_agent",
        "create_discussion",
        "delete_discussion",
        "send_message",
        "agent_read",
        "record_message_reads",
        "human_see",
        "human_mark_all",
        "human_read_mention",
        "human_ack_mention",
        "agent_ack",
        "claim_reminder",
    ],
)
def test_persisted_mutations_restore_all_state_when_persistence_fails(
    action: str,
) -> None:
    state = OrganizationState(message_clock=lambda: "2026-08-26T12:00:00.000Z")
    state.create_agent("Ada")
    state.create_agent("Lin")
    state.create_discussion("Work", 1, [2, 3])
    state.send_message(1, 1, "@Ada @Lin Start")
    state.send_message(1, 2, "@You Update")

    if action == "resume_agent":
        state.pause_agent(3)
    elif action == "human_ack_mention":
        state.read_human_mention(1, 1, 2)
    elif action == "agent_ack":
        state.read_discussion(2, 1, start_message_id=1, end_message_id=1)

    callbacks = 0

    def fail_persistence(_snapshot: dict[str, object]) -> None:
        nonlocal callbacks
        callbacks += 1
        raise OSError("disk unavailable")

    state._on_persist = fail_persistence
    before_persistence = deepcopy(state._persistence_data())
    before_execution = deepcopy(state._agent_execution)
    before_next_member_id = state._next_member_id
    before_next_discussion_id = state._next_discussion_id
    before_revision = state._revision

    operations = {
        "create_agent": lambda: state.create_agent("Grace"),
        "rename_member": lambda: state.rename_member(2, "Ada_Lovelace"),
        "delete_agent": lambda: state.delete_agent(3),
        "pause_agent": lambda: state.pause_agent(3),
        "resume_agent": lambda: state.resume_agent(3),
        "create_discussion": lambda: state.create_discussion("New", 1, [2]),
        "delete_discussion": lambda: state.delete_discussion(1),
        "send_message": lambda: state.send_message(1, 2, "Progress"),
        "agent_read": lambda: state.read_discussion(
            3, 1, start_message_id=1, end_message_id=1
        ),
        "record_message_reads": lambda: state.record_message_reads(
            3,
            [(1, 1)],
            source="agent_discussion_read",
        ),
        "human_see": lambda: state.see_human_messages(1, 1, [2]),
        "human_mark_all": lambda: state.mark_all_human_messages_read(1, 1, 2),
        "human_read_mention": lambda: state.read_human_mention(1, 1, 2),
        "human_ack_mention": lambda: state.ack_human_mention(1, 1, 2),
        "agent_ack": lambda: state.ack_messages(2, 1, [1]),
        "claim_reminder": state.claim_next_reminder,
    }

    if action == "record_message_reads":
        operations[action]()
    else:
        with pytest.raises(OSError, match="disk unavailable"):
            operations[action]()

    assert callbacks == 1
    assert state._persistence_data() == before_persistence
    assert state._agent_execution == before_execution
    assert state._next_member_id == before_next_member_id
    assert state._next_discussion_id == before_next_discussion_id
    assert state._revision == before_revision


@pytest.mark.parametrize(
    ("coordinates", "error_code"),
    [
        ([(999, 1)], "discussion_not_found"),
        ([(1, 999)], "message_not_found"),
        ([(1, 1)], "invalid_read"),
    ],
)
def test_record_message_reads_propagates_validation_errors_without_persisting(
    coordinates: list[tuple[int, int]],
    error_code: str,
) -> None:
    state = OrganizationState()
    state.create_agent("Ada")
    state.create_agent("Lin")
    state.create_discussion("Work", 1, [2, 3])
    state.send_message(1, 1, "@Ada Start")
    membership = state._discussions[1].memberships[2]
    state._discussions[1].memberships[2] = type(membership)(
        member_id=3,
        joined_after_message_id=1,
    )
    callbacks = 0

    def persist(_snapshot: dict[str, object]) -> None:
        nonlocal callbacks
        callbacks += 1

    state._on_persist = persist
    with pytest.raises(DomainError) as error:
        state.record_message_reads(
            3,
            coordinates,
            source="agent_discussion_read",
        )

    assert error.value.code == error_code
    assert callbacks == 0


def test_failed_record_message_reads_does_not_publish_and_can_retry() -> None:
    state = OrganizationState()
    state.create_agent("Ada")
    state.create_discussion("Work", 1, [2])
    state.send_message(1, 1, "@Ada Start")
    before_persistence = deepcopy(state._persistence_data())
    before_revision = state._revision
    waiting = Event()
    completed = Event()
    stop = Event()

    def wait_for_change() -> None:
        waiting.set()
        state.wait_for_change(before_revision, stop)
        completed.set()

    waiter = Thread(target=wait_for_change)
    waiter.start()
    assert waiting.wait(1)

    def fail_persistence(_snapshot: dict[str, object]) -> None:
        raise OSError("disk unavailable")

    state._on_persist = fail_persistence
    state.record_message_reads(2, [(1, 1)], source="agent_discussion_read")

    assert state._persistence_data() == before_persistence
    assert not completed.wait(0.05)
    assert state._revision == before_revision

    persisted = []
    state._on_persist = persisted.append
    state.record_message_reads(2, [(1, 1)], source="agent_discussion_read")

    assert len(persisted) == 1
    assert completed.wait(1)
    assert state._revision == before_revision + 1
    stop.set()
    waiter.join(1)
    assert completed.is_set()


def test_legacy_message_timestamp_can_be_missing_but_malformed_is_rejected() -> None:
    persisted = {
        "members": [
            {"id": 1, "type": "human", "name": "You"},
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
                        "body": "No original timestamp",
                        "mentions": [],
                    }
                ],
            }
        ],
    }

    restored = OrganizationState(persisted=persisted)
    assert restored.snapshot()["discussions"][0]["messages"][0]["created_at"] is None

    persisted["discussions"][0]["messages"][0]["created_at"] = "not-a-time"
    with pytest.raises(RuntimeError, match="created_at is invalid"):
        OrganizationState(persisted=persisted)


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
    with pytest.raises(DomainError, match="only Unicode"):
        state.create_agent("Ada😀")


def test_member_name_limits_use_nfkc_code_points_and_utf8_bytes() -> None:
    state = OrganizationState()
    composed = "É" * 32
    decomposed = "É" * 32
    four_byte_letter = "𐐀"

    assert state.create_agent(decomposed)["members"][-1]["name"] == decomposed
    with pytest.raises(DomainError) as normalized_duplicate:
        state.create_agent(composed)
    assert normalized_duplicate.value.code == "duplicate_name"
    state.rename_member(2, composed)

    with pytest.raises(DomainError) as chars:
        state.rename_member(2, "a" * 33)
    assert chars.value.code == "name_too_long"

    state.rename_member(2, four_byte_letter * 32)
    with pytest.raises(DomainError) as utf8:
        state.rename_member(2, four_byte_letter * 32 + "a")
    assert utf8.value.code == "name_too_large"

    with pytest.raises(DomainError) as nfkc_expansion:
        state.rename_member(2, "ﬃ" * 11)
    assert nfkc_expansion.value.code == "name_too_long"

    with pytest.raises(DomainError) as emoji:
        state.rename_member(2, "Ada😀")
    assert emoji.value.code == "invalid_name"


def test_create_and_human_agent_rename_share_member_name_validation() -> None:
    state = OrganizationState()

    for name in (" Ada", "Ada "):
        with pytest.raises(DomainError) as create:
            state.create_agent(name)
        assert create.value.code == "invalid_name"

    state.create_agent("Ada")
    for member_id in (1, 2):
        with pytest.raises(DomainError) as rename:
            state.rename_member(member_id, "x" * 33)
        assert rename.value.code == "name_too_long"


def test_legacy_overlong_active_name_restores_without_disabling_mentions() -> None:
    legacy_name = "\U00010400" * 33
    state = OrganizationState(
        persisted={
            "members": [
                {"id": 1, "type": "human", "name": "You"},
                {"id": 2, "type": "agent", "name": legacy_name},
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
                            "body": "legacy structured reference",
                            "references": [
                                {
                                    "member_id": 2,
                                    "name": legacy_name,
                                    "start": None,
                                    "end": None,
                                    "in_discussion": True,
                                    "notified": False,
                                    "deleted": False,
                                }
                            ],
                            "mentions": [],
                        }
                    ],
                }
            ],
        }
    )

    snapshot = state.send_message(1, 1, f"@{legacy_name}")
    assert snapshot["members"][1]["name"] == legacy_name
    assert snapshot["mention_syntax"] == {"enabled": True, "issues": []}
    assert snapshot["discussions"][0]["messages"][0]["references"][0] == {
        "member_id": 2,
        "name": legacy_name,
        "start": None,
        "end": None,
        "in_discussion": True,
        "notified": False,
        "deleted": False,
    }
    assert snapshot["discussions"][0]["messages"][1]["mentions"] == [
        {"member_id": 2, "status": "pending"}
    ]

    with pytest.raises(DomainError) as unchanged_rename:
        state.rename_member(2, legacy_name)
    assert unchanged_rename.value.code == "name_too_large"

    renamed = state.rename_member(2, "Legacy")
    assert renamed["members"][1]["name"] == "Legacy"


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


def test_agent_created_discussion_includes_every_active_human() -> None:
    state = OrganizationState()
    state.create_agent("Ada")
    state.create_agent("Lin")

    snapshot = state.create_discussion("Agent collaboration", 2, [3])

    assert snapshot["discussions"][0]["member_ids"] == [1, 2, 3]


def test_restore_adds_missing_active_human_at_latest_message_cutoff() -> None:
    persisted = {
        "members": [
            {"id": 1, "type": "human", "name": "Owner"},
            {"id": 2, "type": "agent", "name": "Ada"},
            {"id": 3, "type": "human", "name": "Guest"},
        ],
        "discussions": [
            {
                "id": 1,
                "topic": "Existing",
                "member_ids": [1, 2],
                "messages": [
                    {"id": 1, "sender_id": 2, "body": "Old one", "mentions": []},
                    {"id": 2, "sender_id": 2, "body": "Old two", "mentions": []},
                ],
            }
        ],
    }
    repairs: list[dict[str, object]] = []

    state = OrganizationState(persisted=persisted, on_persist=repairs.append)
    discussion = state.snapshot()["discussions"][0]

    assert discussion["member_ids"] == [1, 2, 3]
    assert discussion["human_read_states"] == [
        {
            "member_id": 1,
            "joined_after_message_id": 0,
            "read_through_message_id": None,
            "seen_message_ids": [],
        },
        {
            "member_id": 3,
            "joined_after_message_id": 2,
            "read_through_message_id": None,
            "seen_message_ids": [],
        },
    ]
    assert discussion["activity_frontiers"] == []
    assert len(repairs) == 1
    repaired_discussion = repairs[0]["discussions"][0]
    assert repaired_discussion["memberships"][2] == {
        "member_id": 3,
        "active": True,
        "joined_after_message_id": 2,
    }
    assert repaired_discussion["activity_frontiers"] == []

    reopened = OrganizationState(persisted=repairs[0])
    reopened_discussion = reopened.snapshot()["discussions"][0]
    reopened_guest_state = reopened_discussion["human_read_states"][1]
    assert reopened_guest_state["joined_after_message_id"] == 2
    assert reopened_discussion["activity_frontiers"] == []

    next_snapshot = reopened.send_message(1, 2, "New after Guest joined")
    new_recipients = next_snapshot["discussions"][0]["messages"][2]["delivery"][
        "recipients"
    ]
    assert [recipient["member_id"] for recipient in new_recipients] == [1, 3]
    assert next_snapshot["discussions"][0]["activity_frontiers"] == [
        {"member_id": 2, "latest_activity_message_id": 3}
    ]


def test_restore_deactivates_deleted_human_membership_without_losing_history() -> None:
    persisted = {
        "members": [
            {"id": 1, "type": "human", "name": "Owner"},
            {"id": 2, "type": "agent", "name": "Ada"},
            {"id": 3, "type": "human", "name": "Former", "deleted": True},
        ],
        "discussions": [
            {
                "id": 1,
                "topic": "History",
                "memberships": [
                    {"member_id": 1, "active": True, "joined_after_message_id": 0},
                    {"member_id": 2, "active": True, "joined_after_message_id": 0},
                    {"member_id": 3, "active": True, "joined_after_message_id": 0},
                ],
                "human_read_states": [
                    {
                        "member_id": 3,
                        "read_through_message_id": 1,
                        "seen_message_ids": [],
                    }
                ],
                "messages": [
                    {"id": 1, "sender_id": 3, "body": "Historical", "mentions": []}
                ],
            }
        ],
    }
    repairs: list[dict[str, object]] = []

    state = OrganizationState(persisted=persisted, on_persist=repairs.append)

    assert state.snapshot()["discussions"][0]["member_ids"] == [1, 2]
    repaired_discussion = repairs[0]["discussions"][0]
    assert repaired_discussion["memberships"][2] == {
        "member_id": 3,
        "active": False,
        "joined_after_message_id": 0,
    }
    assert repaired_discussion["human_read_states"][0] == {
        "member_id": 3,
        "read_through_message_id": 1,
        "seen_message_ids": [],
    }
    assert repaired_discussion["messages"][0]["sender_id"] == 3


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

    assert without_delivery(snapshot["discussions"]) == []


def test_deleting_agent_preserves_discussions_and_messages() -> None:
    state = OrganizationState(message_clock=lambda: "2026-08-22T12:34:56.789Z")
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
    assert without_delivery(snapshot["discussions"][0]["messages"]) == [
        {
            "id": 1,
            "sender_id": 2,
            "sender_name": "Ada",
            "body": "Keep my message",
            "created_at": "2026-08-22T12:34:56.789Z",
            "references": [],
            "mentions": [],
        }
    ]
    with pytest.raises(DomainError, match="Member not found"):
        state.member(2)


def test_deleting_all_agents_preserves_the_discussion_with_its_human() -> None:
    state = OrganizationState(message_clock=lambda: "2026-08-24T01:00:00.000Z")
    state.create_agent("Ada")
    state.create_agent("Lin")
    state.create_discussion("Agent archive", 2, [3])
    state.send_message(1, 2, "Keep this history")

    state.delete_agent(2)
    snapshot = state.delete_agent(3)

    assert without_delivery(snapshot["discussions"]) == [
        {
            "id": 1,
            "topic": "Agent archive",
            "member_ids": [1],
            "human_read_states": [
                {
                    "member_id": 1,
                    "joined_after_message_id": 0,
                    "read_through_message_id": None,
                    "seen_message_ids": [],
                }
            ],
            "messages": [
                {
                    "id": 1,
                    "sender_id": 2,
                    "sender_name": "Ada",
                    "body": "Keep this history",
                    "created_at": "2026-08-24T01:00:00.000Z",
                    "references": [],
                    "mentions": [],
                }
            ],
        }
    ]


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
            "joined_after_message_id": 0,
            "read_through_message_id": None,
            "seen_message_ids": [3],
        }
    ]

    advanced = state.see_human_messages(1, 1, [2, 1, 2])
    assert advanced["discussions"][0]["human_read_states"] == [
        {
            "member_id": 1,
            "joined_after_message_id": 0,
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


def test_human_self_mention_does_not_notify_and_agent_created_discussion_does() -> None:
    state = OrganizationState()
    state.create_agent("Ada")
    state.create_agent("Lin")
    state.create_discussion("Human present", 1, [2])
    own = state.send_message(1, 1, "@You note")
    own_message = own["discussions"][0]["messages"][0]
    assert own_message["references"] == []
    assert "human_mentions" not in own_message

    state.create_discussion("Agent created", 2, [3])
    notified = state.send_message(2, 2, "@You heads up")
    message = notified["discussions"][1]["messages"][0]
    assert message["references"][0]["in_discussion"] is True
    assert message["references"][0]["notified"] is True
    assert message["human_mentions"] == [{"member_id": 1, "status": "unread"}]


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
def test_restore_requires_the_explicit_current_human_member(
    members: list[dict[str, object]],
) -> None:
    with pytest.raises(RuntimeError, match="missing its current Human Member"):
        OrganizationState(persisted={"members": members, "discussions": []})


def test_delivery_freezes_recipients_and_preserves_send_time_identity() -> None:
    state = OrganizationState(message_clock=lambda: "2026-08-24T12:00:00.000Z")
    state.create_agent("Ada")
    state.create_agent("Lin")
    state.create_discussion("Delivery", 1, [2, 3])

    first = state.send_message(1, 1, "@Ada review")
    delivery = first["discussions"][0]["messages"][0]["delivery"]
    assert delivery == {
        "recipients_known": True,
        "recipients": [
            {
                "member_id": 2,
                "member_type_at_send": "agent",
                "member_name_at_send": "Ada",
                "available": True,
                "mentioned": True,
                "read": False,
                "ack": "pending",
            },
            {
                "member_id": 3,
                "member_type_at_send": "agent",
                "member_name_at_send": "Lin",
                "available": True,
                "mentioned": False,
                "read": False,
                "ack": "not_applicable",
            },
        ],
    }

    state.rename_member(2, "Grace")
    deleted = state.delete_agent(3)
    recipients = deleted["discussions"][0]["messages"][0]["delivery"]["recipients"]
    assert recipients[0]["member_name_at_send"] == "Ada"
    assert recipients[0]["available"] is True
    assert recipients[1]["member_name_at_send"] == "Lin"
    assert recipients[1]["available"] is False


def test_human_viewport_mark_all_and_explicit_ack_are_independent() -> None:
    state = OrganizationState(message_clock=lambda: "2026-08-24T12:00:00.000Z")
    state.create_agent("Ada")
    state.create_discussion("Human delivery", 1, [2])
    state.send_message(1, 2, "@You first")
    state.send_message(1, 2, "second")

    state.see_human_messages(1, 1, [2])
    discussion = state.snapshot()["discussions"][0]
    assert discussion["activity_frontiers"] == [
        {"member_id": 1, "latest_activity_message_id": 2},
        {"member_id": 2, "latest_activity_message_id": 2},
    ]
    first_recipient = discussion["messages"][0]["delivery"]["recipients"][0]
    assert first_recipient["read"] is False
    assert first_recipient["ack"] == "pending"

    state.mark_all_human_messages_read(1, 1, 2)
    first_recipient = state.snapshot()["discussions"][0]["messages"][0]["delivery"][
        "recipients"
    ][0]
    assert first_recipient["read"] is True
    assert first_recipient["ack"] == "pending"

    state.ack_human_mention(1, 1, 1)
    acknowledged = state.snapshot()["discussions"][0]["messages"][0]["delivery"][
        "recipients"
    ][0]
    assert acknowledged["read"] is True
    assert acknowledged["ack"] == "acked"


def test_agent_claim_is_not_read_but_exact_context_and_tool_read_are() -> None:
    state = OrganizationState(message_clock=lambda: "2026-08-24T12:00:00.000Z")
    state.create_agent("Ada")
    state.create_discussion("Agent delivery", 1, [2])
    state.send_message(1, 1, "@Ada first")
    state.send_message(1, 1, "second")

    reminder, _revision = state.claim_next_reminder()
    assert reminder is not None
    recipient = state.snapshot()["discussions"][0]["messages"][0]["delivery"][
        "recipients"
    ][0]
    assert recipient["read"] is False

    state.record_message_reads(
        2,
        [(1, 1)],
        source="agent_reminder_context",
        agent_run_id="run-123",
    )
    discussion = state.snapshot()["discussions"][0]
    assert discussion["messages"][0]["delivery"]["recipients"][0]["read"] is True
    assert discussion["messages"][1]["delivery"]["recipients"][0]["read"] is False

    state.read_discussion(2, 1, start_message_id=2, limit=1)
    assert (
        state.snapshot()["discussions"][0]["messages"][1]["delivery"]["recipients"][0][
            "read"
        ]
        is True
    )


def test_new_discussion_has_no_inferred_frontier_until_real_activity() -> None:
    state = OrganizationState(message_clock=lambda: "2026-08-24T12:00:00.000Z")
    state.create_agent("Ada")

    created = state.create_discussion("Fresh", 1, [2])
    assert created["discussions"][0]["activity_frontiers"] == []

    sent = state.send_message(1, 2, "First for the Human")
    assert sent["discussions"][0]["activity_frontiers"] == [
        {"member_id": 2, "latest_activity_message_id": 1}
    ]
    recipient = sent["discussions"][0]["messages"][0]["delivery"]["recipients"][0]
    assert recipient["member_id"] == 1
    assert recipient["read"] is False


def test_viewport_batch_and_human_ack_fail_atomically() -> None:
    state = OrganizationState(message_clock=lambda: "2026-08-24T12:00:00.000Z")
    state.create_agent("Ada")
    state.create_discussion("Atomic", 1, [2])
    state.send_message(1, 2, "@You review")
    state.send_message(1, 2, "not mentioned")

    with pytest.raises(DomainError) as invalid_batch:
        state.see_human_messages(1, 1, [1, 99])
    assert invalid_batch.value.code == "message_not_found"
    discussion = state.snapshot()["discussions"][0]
    assert 1 not in {
        frontier["member_id"] for frontier in discussion["activity_frontiers"]
    }
    assert discussion["messages"][0]["delivery"]["recipients"][0]["read"] is False

    with pytest.raises(DomainError) as unread_ack:
        state.ack_human_mention(1, 1, 1)
    assert unread_ack.value.code == "invalid_ack"
    assert (
        state.snapshot()["discussions"][0]["messages"][0]["delivery"]["recipients"][0][
            "ack"
        ]
        == "pending"
    )

    state.see_human_messages(1, 1, [2])
    with pytest.raises(DomainError) as not_notified:
        state.ack_human_mention(1, 1, 2)
    assert not_notified.value.code == "invalid_ack"
    second = state.snapshot()["discussions"][0]["messages"][1]["delivery"][
        "recipients"
    ][0]
    assert second["read"] is True
    assert second["ack"] == "not_applicable"


def test_repeated_mentions_share_one_frozen_recipient_and_ack_fact() -> None:
    state = OrganizationState(message_clock=lambda: "2026-08-24T12:00:00.000Z")
    state.create_agent("Ada")
    state.create_discussion("Deduplicate", 1, [2])

    sent = state.send_message(1, 1, "@Ada review, then @Ada confirm")
    message = sent["discussions"][0]["messages"][0]
    assert len(message["references"]) == 2
    assert message["mentions"] == [{"member_id": 2, "status": "pending"}]
    assert len(message["delivery"]["recipients"]) == 1

    state.read_discussion(2, 1, start_message_id=1, limit=1)
    state.ack_messages(2, 1, [1, 1])
    acknowledged = state.snapshot()["discussions"][0]["messages"][0]
    assert acknowledged["mentions"] == [{"member_id": 2, "status": "acked"}]
    assert acknowledged["delivery"]["recipients"][0]["ack"] == "acked"


def test_new_human_does_not_change_historical_recipient_denominator() -> None:
    persisted_versions: list[dict[str, object]] = []
    state = OrganizationState(
        message_clock=lambda: "2026-08-24T12:00:00.000Z",
        on_persist=persisted_versions.append,
    )
    state.create_agent("Ada")
    state.create_discussion("Lifecycle", 1, [2])
    state.send_message(1, 1, "Before Guest")

    persisted = persisted_versions[-1]
    persisted["members"].append(
        {"id": 3, "type": "human", "name": "Guest", "deleted": False}
    )
    restored = OrganizationState(persisted=persisted)
    discussion = restored.snapshot()["discussions"][0]
    assert [
        recipient["member_id"]
        for recipient in discussion["messages"][0]["delivery"]["recipients"]
    ] == [2]
    guest_state = next(
        item for item in discussion["human_read_states"] if item["member_id"] == 3
    )
    assert guest_state["joined_after_message_id"] == 1
    assert 3 not in {
        frontier["member_id"] for frontier in discussion["activity_frontiers"]
    }

    after_join = restored.send_message(1, 2, "After Guest")
    latest_recipients = after_join["discussions"][0]["messages"][1]["delivery"][
        "recipients"
    ]
    assert [recipient["member_id"] for recipient in latest_recipients] == [1, 3]
    assert [
        recipient["member_id"]
        for recipient in after_join["discussions"][0]["messages"][0]["delivery"][
            "recipients"
        ]
    ] == [2]


def test_list_info_and_search_do_not_create_read_receipts() -> None:
    state = OrganizationState(message_clock=lambda: "2026-08-24T12:00:00.000Z")
    state.create_agent("Ada")
    state.create_discussion("No side effects", 1, [2])
    state.send_message(1, 1, "@Ada searchable")

    state.list_discussions(2)
    state.discussion_info(2, 1)
    state.search_messages("searchable", discussion_id=1, member_id=2)

    recipient = state.snapshot()["discussions"][0]["messages"][0]["delivery"][
        "recipients"
    ][0]
    assert recipient["read"] is False
    assert recipient["ack"] == "pending"


def test_agent_read_persists_only_a_new_receipt_and_never_implies_ack() -> None:
    persisted_versions: list[dict[str, object]] = []
    state = OrganizationState(
        message_clock=lambda: "2026-08-24T12:00:00.000Z",
        on_persist=persisted_versions.append,
    )
    state.create_agent("Ada")
    state.create_discussion("Exact read effects", 1, [2])
    state.send_message(1, 1, "@Ada inspect")
    persisted_versions.clear()

    empty = state.read_discussion(2, 1, start_message_id=2, limit=1)
    assert empty["messages"] == []
    assert persisted_versions == []

    state.read_discussion(2, 1, start_message_id=1, limit=1)
    assert len(persisted_versions) == 1
    discussion = state.snapshot()["discussions"][0]
    recipient = discussion["messages"][0]["delivery"]["recipients"][0]
    assert recipient["read"] is True
    assert recipient["ack"] == "pending"
    assert discussion["messages"][0]["mentions"] == [{"member_id": 2, "status": "read"}]
    assert discussion["activity_frontiers"] == [
        {"member_id": 1, "latest_activity_message_id": 1},
        {"member_id": 2, "latest_activity_message_id": 1},
    ]

    state.read_discussion(2, 1, start_message_id=1, limit=1)
    assert len(persisted_versions) == 1
    assert (
        state.snapshot()["discussions"][0]["messages"][0]["delivery"]["recipients"][0][
            "ack"
        ]
        == "pending"
    )

    state.ack_messages(2, 1, [1])
    assert len(persisted_versions) == 2
    acknowledged = state.snapshot()["discussions"][0]
    assert acknowledged["messages"][0]["delivery"]["recipients"][0] == {
        "member_id": 2,
        "member_type_at_send": "agent",
        "member_name_at_send": "Ada",
        "available": True,
        "mentioned": True,
        "read": True,
        "ack": "acked",
    }
    assert acknowledged["activity_frontiers"] == discussion["activity_frontiers"]
