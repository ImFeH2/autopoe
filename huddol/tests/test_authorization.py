from __future__ import annotations

from copy import deepcopy
from pathlib import Path

import pytest

from huddol.authorization import ActorContext, OrganizationOperations
from huddol.domain import DomainError, OrganizationState
from huddol.persistence import SQLiteStore
from huddol.protocol import Dispatcher


def persisted_authorization(
    tmp_path: Path,
) -> tuple[OrganizationState, SQLiteStore, OrganizationOperations]:
    store = SQLiteStore(tmp_path / "data")
    state = OrganizationState(
        tmp_path,
        persisted=store.load_organization(),
        on_persist=store.save_organization,
    )
    return state, store, OrganizationOperations(state, store)


def revision(operations: OrganizationOperations, actor: ActorContext) -> int:
    return operations.permissions(actor)["management_revision"]


def test_capability_matrix_and_admin_content_scope_are_separate(tmp_path: Path) -> None:
    state, _store, operations = persisted_authorization(tmp_path)
    human = ActorContext.current_human(state)
    operations.create_agent(human, 0, "Ada")
    operations.create_agent(human, 1, "Lin")
    operations.create_discussion(human, 2, "Ada private", [2])
    operations.create_discussion(human, 3, "Lin private", [3])
    ada = ActorContext.agent(2, "run-ada")
    lin = ActorContext.agent(3, "run-lin")

    assert operations.permissions(human)["role"] == "super_admin"
    assert operations.permissions(ada)["role"] == "member"
    assert operations.discussion_content_scope(ada) == frozenset({1})
    with pytest.raises(DomainError, match="Permission denied"):
        operations.metadata(ada)

    operations.grant_admin(human, 4, 2)

    permissions = operations.permissions(ada)
    assert permissions["role"] == "admin"
    assert "discussion.manage" in permissions["capabilities"]
    assert "organization.agent.manage" in permissions["capabilities"]
    created = operations.create_agent(ada, revision(operations, ada), "Grace")
    assert created["members"][-1]["name"] == "Grace"
    with pytest.raises(DomainError, match="Permission denied"):
        operations.grant_admin(ada, revision(operations, ada), 3)
    assert operations.discussion_content_scope(ada) == frozenset({1})
    with pytest.raises(DomainError) as unavailable:
        operations.require_discussion_content(ada, 2, lambda: "leaked")
    assert unavailable.value.code == "resource_unavailable"
    metadata = operations.metadata(ada)
    lin_discussion = next(item for item in metadata["discussions"] if item["id"] == 2)
    assert lin_discussion["topic"] == "Lin private"
    assert not (
        {"messages", "body", "preview", "references", "human_activity"}
        & set(lin_discussion)
    )
    assert operations.permissions(lin)["role"] == "member"


def test_trusted_actor_type_deleted_human_and_agent_self_escalation_fail_closed(
    tmp_path: Path,
) -> None:
    state, store, operations = persisted_authorization(tmp_path)
    human = ActorContext.current_human(state)
    operations.create_agent(human, 0, "Ada")
    ada = ActorContext.agent(2, "run")
    before = (
        state.snapshot(),
        store.load_authorization_state(),
        store.load_audit_events(),
    )

    with pytest.raises(DomainError) as forged:
        operations.permissions(ActorContext(2, "human"))
    assert forged.value.code == "invalid_request"
    with pytest.raises(DomainError) as escalation:
        operations.grant_admin(ada, 1, 2)
    assert escalation.value.code == "permission_denied"

    after = (
        state.snapshot(),
        store.load_authorization_state(),
        store.load_audit_events(),
    )
    assert after[0] == before[0]
    assert after[1] == before[1]
    assert len(after[2]) == len(before[2]) + 1
    assert after[2][-1].event.result == "failure"
    assert after[2][-1].event.metadata == {}

    state.delete_agent(2)
    with pytest.raises(DomainError) as deleted:
        operations.permissions(ada)
    assert deleted.value.code == "resource_unavailable"


def test_malformed_management_command_fails_before_state_or_audit_changes(
    tmp_path: Path,
) -> None:
    state, store, operations = persisted_authorization(tmp_path)
    human = ActorContext.current_human(state)
    before = (
        state.snapshot(),
        store.load_authorization_state(),
        store.load_audit_events(),
    )

    with pytest.raises(DomainError) as invalid_target:
        operations.delete_agent(human, 0, 0)
    assert invalid_target.value.code == "invalid_request"
    with pytest.raises(DomainError) as invalid_revision:
        operations.create_agent(human, False, "Ada")
    assert invalid_revision.value.code == "invalid_request"

    assert (
        state.snapshot(),
        store.load_authorization_state(),
        store.load_audit_events(),
    ) == before


def test_each_command_reauthorizes_and_checks_revision_at_execution(
    tmp_path: Path,
) -> None:
    state, store, operations = persisted_authorization(tmp_path)
    human = ActorContext.current_human(state)
    operations.create_agent(human, 0, "Ada")
    operations.grant_admin(human, 1, 2)
    operations.create_discussion(human, 2, "Managed", [2])
    ada = ActorContext.agent(2, "run")
    stale_revision = revision(operations, ada)
    operations.revoke_admin(human, stale_revision, 2)
    before = deepcopy(state.snapshot())

    with pytest.raises(DomainError) as revoked:
        operations.delete_discussion(ada, stale_revision + 1, 1, "Managed")
    assert revoked.value.code == "resource_unavailable"
    assert state.snapshot() == before

    with pytest.raises(DomainError) as stale:
        operations.create_agent(human, stale_revision, "Lin")
    assert stale.value.code == "revision_conflict"
    assert store.load_authorization_state().management_revision == stale_revision + 1
    failures = [
        event.event
        for event in store.load_audit_events()
        if event.event.result == "failure"
    ]
    assert failures[-1].metadata == {}


