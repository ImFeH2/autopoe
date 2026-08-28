from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from threading import Lock
from typing import TYPE_CHECKING, Any, Literal

from huddol.domain import DomainError, OrganizationState
from huddol.persistence import (
    AuditAction,
    AuditReasonCode,
    AuditUnavailableError,
    ManagementRevisionConflict,
    OrganizationAdminAssignment,
    OrganizationAuditEvent,
    OrganizationAuthorizationState,
    SQLiteStore,
)

if TYPE_CHECKING:
    from huddol.history import AgentHistory
    from huddol.memory import AgentMemory
    from huddol.todos import AgentTodos

ActorType = Literal["human", "agent"]
OrganizationRole = Literal["super_admin", "admin", "member"]
Capability = Literal[
    "organization.agent.manage",
    "organization.role.manage",
    "organization.members.read",
    "organization.permissions.read",
    "organization.metadata.read",
    "organization.audit.read",
    "organization.audit.read_own",
    "discussion.create",
    "discussion.manage",
]

SUPER_ADMIN_CAPABILITIES: tuple[Capability, ...] = (
    "organization.agent.manage",
    "organization.role.manage",
    "organization.members.read",
    "organization.permissions.read",
    "organization.metadata.read",
    "organization.audit.read",
    "discussion.create",
    "discussion.manage",
)
ADMIN_CAPABILITIES: tuple[Capability, ...] = (
    "organization.members.read",
    "organization.permissions.read",
    "organization.metadata.read",
    "organization.audit.read_own",
    "discussion.create",
    "discussion.manage",
)
MEMBER_CAPABILITIES: tuple[Capability, ...] = (
    "organization.members.read",
    "organization.permissions.read",
    "discussion.create",
)


@dataclass(frozen=True)
class ActorContext:
    member_id: int
    actor_type: ActorType
    run_id: str | None = None

    @classmethod
    def current_human(cls, state: OrganizationState) -> ActorContext:
        return cls(state.current_human_member_id, "human")

    @classmethod
    def agent(cls, agent_id: int, run_id: str | None) -> ActorContext:
        return cls(agent_id, "agent", run_id)


@dataclass(frozen=True)
class AuthorizationDecision:
    member_id: int
    member_type: ActorType
    member_name: str
    role: OrganizationRole
    capabilities: tuple[Capability, ...]


@dataclass(frozen=True)
class OrganizationPermissionsView:
    management_revision: int
    member_id: int
    role: OrganizationRole
    capabilities: tuple[Capability, ...]
    admin_agent_ids: tuple[int, ...]

    def data(self) -> dict[str, Any]:
        return {
            "management_revision": self.management_revision,
            "member_id": self.member_id,
            "role": self.role,
            "capabilities": list(self.capabilities),
            "admin_agent_ids": list(self.admin_agent_ids),
        }


@dataclass(frozen=True)
class OrganizationManagementMetadata:
    management_revision: int
    members: tuple[dict[str, Any], ...]
    discussions: tuple[dict[str, Any], ...]

    def data(self) -> dict[str, Any]:
        return {
            "management_revision": self.management_revision,
            "members": [dict(item) for item in self.members],
            "discussions": [dict(item) for item in self.discussions],
        }


class AuthorizationPolicy:
    def __init__(
        self,
        state: OrganizationState,
        authorization: OrganizationAuthorizationState,
    ) -> None:
        self._state = state
        self._authorization = authorization

    def decision(self, actor: ActorContext) -> AuthorizationDecision:
        try:
            member = self._state.member(actor.member_id)
        except DomainError as error:
            raise DomainError(
                "resource_unavailable", "Resource is unavailable"
            ) from error
        if member["type"] != actor.actor_type:
            raise DomainError(
                "invalid_request", "Actor type does not match trusted runtime identity"
            )
        admin_agent_ids = {
            assignment.agent_id for assignment in self._authorization.admin_assignments
        }
        if actor.actor_type == "human":
            role: OrganizationRole = "super_admin"
            capabilities = SUPER_ADMIN_CAPABILITIES
        elif actor.member_id in admin_agent_ids:
            role = "admin"
            capabilities = ADMIN_CAPABILITIES
        else:
            role = "member"
            capabilities = MEMBER_CAPABILITIES
        return AuthorizationDecision(
            actor.member_id,
            actor.actor_type,
            member["name"],
            role,
            capabilities,
        )

    def require(
        self,
        actor: ActorContext,
        capability: Capability,
    ) -> AuthorizationDecision:
        decision = self.decision(actor)
        if capability not in decision.capabilities:
            raise DomainError("permission_denied", "Permission denied")
        return decision

    def discussion_content_scope(self, actor: ActorContext) -> frozenset[int]:
        decision = self.decision(actor)
        return frozenset(
            discussion["id"]
            for discussion in self._state.list_discussions(decision.member_id)
        )

    def require_discussion_content(
        self,
        actor: ActorContext,
        discussion_id: int,
        view: Callable[[], Any],
    ) -> Any:
        if discussion_id not in self.discussion_content_scope(actor):
            raise DomainError("resource_unavailable", "Resource is unavailable")
        return view()


class OrganizationOperations:
    def __init__(
        self,
        state: OrganizationState,
        store: SQLiteStore | None = None,
        *,
        history: AgentHistory | None = None,
        todos: AgentTodos | None = None,
        memories: AgentMemory | None = None,
    ) -> None:
        self._state = state
        self._store = store
        self._history = history
        self._todos = todos
        self._memories = memories
        self._lock = Lock()

    def _require_store(self) -> SQLiteStore:
        if self._store is None:
            raise RuntimeError("Organization authorization store is unavailable")
        return self._store

    def _authorization(self) -> OrganizationAuthorizationState:
        return self._require_store().load_authorization_state()

    def _policy(
        self, authorization: OrganizationAuthorizationState
    ) -> AuthorizationPolicy:
        return AuthorizationPolicy(self._state, authorization)

    @staticmethod
    def _now() -> str:
        return datetime.now(UTC).isoformat(timespec="milliseconds")

    def _audit_actor(
        self,
        actor: ActorContext,
    ) -> tuple[int | None, ActorType | None, str | None]:
        try:
            member = self._state.member(actor.member_id)
        except DomainError:
            return None, None, None
        if member["type"] != actor.actor_type:
            return None, None, None
        return actor.member_id, actor.actor_type, member["name"]

    def _append_failure(
        self,
        actor: ActorContext,
        *,
        action: AuditAction,
        target_type: Literal["organization", "member", "discussion"],
        target_id: int,
        reason_code: AuditReasonCode,
    ) -> None:
        actor_id, actor_type, actor_name = self._audit_actor(actor)
        try:
            self._require_store().append_failure_audit(
                OrganizationAuditEvent(
                    occurred_at=self._now(),
                    actor_id=actor_id,
                    actor_type=actor_type,
                    actor_name=actor_name,
                    action=action,
                    target_type=target_type,
                    target_id=target_id,
                    result="failure",
                    reason_code=reason_code,
                    metadata={},
                )
            )
        except AuditUnavailableError as error:
            raise DomainError(
                "audit_unavailable", "Organization audit is unavailable"
            ) from error

    @staticmethod
    def _reason(error: DomainError) -> AuditReasonCode:
        if error.code == "revision_conflict":
            return "revision_conflict"
        if error.code == "resource_unavailable":
            return "resource_unavailable"
        if error.code in {"member_not_found", "discussion_not_found", "not_an_agent"}:
            return "invalid_target"
        if error.code in {"agent_running", "agent_busy", "self_delete"}:
            return "invalid_state"
        return "invalid_request"

    def _execute(
        self,
        actor: ActorContext,
        *,
        expected_revision: int,
        capability: Capability,
        action: AuditAction,
        target_type: Literal["organization", "member", "discussion"],
        target_id: int,
        mutate: Callable[
            [OrganizationState, tuple[OrganizationAdminAssignment, ...]],
            tuple[Sequence[OrganizationAdminAssignment], dict[str, object]],
        ],
    ) -> dict[str, Any]:
        if type(expected_revision) is not int or expected_revision < 0:
            raise DomainError(
                "invalid_request", "Expected revision must be a nonnegative integer"
            )
        if type(target_id) is not int or target_id < 1:
            raise DomainError("invalid_request", "Target ID must be a positive integer")
        store = self._require_store()
        with self._lock, self._state.management_guard():
            authorization = store.load_authorization_state()
            policy = self._policy(authorization)
            try:
                decision = policy.require(actor, capability)
                if authorization.management_revision != expected_revision:
                    raise DomainError(
                        "revision_conflict", "Organization management revision is stale"
                    )
                candidate = self._state.management_candidate()
                assignments, metadata = mutate(
                    candidate, authorization.admin_assignments
                )
                replacement = candidate.prepare_management_replacement()
                event = OrganizationAuditEvent(
                    occurred_at=self._now(),
                    actor_id=decision.member_id,
                    actor_type=decision.member_type,
                    actor_name=decision.member_name,
                    action=action,
                    target_type=target_type,
                    target_id=target_id,
                    result="success",
                    metadata=metadata,
                )
                store.commit_management_mutation(
                    expected_revision=expected_revision,
                    organization=replacement.persistence_data,
                    admin_assignments=assignments,
                    audit_event=event,
                )
            except ManagementRevisionConflict as error:
                self._append_failure(
                    actor,
                    action=action,
                    target_type=target_type,
                    target_id=target_id,
                    reason_code="revision_conflict",
                )
                raise DomainError(
                    "revision_conflict", "Organization management revision is stale"
                ) from error
            except AuditUnavailableError as error:
                raise DomainError(
                    "audit_unavailable", "Organization audit is unavailable"
                ) from error
            except DomainError as error:
                self._append_failure(
                    actor,
                    action=action,
                    target_type=target_type,
                    target_id=target_id,
                    reason_code=self._reason(error),
                )
                raise
            return self._state.publish_management_replacement(replacement)

    def discussion_content_scope(self, actor: ActorContext) -> frozenset[int]:
        with self._lock, self._state.management_guard():
            return self._policy(self._authorization()).discussion_content_scope(actor)

    def require_discussion_content(
        self,
        actor: ActorContext,
        discussion_id: int,
        view: Callable[[], Any],
    ) -> Any:
        with self._lock, self._state.management_guard():
            return self._policy(self._authorization()).require_discussion_content(
                actor, discussion_id, view
            )

    def permissions(self, actor: ActorContext) -> dict[str, Any]:
        with self._lock, self._state.management_guard():
            authorization = self._authorization()
            decision = self._policy(authorization).require(
                actor, "organization.permissions.read"
            )
            return OrganizationPermissionsView(
                authorization.management_revision,
                decision.member_id,
                decision.role,
                decision.capabilities,
                (
                    tuple(
                        assignment.agent_id
                        for assignment in authorization.admin_assignments
                    )
                    if decision.role == "super_admin"
                    else ()
                ),
            ).data()

    def members(self, actor: ActorContext) -> list[dict[str, Any]]:
        with self._lock, self._state.management_guard():
            authorization = self._authorization()
            self._policy(authorization).require(actor, "organization.members.read")
            return self._state.list_members()

    def metadata(self, actor: ActorContext) -> dict[str, Any]:
        with self._lock, self._state.management_guard():
            authorization = self._authorization()
            self._policy(authorization).require(actor, "organization.metadata.read")
            snapshot = self._state.snapshot()
            members = tuple(
                {
                    "id": member["id"],
                    "type": member["type"],
                    "name": member["name"],
                    **(
                        {"status": member["status"]}
                        if member["type"] == "agent"
                        else {}
                    ),
                }
                for member in snapshot["members"]
            )
            discussions = tuple(
                {
                    "id": discussion["id"],
                    "topic": discussion["topic"],
                    "member_ids": list(discussion["member_ids"]),
                    "member_count": len(discussion["member_ids"]),
                    "message_count": len(discussion["messages"]),
                    "latest_message_id": (
                        discussion["messages"][-1]["id"]
                        if discussion["messages"]
                        else 0
                    ),
                    "last_activity_at": (
                        discussion["messages"][-1]["created_at"]
                        if discussion["messages"]
                        else None
                    ),
                }
                for discussion in snapshot["discussions"]
            )
            return OrganizationManagementMetadata(
                authorization.management_revision,
                members,
                discussions,
            ).data()

    def audit(self, actor: ActorContext) -> dict[str, Any]:
        with self._lock, self._state.management_guard():
            authorization = self._authorization()
            policy = self._policy(authorization)
            decision = policy.decision(actor)
            policy.require(
                actor,
                "organization.audit.read"
                if decision.role == "super_admin"
                else "organization.audit.read_own",
            )
            events = self._require_store().load_audit_events()
            if decision.role == "admin":
                events = tuple(
                    persisted
                    for persisted in events
                    if persisted.event.actor_id == decision.member_id
                )
            return {
                "events": [
                    {
                        "id": persisted.id,
                        "occurred_at": persisted.event.occurred_at,
                        "actor_id": persisted.event.actor_id,
                        "actor_type": persisted.event.actor_type,
                        "actor_name": persisted.event.actor_name,
                        "action": persisted.event.action,
                        "target_type": persisted.event.target_type,
                        "target_id": persisted.event.target_id,
                        "result": persisted.event.result,
                        "reason_code": persisted.event.reason_code,
                        "metadata": dict(persisted.event.metadata or {}),
                    }
                    for persisted in events
                ]
            }

    def create_agent(
        self, actor: ActorContext, expected_revision: int, name: str
    ) -> dict[str, Any]:
        def mutate(
            candidate: OrganizationState,
            assignments: tuple[OrganizationAdminAssignment, ...],
        ) -> tuple[Sequence[OrganizationAdminAssignment], dict[str, object]]:
            before_ids = [
                item["id"]
                for item in candidate.list_members()
                if item["type"] == "agent"
            ]
            candidate.create_agent(name)
            after_ids = [
                item["id"]
                for item in candidate.list_members()
                if item["type"] == "agent"
            ]
            return assignments, {
                "before_agent_member_ids": before_ids,
                "after_agent_member_ids": after_ids,
            }

        return self._execute(
            actor,
            expected_revision=expected_revision,
            capability="organization.agent.manage",
            action="organization.agent.create",
            target_type="organization",
            target_id=1,
            mutate=mutate,
        )

    def pause_agent(
        self, actor: ActorContext, expected_revision: int, agent_id: int
    ) -> dict[str, Any]:
        return self._agent_mutation(
            actor,
            expected_revision,
            agent_id,
            "organization.agent.pause",
            lambda candidate: candidate.pause_agent(agent_id),
        )

    def resume_agent(
        self, actor: ActorContext, expected_revision: int, agent_id: int
    ) -> dict[str, Any]:
        return self._agent_mutation(
            actor,
            expected_revision,
            agent_id,
            "organization.agent.resume",
            lambda candidate: candidate.resume_agent(agent_id),
        )

    def delete_agent(
        self, actor: ActorContext, expected_revision: int, agent_id: int
    ) -> dict[str, Any]:
        def operation(candidate: OrganizationState) -> None:
            if actor.actor_type == "agent" and actor.member_id == agent_id:
                raise DomainError("self_delete", "An Agent cannot delete itself")
            candidate.delete_agent(agent_id)

        snapshot = self._agent_mutation(
            actor,
            expected_revision,
            agent_id,
            "organization.agent.delete",
            operation,
            revoke_deleted_agent=True,
        )
        if self._history is not None:
            self._history.delete(agent_id)
        if self._todos is not None:
            self._todos.delete_all(agent_id)
        if self._memories is not None:
            self._memories.delete_all(agent_id)
        return snapshot

    def _agent_mutation(
        self,
        actor: ActorContext,
        expected_revision: int,
        agent_id: int,
        action: AuditAction,
        operation: Callable[[OrganizationState], None],
        *,
        revoke_deleted_agent: bool = False,
    ) -> dict[str, Any]:
        def mutate(
            candidate: OrganizationState,
            assignments: tuple[OrganizationAdminAssignment, ...],
        ) -> tuple[Sequence[OrganizationAdminAssignment], dict[str, object]]:
            before_ids = [
                item["id"]
                for item in candidate.list_members()
                if item["type"] == "agent"
            ]
            operation(candidate)
            next_assignments = (
                tuple(item for item in assignments if item.agent_id != agent_id)
                if revoke_deleted_agent
                else assignments
            )
            after_ids = [
                item["id"]
                for item in candidate.list_members()
                if item["type"] == "agent"
            ]
            return next_assignments, {
                "before_agent_member_ids": before_ids,
                "after_agent_member_ids": after_ids,
            }

        return self._execute(
            actor,
            expected_revision=expected_revision,
            capability="organization.agent.manage",
            action=action,
            target_type="member",
            target_id=agent_id,
            mutate=mutate,
        )

    def grant_admin(
        self, actor: ActorContext, expected_revision: int, agent_id: int
    ) -> dict[str, Any]:
        return self._role_mutation(actor, expected_revision, agent_id, True)

    def revoke_admin(
        self, actor: ActorContext, expected_revision: int, agent_id: int
    ) -> dict[str, Any]:
        return self._role_mutation(actor, expected_revision, agent_id, False)

    def _role_mutation(
        self,
        actor: ActorContext,
        expected_revision: int,
        agent_id: int,
        grant: bool,
    ) -> dict[str, Any]:
        def mutate(
            candidate: OrganizationState,
            assignments: tuple[OrganizationAdminAssignment, ...],
        ) -> tuple[Sequence[OrganizationAdminAssignment], dict[str, object]]:
            member = candidate.member(agent_id)
            if member["type"] != "agent":
                raise DomainError("not_an_agent", "Member is not an Agent")
            before_ids = [item.agent_id for item in assignments]
            if grant:
                if agent_id in before_ids:
                    next_assignments = assignments
                else:
                    next_assignments = (
                        *assignments,
                        OrganizationAdminAssignment(
                            agent_id,
                            self._now(),
                            actor.member_id,
                        ),
                    )
            else:
                next_assignments = tuple(
                    item for item in assignments if item.agent_id != agent_id
                )
            after_ids = [item.agent_id for item in next_assignments]
            return next_assignments, {
                "before_admin_agent_ids": before_ids,
                "after_admin_agent_ids": after_ids,
            }

        return self._execute(
            actor,
            expected_revision=expected_revision,
            capability="organization.role.manage",
            action="organization.role.grant" if grant else "organization.role.revoke",
            target_type="member",
            target_id=agent_id,
            mutate=mutate,
        )

    def create_discussion(
        self,
        actor: ActorContext,
        expected_revision: int,
        topic: str,
        member_ids: Sequence[int],
    ) -> dict[str, Any]:
        def mutate(
            candidate: OrganizationState,
            assignments: tuple[OrganizationAdminAssignment, ...],
        ) -> tuple[Sequence[OrganizationAdminAssignment], dict[str, object]]:
            before_ids = {item["id"] for item in candidate.list_discussions()}
            candidate.create_discussion(topic, actor.member_id, member_ids)
            created = next(
                item
                for item in candidate.snapshot()["discussions"]
                if item["id"] not in before_ids
            )
            return assignments, {
                "discussion_topic": created["topic"],
                "member_ids": list(created["member_ids"]),
                "member_count": len(created["member_ids"]),
                "message_count": 0,
                "latest_message_id": 0,
                "last_activity_at": None,
            }

        return self._execute(
            actor,
            expected_revision=expected_revision,
            capability="discussion.create",
            action="discussion.create",
            target_type="organization",
            target_id=1,
            mutate=mutate,
        )

    def update_discussion_members(
        self,
        actor: ActorContext,
        expected_revision: int,
        discussion_id: int,
        member_ids: Sequence[int],
    ) -> dict[str, Any]:
        def mutate(
            candidate: OrganizationState,
            assignments: tuple[OrganizationAdminAssignment, ...],
        ) -> tuple[Sequence[OrganizationAdminAssignment], dict[str, object]]:
            try:
                before = next(
                    item
                    for item in candidate.snapshot()["discussions"]
                    if item["id"] == discussion_id
                )
            except StopIteration as error:
                raise DomainError(
                    "resource_unavailable", "Resource is unavailable"
                ) from error
            candidate.update_discussion_members(discussion_id, member_ids)
            after = next(
                item
                for item in candidate.snapshot()["discussions"]
                if item["id"] == discussion_id
            )
            return assignments, {
                "discussion_topic": after["topic"],
                "before_agent_member_ids": [
                    member_id
                    for member_id in before["member_ids"]
                    if candidate.member(member_id)["type"] == "agent"
                ],
                "after_agent_member_ids": [
                    member_id
                    for member_id in after["member_ids"]
                    if candidate.member(member_id)["type"] == "agent"
                ],
            }

        return self._execute(
            actor,
            expected_revision=expected_revision,
            capability="discussion.manage",
            action="discussion.members.update",
            target_type="discussion",
            target_id=discussion_id,
            mutate=mutate,
        )

    def delete_discussion(
        self,
        actor: ActorContext,
        expected_revision: int,
        discussion_id: int,
        confirm_topic: str,
    ) -> dict[str, Any]:
        def mutate(
            candidate: OrganizationState,
            assignments: tuple[OrganizationAdminAssignment, ...],
        ) -> tuple[Sequence[OrganizationAdminAssignment], dict[str, object]]:
            try:
                discussion = next(
                    item
                    for item in candidate.snapshot()["discussions"]
                    if item["id"] == discussion_id
                )
            except StopIteration as error:
                raise DomainError(
                    "resource_unavailable", "Resource is unavailable"
                ) from error
            if confirm_topic != discussion["topic"]:
                raise DomainError("resource_unavailable", "Resource is unavailable")
            messages = discussion["messages"]
            metadata = {
                "discussion_topic": discussion["topic"],
                "member_ids": list(discussion["member_ids"]),
                "member_count": len(discussion["member_ids"]),
                "message_count": len(messages),
                "latest_message_id": messages[-1]["id"] if messages else 0,
                "last_activity_at": messages[-1]["created_at"] if messages else None,
            }
            candidate.delete_discussion(discussion_id)
            return assignments, metadata

        try:
            return self._execute(
                actor,
                expected_revision=expected_revision,
                capability="discussion.manage",
                action="discussion.delete",
                target_type="discussion",
                target_id=discussion_id,
                mutate=mutate,
            )
        except DomainError as error:
            if error.code in {"permission_denied", "discussion_not_found"}:
                raise DomainError(
                    "resource_unavailable", "Resource is unavailable"
                ) from error
            raise