def test_success_is_atomic_and_not_published_when_store_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    state, store, operations = persisted_authorization(tmp_path)
    human = ActorContext.current_human(state)
    before_domain = deepcopy(state.snapshot())
    before_auth = store.load_authorization_state()
    before_audit = store.load_audit_events()

    def fail(*_args: object, **_kwargs: object) -> None:
        raise OSError("injected")

    monkeypatch.setattr(store, "commit_management_mutation", fail)
    with pytest.raises(OSError, match="injected"):
        operations.create_agent(human, 0, "Ada")

    assert state.snapshot() == before_domain
    assert store.load_authorization_state() == before_auth
    assert store.load_audit_events() == before_audit


def test_management_mutation_preserves_running_agent_execution(
    tmp_path: Path,
) -> None:
    state, _store, operations = persisted_authorization(tmp_path)
    human = ActorContext.current_human(state)
    operations.create_agent(human, 0, "Ada")
    operations.create_discussion(human, 1, "Work", [2])
    state.send_message(1, 1, "@Ada first")
    assert state.claim_next_reminder()[0] is not None

    operations.create_discussion(human, 2, "Another", [2])

    assert state.member(2)["status"] == "running"
    assert state.claim_next_reminder()[0] is None


def test_discussion_delete_requires_topic_and_preserves_other_content(
    tmp_path: Path,
) -> None:
    state, store, operations = persisted_authorization(tmp_path)
    human = ActorContext.current_human(state)
    operations.create_agent(human, 0, "Ada")
    operations.create_discussion(human, 1, "Keep", [2])
    operations.create_discussion(human, 2, "Delete", [2])
    state.send_message(1, 1, "keep body")
    state.send_message(2, 1, "delete body")
    before_keep = state.read_discussion(2, 1)

    with pytest.raises(DomainError) as mismatch:
        operations.delete_discussion(human, 3, 2, "wrong")
    assert mismatch.value.code == "resource_unavailable"
    assert state.read_discussion(2, 1) == before_keep

    operations.delete_discussion(human, 3, 2, "Delete")
    assert state.read_discussion(2, 1) == before_keep
    assert all(item["id"] != 2 for item in state.snapshot()["discussions"])
    assert store.load_audit_events()[-1].event.action == "discussion.delete"


def test_protocol_uses_fixed_human_actor_and_rejects_legacy_fields(
    tmp_path: Path,
) -> None:
    state, _store, operations = persisted_authorization(tmp_path)
    dispatcher = Dispatcher(state, operations=operations)

    rejected = dispatcher.dispatch(
        {
            "id": 1,
            "method": "organization.create_agent",
            "params": {"name": "Ada", "expected_revision": 0, "actor_id": 999},
        }
    )
    assert rejected["error"]["code"] == "invalid_request"

    created = dispatcher.dispatch(
        {
            "id": 2,
            "method": "organization.create_agent",
            "params": {"name": "Ada", "expected_revision": 0},
        }
    )
    assert created["result"]["members"][1]["name"] == "Ada"
    legacy_send = dispatcher.dispatch(
        {
            "id": 3,
            "method": "discussion.send",
            "params": {"discussion_id": 1, "body": "x", "sender_id": 2},
        }
    )
    assert legacy_send["error"]["code"] == "invalid_request"


def test_member_keeps_member_directory_and_discussion_creation(tmp_path: Path) -> None:
    state, store, operations = persisted_authorization(tmp_path)
    human = ActorContext.current_human(state)
    operations.create_agent(human, 0, "Ada")
    ada = ActorContext.agent(2, "run-ada")

    assert [member["name"] for member in operations.members(ada)] == ["You", "Ada"]
    assert operations.permissions(ada)["admin_agent_ids"] == []

    snapshot = operations.create_discussion(ada, 1, "Member room", [2])

    assert snapshot["discussions"][0]["member_ids"] == [1, 2]
    assert store.load_audit_events()[-1].event.actor_id == 2
    with pytest.raises(DomainError) as denied:
        operations.metadata(ada)
    assert denied.value.code == "permission_denied"


def test_admin_manages_nonmember_discussion_and_reads_only_own_audit(
    tmp_path: Path,
) -> None:
    state, _store, operations = persisted_authorization(tmp_path)
    human = ActorContext.current_human(state)
    operations.create_agent(human, 0, "Ada")
    operations.create_agent(human, 1, "Lin")
    operations.grant_admin(human, 2, 2)
    operations.create_discussion(human, 3, "Lin private", [3])
    ada = ActorContext.agent(2, "run-ada")
    lin = ActorContext.agent(3, "run-lin")

    metadata = operations.metadata(ada)
    assert metadata["discussions"][0]["last_activity_at"] is None
    operations.update_discussion_members(ada, 4, 1, [2, 3])
    state.send_message(1, 2, "Managed without a content bypass")

    refreshed = operations.metadata(ada)["discussions"][0]
    assert refreshed["last_activity_at"] is not None
    assert "messages" not in refreshed
    assert operations.permissions(human)["admin_agent_ids"] == [2]
    assert operations.permissions(ada)["admin_agent_ids"] == []
    assert [event["actor_id"] for event in operations.audit(ada)["events"]] == [2]
    with pytest.raises(DomainError) as denied:
        operations.audit(lin)
    assert denied.value.code == "permission_denied"
