from __future__ import annotations

import json
import os
import sqlite3
import time
from collections.abc import Iterator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from huddol.diagnostics import log_event, log_exception
from huddol.history import RunStatus
from huddol.mentions import MentionName, find_mentions, mention_syntax_issues
from huddol.todos import TodoStatus

LEGACY_SCHEMA_VERSION = 11
MESSAGE_IDENTITY_SCHEMA_VERSION = 12
HUMAN_READ_STATE_SCHEMA_VERSION = 13
MESSAGE_CREATED_AT_SCHEMA_VERSION = 14
GLOBAL_HUMAN_MEMBERSHIP_SCHEMA_VERSION = 15
DELIVERY_SCHEMA_VERSION = 16
EXECUTION_SETTINGS_SCHEMA_VERSION = 17
AUTHORIZATION_SCHEMA_VERSION = 18
LIBRARY_SCHEMA_VERSION = 19
SCHEMA_VERSION = 20
DATA_DIRECTORY_ENV = "HUDDOL_DATA_DIR"

AuditAction = Literal[
    "organization.agent.create",
    "organization.agent.delete",
    "organization.agent.pause",
    "organization.agent.resume",
    "organization.role.grant",
    "organization.role.revoke",
    "discussion.create",
    "discussion.members.update",
    "discussion.delete",
]
AuditActorType = Literal["human", "agent"]
AuditTargetType = Literal["organization", "member", "discussion"]
AuditResult = Literal["success", "failure"]
AuditReasonCode = Literal[
    "invalid_request",
    "resource_unavailable",
    "revision_conflict",
    "invalid_target",
    "invalid_state",
    "persistence_failure",
]

AUDIT_ACTIONS = (
    "organization.agent.create",
    "organization.agent.delete",
    "organization.agent.pause",
    "organization.agent.resume",
    "organization.role.grant",
    "organization.role.revoke",
    "discussion.create",
    "discussion.members.update",
    "discussion.delete",
)
AUDIT_ACTOR_TYPES = ("human", "agent")
AUDIT_TARGET_TYPES = ("organization", "member", "discussion")
AUDIT_RESULTS = ("success", "failure")
AUDIT_REASON_CODES = (
    "invalid_request",
    "resource_unavailable",
    "revision_conflict",
    "invalid_target",
    "invalid_state",
    "persistence_failure",
)
AUDIT_METADATA_KEYS = frozenset(
    {
        "discussion_topic",
        "member_ids",
        "member_count",
        "message_count",
        "latest_message_id",
        "last_activity_at",
        "before_admin_agent_ids",
        "after_admin_agent_ids",
        "before_agent_member_ids",
        "after_agent_member_ids",
    }
)
_AUDIT_ID_LIST_KEYS = frozenset(
    {
        "member_ids",
        "before_admin_agent_ids",
        "after_admin_agent_ids",
        "before_agent_member_ids",
        "after_agent_member_ids",
    }
)
_AUDIT_COUNT_KEYS = frozenset({"member_count", "message_count", "latest_message_id"})


@dataclass(frozen=True)
class OrganizationAdminAssignment:
    agent_id: int
    granted_at: str
    granted_by_human_id: int


@dataclass(frozen=True)
class OrganizationAuditEvent:
    occurred_at: str
    actor_id: int | None
    actor_type: AuditActorType | None
    actor_name: str | None
    action: AuditAction
    target_type: AuditTargetType
    target_id: int
    result: AuditResult
    reason_code: AuditReasonCode | None = None
    metadata: Mapping[str, object] | None = None


@dataclass(frozen=True)
class PersistedOrganizationAuditEvent:
    id: int
    event: OrganizationAuditEvent


@dataclass(frozen=True)
class OrganizationAuthorizationState:
    management_revision: int
    admin_assignments: tuple[OrganizationAdminAssignment, ...]


class AuthorizationDataError(RuntimeError):
    pass


class ManagementRevisionConflict(RuntimeError):
    pass


class AuditUnavailableError(RuntimeError):
    pass


def data_directory() -> Path:
    override = os.environ.get(DATA_DIRECTORY_ENV)
    if override:
        return Path(override).expanduser().resolve()
    return Path.home() / ".huddol"


def organization_metrics(organization: dict[str, Any]) -> dict[str, int]:
    discussions = organization["discussions"]
    return {
        "member_count": len(organization["members"]),
        "discussion_count": len(discussions),
        "message_count": sum(len(item["messages"]) for item in discussions),
    }


def _positive_integer(value: object, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise AuthorizationDataError(f"{label} must be a positive integer")
    return value


def _nonnegative_integer(value: object, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise AuthorizationDataError(f"{label} must be a nonnegative integer")
    return value


def _utc_timestamp(value: object, label: str) -> str:
    if not isinstance(value, str) or not value:
        raise AuthorizationDataError(f"{label} must be a UTC timestamp")
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as error:
        raise AuthorizationDataError(f"{label} must be a UTC timestamp") from error
    if parsed.tzinfo is None or parsed.utcoffset() != UTC.utcoffset(parsed):
        raise AuthorizationDataError(f"{label} must be a UTC timestamp")
    return value


def _audit_metadata(value: object) -> dict[str, object]:
    if not isinstance(value, Mapping):
        raise AuthorizationDataError("Organization audit metadata must be an object")
    unknown = set(value) - AUDIT_METADATA_KEYS
    if unknown:
        raise AuthorizationDataError(
            "Organization audit metadata contains unsupported fields: "
            + ", ".join(sorted(str(item) for item in unknown))
        )
    normalized: dict[str, object] = {}
    for key, item in value.items():
        if not isinstance(key, str):
            raise AuthorizationDataError(
                "Organization audit metadata keys must be strings"
            )
        if key == "discussion_topic":
            if not isinstance(item, str):
                raise AuthorizationDataError(
                    "Organization audit discussion_topic must be text"
                )
            normalized[key] = item
        elif key == "last_activity_at":
            normalized[key] = (
                None
                if item is None
                else _utc_timestamp(item, "Organization audit last_activity_at")
            )
        elif key in _AUDIT_COUNT_KEYS:
            normalized[key] = _nonnegative_integer(item, f"Organization audit {key}")
        elif key in _AUDIT_ID_LIST_KEYS:
            if isinstance(item, (str, bytes)) or not isinstance(item, Sequence):
                raise AuthorizationDataError(
                    f"Organization audit {key} must be an ID list"
                )
            ids = tuple(
                _positive_integer(member_id, f"Organization audit {key} item")
                for member_id in item
            )
            if len(ids) != len(set(ids)):
                raise AuthorizationDataError(
                    f"Organization audit {key} must not contain duplicates"
                )
            normalized[key] = list(ids)
    return normalized


def _canonical_audit_metadata_json(metadata: Mapping[str, object]) -> str:
    return json.dumps(
        metadata,
        ensure_ascii=False,
        allow_nan=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def _load_audit_metadata_json(value: object) -> dict[str, object]:
    if not isinstance(value, str):
        raise AuthorizationDataError(
            "Persisted Organization audit metadata JSON is invalid"
        )

    def reject_duplicate_keys(pairs: list[tuple[str, object]]) -> dict[str, object]:
        result: dict[str, object] = {}
        for key, item in pairs:
            if key in result:
                raise AuthorizationDataError(
                    "Persisted Organization audit metadata contains duplicate keys"
                )
            result[key] = item
        return result

    try:
        parsed = json.loads(
            value,
            object_pairs_hook=reject_duplicate_keys,
            parse_constant=lambda _value: (_ for _ in ()).throw(
                AuthorizationDataError(
                    "Persisted Organization audit metadata JSON is invalid"
                )
            ),
        )
    except (json.JSONDecodeError, TypeError, ValueError) as error:
        raise AuthorizationDataError(
            "Persisted Organization audit metadata JSON is invalid"
        ) from error
    metadata = _audit_metadata(parsed)
    if _canonical_audit_metadata_json(metadata) != value:
        raise AuthorizationDataError(
            "Persisted Organization audit metadata JSON is not canonical"
        )
    return metadata


def _validated_audit_event(event: OrganizationAuditEvent) -> OrganizationAuditEvent:
    occurred_at = _utc_timestamp(event.occurred_at, "Organization audit occurred_at")
    if event.action not in AUDIT_ACTIONS:
        raise AuthorizationDataError("Organization audit action is invalid")
    if event.target_type not in AUDIT_TARGET_TYPES:
        raise AuthorizationDataError("Organization audit target type is invalid")
    target_id = _positive_integer(event.target_id, "Organization audit target_id")
    if event.result not in AUDIT_RESULTS:
        raise AuthorizationDataError("Organization audit result is invalid")
    if event.reason_code is not None and event.reason_code not in AUDIT_REASON_CODES:
        raise AuthorizationDataError("Organization audit reason code is invalid")
    metadata = _audit_metadata({} if event.metadata is None else event.metadata)
    if event.result == "failure" and metadata:
        raise AuthorizationDataError(
            "Organization failure audit metadata must be empty"
        )
    if event.actor_id is None:
        if event.actor_type is not None or event.actor_name is not None:
            raise AuthorizationDataError(
                "Organization audit anonymous actor fields are invalid"
            )
        actor_id = None
        actor_type = None
        actor_name = None
    else:
        actor_id = _positive_integer(event.actor_id, "Organization audit actor_id")
        if event.actor_type not in AUDIT_ACTOR_TYPES:
            raise AuthorizationDataError("Organization audit actor type is invalid")
        if not isinstance(event.actor_name, str) or not event.actor_name:
            raise AuthorizationDataError("Organization audit actor name is invalid")
        actor_type = event.actor_type
        actor_name = event.actor_name
    return OrganizationAuditEvent(
        occurred_at=occurred_at,
        actor_id=actor_id,
        actor_type=actor_type,
        actor_name=actor_name,
        action=event.action,
        target_type=event.target_type,
        target_id=target_id,
        result=event.result,
        reason_code=event.reason_code,
        metadata=metadata,
    )


class SQLiteStore:
    def __init__(self, directory: Path) -> None:
        started = time.monotonic()
        self.directory = directory
        self.path = directory / "huddol.sqlite3"
        log_event("database.open.started", database_path=str(self.path))
        version = -1
        try:
            self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
            self.directory.chmod(0o700)
            with self._connect() as connection:
                version = connection.execute("PRAGMA user_version").fetchone()[0]
                if version == 0:
                    self._create_schema(connection)
                elif 1 <= version <= 10:
                    migrations = {
                        1: self._migrate_version_one,
                        2: self._migrate_version_two,
                        3: self._migrate_version_three,
                        4: self._migrate_version_four,
                        5: self._migrate_version_five,
                        6: self._migrate_version_six,
                        7: self._migrate_version_seven,
                        8: self._migrate_version_eight,
                        9: self._migrate_version_nine,
                        10: self._migrate_version_ten,
                    }
                    migrations[version](connection)
                    self._migrate_version_eleven(connection)
                    self._migrate_version_twelve(connection)
                    self._migrate_version_thirteen(connection)
                    self._migrate_version_fourteen(connection)
                    self._migrate_version_fifteen(connection)
                    self._migrate_version_sixteen(connection)
                    self._migrate_version_seventeen(connection)
                elif version == LEGACY_SCHEMA_VERSION:
                    self._migrate_version_eleven(connection)
                    self._migrate_version_twelve(connection)
                    self._migrate_version_thirteen(connection)
                    self._migrate_version_fourteen(connection)
                    self._migrate_version_fifteen(connection)
                    self._migrate_version_sixteen(connection)
                    self._migrate_version_seventeen(connection)
                elif version == MESSAGE_IDENTITY_SCHEMA_VERSION:
                    self._migrate_version_twelve(connection)
                    self._migrate_version_thirteen(connection)
                    self._migrate_version_fourteen(connection)
                    self._migrate_version_fifteen(connection)
                    self._migrate_version_sixteen(connection)
                    self._migrate_version_seventeen(connection)
                elif version == HUMAN_READ_STATE_SCHEMA_VERSION:
                    self._migrate_version_thirteen(connection)
                    self._migrate_version_fourteen(connection)
                    self._migrate_version_fifteen(connection)
                    self._migrate_version_sixteen(connection)
                    self._migrate_version_seventeen(connection)
                elif version == MESSAGE_CREATED_AT_SCHEMA_VERSION:
                    self._migrate_version_fourteen(connection)
                    self._migrate_version_fifteen(connection)
                    self._migrate_version_sixteen(connection)
                    self._migrate_version_seventeen(connection)
                elif version == GLOBAL_HUMAN_MEMBERSHIP_SCHEMA_VERSION:
                    self._migrate_version_fifteen(connection)
                    self._migrate_version_sixteen(connection)
                    self._migrate_version_seventeen(connection)
                elif version == DELIVERY_SCHEMA_VERSION:
                    self._migrate_version_sixteen(connection)
                    self._migrate_version_seventeen(connection)
                elif version == EXECUTION_SETTINGS_SCHEMA_VERSION:
                    self._migrate_version_seventeen(connection)
                elif version == AUTHORIZATION_SCHEMA_VERSION:
                    self._migrate_version_eighteen(connection)
                elif version == LIBRARY_SCHEMA_VERSION:
                    self._migrate_version_nineteen(connection)
                elif version != SCHEMA_VERSION:
                    raise RuntimeError(
                        f"Unsupported Huddol database version: {version}"
                    )
                if (
                    connection.execute("PRAGMA user_version").fetchone()[0]
                    == AUTHORIZATION_SCHEMA_VERSION
                ):
                    self._migrate_version_eighteen(connection)
                if (
                    connection.execute("PRAGMA user_version").fetchone()[0]
                    == LIBRARY_SCHEMA_VERSION
                ):
                    self._migrate_version_nineteen(connection)
                self._validate_authorization_storage(connection)
                interrupted_runs = self._interrupt_running_agent_runs(connection)
                orphaned_todos = self._delete_orphaned_agent_todos(connection)
            self.path.chmod(0o600)
        except (OSError, RuntimeError, sqlite3.Error) as error:
            log_exception(
                "database.open.failed",
                error,
                database_path=str(self.path),
                previous_schema_version=version,
                duration_ms=round((time.monotonic() - started) * 1000),
            )
            raise
        log_event(
            "database.open.completed",
            database_path=str(self.path),
            previous_schema_version=version,
            schema_version=SCHEMA_VERSION,
            interrupted_runs=interrupted_runs,
            orphaned_todos=orphaned_todos,
            duration_ms=round((time.monotonic() - started) * 1000),
        )

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.path, timeout=5)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA secure_delete = ON")
        try:
            yield connection
        finally:
            connection.close()

    def _preflight_database_permissions(self) -> None:
        self.path.chmod(0o600)

    @staticmethod
    @contextmanager
    def _migration_transaction(connection: sqlite3.Connection) -> Iterator[None]:
        connection.execute("BEGIN IMMEDIATE")
        try:
            yield
        except BaseException:
            connection.rollback()
            raise
        else:
            connection.commit()

    def _create_schema(self, connection: sqlite3.Connection) -> None:
        with self._migration_transaction(connection):
            self._create_tables(connection)
            connection.execute(
                "INSERT INTO application_state (id, organization_saved) VALUES (1, 0)"
            )
            connection.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")

    @staticmethod
    def _create_tables(connection: sqlite3.Connection) -> None:
        statements = (
            """
            CREATE TABLE application_state (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                organization_saved INTEGER NOT NULL DEFAULT 0
                    CHECK (organization_saved IN (0, 1)),
                management_revision INTEGER NOT NULL DEFAULT 0
                    CHECK (management_revision >= 0)
            )
            """,
            """
            CREATE TABLE members (
                id INTEGER PRIMARY KEY,
                type TEXT NOT NULL CHECK (type IN ('human', 'agent')),
                name TEXT NOT NULL,
                deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
                paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0, 1))
            )
            """,
            """
            CREATE TABLE discussions (
                id INTEGER PRIMARY KEY,
                topic TEXT NOT NULL
            )
            """,
            """
            CREATE TABLE discussion_members (
                discussion_id INTEGER NOT NULL,
                position INTEGER NOT NULL,
                member_id INTEGER NOT NULL,
                active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
                joined_after_message_id INTEGER NOT NULL DEFAULT 0
                    CHECK (joined_after_message_id >= 0),
                PRIMARY KEY (discussion_id, position),
                UNIQUE (discussion_id, member_id),
                FOREIGN KEY (discussion_id) REFERENCES discussions (id)
                    ON DELETE CASCADE,
                FOREIGN KEY (member_id) REFERENCES members (id)
            )
            """,
            """
            CREATE TABLE messages (
                discussion_id INTEGER NOT NULL,
                id INTEGER NOT NULL,
                sender_id INTEGER NOT NULL,
                sender_name TEXT NOT NULL,
                body TEXT NOT NULL,
                created_at TEXT,
                recipient_snapshot_known INTEGER NOT NULL DEFAULT 0
                    CHECK (recipient_snapshot_known IN (0, 1)),
                PRIMARY KEY (discussion_id, id),
                FOREIGN KEY (discussion_id) REFERENCES discussions (id)
                    ON DELETE CASCADE,
                FOREIGN KEY (sender_id) REFERENCES members (id)
            )
            """,
            """
            CREATE TABLE mentions (
                discussion_id INTEGER NOT NULL,
                message_id INTEGER NOT NULL,
                position INTEGER NOT NULL,
                member_id INTEGER NOT NULL,
                read INTEGER NOT NULL CHECK (read IN (0, 1)),
                acked INTEGER NOT NULL CHECK (acked IN (0, 1)),
                reminded INTEGER NOT NULL DEFAULT 0 CHECK (reminded IN (0, 1)),
                PRIMARY KEY (discussion_id, message_id, position),
                UNIQUE (discussion_id, message_id, member_id),
                FOREIGN KEY (discussion_id, message_id)
                    REFERENCES messages (discussion_id, id) ON DELETE CASCADE,
                FOREIGN KEY (member_id) REFERENCES members (id)
            )
            """,
            """
            CREATE TABLE observability_settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
                base_url TEXT NOT NULL,
                public_key TEXT NOT NULL,
                secret_key TEXT NOT NULL,
                environment TEXT NOT NULL,
                capture_content INTEGER NOT NULL
                    CHECK (capture_content IN (0, 1)),
                FOREIGN KEY (id) REFERENCES application_state (id)
                    ON DELETE CASCADE
            )
            """,
            """
            CREATE TABLE execution_settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                backend TEXT NOT NULL CHECK (backend IN ('native', 'wsl')),
                FOREIGN KEY (id) REFERENCES application_state (id)
                    ON DELETE CASCADE
            )
            """,
            """
            CREATE TABLE execution_write_directories (
                position INTEGER PRIMARY KEY CHECK (position >= 0),
                path TEXT NOT NULL UNIQUE CHECK (length(path) > 0)
            )
            """,
        )
        for statement in statements:
            connection.execute(statement)
        SQLiteStore._create_model_settings_table(connection)
        SQLiteStore._create_agent_runs_table(connection)
        SQLiteStore._create_agent_todos_table(connection)
        SQLiteStore._create_mention_references_table(connection)
        SQLiteStore._create_human_mention_notifications_table(connection)
        SQLiteStore._create_human_read_state_tables(connection)
        SQLiteStore._create_delivery_tables(connection)
        SQLiteStore._create_authorization_tables(connection)
        SQLiteStore._create_library_documents_table(connection)

    @staticmethod
    def _create_library_documents_table(connection: sqlite3.Connection) -> None:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS library_documents (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(title) > 0),
                content TEXT NOT NULL,
                revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )

    @staticmethod
    def _create_authorization_tables(connection: sqlite3.Connection) -> None:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS organization_admin_assignments (
                agent_id INTEGER PRIMARY KEY CHECK (agent_id > 0),
                granted_at TEXT NOT NULL,
                granted_by_human_id INTEGER NOT NULL
                    CHECK (granted_by_human_id > 0)
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS organization_audit_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                occurred_at TEXT NOT NULL,
                actor_id INTEGER,
                actor_type TEXT CHECK (
                    actor_type IS NULL OR actor_type IN ('human', 'agent')
                ),
                actor_name TEXT,
                action TEXT NOT NULL CHECK (action IN (
                    'organization.agent.create',
                    'organization.agent.delete',
                    'organization.agent.pause',
                    'organization.agent.resume',
                    'organization.role.grant',
                    'organization.role.revoke',
                    'discussion.create',
                    'discussion.members.update',
                    'discussion.delete'
                )),
                target_type TEXT NOT NULL CHECK (
                    target_type IN ('organization', 'member', 'discussion')
                ),
                target_id INTEGER NOT NULL CHECK (target_id > 0),
                result TEXT NOT NULL CHECK (result IN ('success', 'failure')),
                reason_code TEXT CHECK (reason_code IS NULL OR reason_code IN (
                    'invalid_request',
                    'resource_unavailable',
                    'revision_conflict',
                    'invalid_target',
                    'invalid_state',
                    'persistence_failure'
                )),
                metadata_json TEXT NOT NULL DEFAULT '{}',
                CHECK (
                    (actor_id IS NULL AND actor_type IS NULL AND actor_name IS NULL)
                    OR (
                        actor_id > 0
                        AND actor_type IS NOT NULL
                        AND actor_name IS NOT NULL
                        AND length(actor_name) > 0
                    )
                )
            )
            """
        )
        connection.execute(
            """
            CREATE TRIGGER IF NOT EXISTS organization_audit_events_no_update
            BEFORE UPDATE ON organization_audit_events
            BEGIN
                SELECT RAISE(ABORT, 'organization audit events are append-only');
            END
            """
        )
        connection.execute(
            """
            CREATE TRIGGER IF NOT EXISTS organization_audit_events_no_delete
            BEFORE DELETE ON organization_audit_events
            BEGIN
                SELECT RAISE(ABORT, 'organization audit events are append-only');
            END
            """
        )

    @staticmethod
    def _create_delivery_tables(connection: sqlite3.Connection) -> None:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS discussion_activity_frontiers (
                member_id INTEGER NOT NULL,
                discussion_id INTEGER NOT NULL,
                latest_activity_message_id INTEGER NOT NULL DEFAULT 0
                    CHECK (latest_activity_message_id >= 0),
                PRIMARY KEY (member_id, discussion_id),
                FOREIGN KEY (discussion_id, member_id)
                    REFERENCES discussion_members (discussion_id, member_id)
                    ON DELETE CASCADE
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS message_recipients (
                discussion_id INTEGER NOT NULL,
                message_id INTEGER NOT NULL,
                member_id INTEGER NOT NULL,
                member_type_at_send TEXT NOT NULL
                    CHECK (member_type_at_send IN ('human', 'agent')),
                member_name_at_send TEXT NOT NULL,
                mentioned INTEGER NOT NULL DEFAULT 0 CHECK (mentioned IN (0, 1)),
                PRIMARY KEY (discussion_id, message_id, member_id),
                FOREIGN KEY (discussion_id, message_id)
                    REFERENCES messages (discussion_id, id) ON DELETE CASCADE,
                FOREIGN KEY (member_id) REFERENCES members (id)
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS message_read_receipts (
                discussion_id INTEGER NOT NULL,
                message_id INTEGER NOT NULL,
                member_id INTEGER NOT NULL,
                source TEXT NOT NULL CHECK (source IN (
                    'human_viewport', 'human_mark_all',
                    'agent_reminder_context', 'agent_discussion_read',
                    'legacy_human_seen'
                )),
                agent_run_id TEXT,
                PRIMARY KEY (discussion_id, message_id, member_id),
                FOREIGN KEY (discussion_id, message_id)
                    REFERENCES messages (discussion_id, id) ON DELETE CASCADE,
                FOREIGN KEY (member_id) REFERENCES members (id)
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS message_mention_acknowledgements (
                discussion_id INTEGER NOT NULL,
                message_id INTEGER NOT NULL,
                member_id INTEGER NOT NULL,
                source TEXT NOT NULL CHECK (source IN (
                    'human_explicit', 'agent_tool', 'legacy_agent_ack'
                )),
                PRIMARY KEY (discussion_id, message_id, member_id),
                FOREIGN KEY (discussion_id, message_id)
                    REFERENCES messages (discussion_id, id) ON DELETE CASCADE,
                FOREIGN KEY (member_id) REFERENCES members (id)
            )
            """
        )

    @staticmethod
    def _create_human_read_state_tables(connection: sqlite3.Connection) -> None:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS human_discussion_read_states (
                human_id INTEGER NOT NULL,
                discussion_id INTEGER NOT NULL,
                read_through_message_id INTEGER,
                PRIMARY KEY (human_id, discussion_id),
                FOREIGN KEY (discussion_id, human_id)
                    REFERENCES discussion_members (discussion_id, member_id)
                    ON DELETE CASCADE
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS human_discussion_seen_messages (
                human_id INTEGER NOT NULL,
                discussion_id INTEGER NOT NULL,
                message_id INTEGER NOT NULL,
                PRIMARY KEY (human_id, discussion_id, message_id),
                FOREIGN KEY (human_id, discussion_id)
                    REFERENCES human_discussion_read_states (human_id, discussion_id)
                    ON DELETE CASCADE,
                FOREIGN KEY (discussion_id, message_id)
                    REFERENCES messages (discussion_id, id) ON DELETE CASCADE
            )
            """
        )

    @staticmethod
    def _create_human_mention_notifications_table(
        connection: sqlite3.Connection,
    ) -> None:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS human_mention_notifications (
                human_id INTEGER NOT NULL,
                discussion_id INTEGER NOT NULL,
                message_id INTEGER NOT NULL,
                read INTEGER NOT NULL DEFAULT 0 CHECK (read IN (0, 1)),
                PRIMARY KEY (human_id, discussion_id, message_id),
                FOREIGN KEY (human_id) REFERENCES members (id),
                FOREIGN KEY (discussion_id, message_id)
                    REFERENCES messages (discussion_id, id) ON DELETE CASCADE
            )
            """
        )
        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS human_mention_notifications_unread
            ON human_mention_notifications (human_id, read, discussion_id, message_id)
            """
        )

    @staticmethod
    def _create_mention_references_table(connection: sqlite3.Connection) -> None:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS mention_references (
                discussion_id INTEGER NOT NULL,
                message_id INTEGER NOT NULL,
                position INTEGER NOT NULL,
                member_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                start INTEGER,
                end INTEGER,
                in_discussion INTEGER NOT NULL CHECK (in_discussion IN (0, 1)),
                notified INTEGER NOT NULL CHECK (notified IN (0, 1)),
                deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
                CHECK (notified = 0 OR in_discussion = 1),
                CHECK (
                    (start IS NULL AND end IS NULL)
                    OR (start IS NOT NULL AND end IS NOT NULL AND start >= 0 AND end > start)
                ),
                PRIMARY KEY (discussion_id, message_id, position),
                FOREIGN KEY (discussion_id, message_id)
                    REFERENCES messages (discussion_id, id) ON DELETE CASCADE,
                FOREIGN KEY (member_id) REFERENCES members (id)
            )
            """
        )

    @staticmethod
    def _backfill_mention_references(connection: sqlite3.Connection) -> None:
        SQLiteStore._create_mention_references_table(connection)
        connection.execute("DELETE FROM mention_references")
        member_rows = tuple(
            connection.execute(
                "SELECT id, name, deleted FROM members WHERE type = 'agent' ORDER BY id"
            )
        )
        active_agent_names = tuple(
            MentionName(row["id"], row["name"])
            for row in member_rows
            if not row["deleted"]
        )
        active_human_names = tuple(
            MentionName(row["id"], row["name"])
            for row in connection.execute(
                "SELECT id, name FROM members WHERE type = 'human' AND deleted = 0"
            )
        )
        syntax_enabled = not mention_syntax_issues(
            active_agent_names, active_human_names
        )
        member_names = {row["id"]: row["name"] for row in member_rows}
        deleted = {row["id"]: bool(row["deleted"]) for row in member_rows}
        discussion_members = {
            (row["discussion_id"], row["member_id"])
            for row in connection.execute(
                "SELECT discussion_id, member_id FROM discussion_members"
            )
        }
        notified_members = {
            (row["discussion_id"], row["message_id"], row["member_id"])
            for row in connection.execute(
                "SELECT discussion_id, message_id, member_id FROM mentions"
            )
        }
        for message in connection.execute(
            "SELECT discussion_id, id, sender_id, body FROM messages ORDER BY discussion_id, id"
        ):
            occurrences = (
                find_mentions(message["body"], active_agent_names)
                if syntax_enabled
                else ()
            )
            notified_reference_members: set[int] = set()
            for position, occurrence in enumerate(occurrences):
                notified = (
                    message["discussion_id"],
                    message["id"],
                    occurrence.member_id,
                ) in notified_members
                if notified:
                    notified_reference_members.add(occurrence.member_id)
                connection.execute(
                    """
                    INSERT INTO mention_references
                        (discussion_id, message_id, position, member_id, name, start,
                         end, in_discussion, notified, deleted)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        message["discussion_id"],
                        message["id"],
                        position,
                        occurrence.member_id,
                        member_names[occurrence.member_id],
                        occurrence.start,
                        occurrence.end,
                        int(
                            occurrence.member_id == message["sender_id"]
                            or (message["discussion_id"], occurrence.member_id)
                            in discussion_members
                            or notified
                        ),
                        int(notified),
                        int(deleted[occurrence.member_id]),
                    ),
                )
            fallback_members = sorted(
                member_id
                for discussion_id, message_id, member_id in notified_members
                if discussion_id == message["discussion_id"]
                and message_id == message["id"]
                and member_id not in notified_reference_members
            )
            for offset, member_id in enumerate(
                fallback_members, start=len(occurrences)
            ):
                connection.execute(
                    """
                    INSERT INTO mention_references
                        (discussion_id, message_id, position, member_id, name, start,
                         end, in_discussion, notified, deleted)
                    VALUES (?, ?, ?, ?, ?, NULL, NULL, 1, 1, ?)
                    """,
                    (
                        message["discussion_id"],
                        message["id"],
                        offset,
                        member_id,
                        member_names[member_id],
                        int(deleted[member_id]),
                    ),
                )

    @staticmethod
    def _create_agent_todos_table(connection: sqlite3.Connection) -> None:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS agent_todos (
                agent_id INTEGER NOT NULL,
                id INTEGER NOT NULL,
                subject TEXT NOT NULL,
                description TEXT NOT NULL,
                status TEXT NOT NULL CHECK (
                    status IN ('pending', 'in_progress', 'completed')
                ),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                completed_at TEXT,
                PRIMARY KEY (agent_id, id)
            )
            """
        )
        connection.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS agent_todos_one_in_progress
            ON agent_todos (agent_id) WHERE status = 'in_progress'
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS agent_todo_sequences (
                agent_id INTEGER PRIMARY KEY,
                next_id INTEGER NOT NULL CHECK (next_id > 0)
            )
            """
        )

    @staticmethod
    def _create_agent_runs_table(connection: sqlite3.Connection) -> None:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS agent_runs (
                agent_id INTEGER NOT NULL,
                sequence INTEGER NOT NULL,
                run_id TEXT NOT NULL UNIQUE,
                status TEXT NOT NULL CHECK (
                    status IN ('running', 'completed', 'failed', 'interrupted')
                ),
                started_at TEXT NOT NULL,
                completed_at TEXT,
                reminder_json TEXT NOT NULL,
                messages_json TEXT NOT NULL DEFAULT '[]',
                usage_json TEXT,
                error TEXT,
                PRIMARY KEY (agent_id, sequence)
            )
            """
        )

    @staticmethod
    def _create_model_settings_table(connection: sqlite3.Connection) -> None:
        connection.execute(
            """
            CREATE TABLE model_settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                api_type TEXT NOT NULL CHECK (
                    api_type IN (
                        'openai-chat', 'openai-responses', 'anthropic', 'google'
                    )
                ),
                base_url TEXT NOT NULL,
                api_key TEXT NOT NULL,
                model TEXT NOT NULL,
                context_window INTEGER CHECK (
                    context_window IS NULL OR context_window >= 2
                ),
                FOREIGN KEY (id) REFERENCES application_state (id)
                    ON DELETE CASCADE
            )
            """
        )

    def _migrate_version_one(self, connection: sqlite3.Connection) -> None:
        organization_keys = [
            row["working_directory"]
            for row in connection.execute(
                """
                SELECT working_directory FROM instances
                WHERE organization_saved = 1
                ORDER BY working_directory
                """
            )
        ]
        organizations = [
            self._load_version_one_organization(connection, key)
            for key in organization_keys
        ]
        organization = self._unique_migration_value(
            organizations,
            "Organization",
        )
        model_configs = [
            {
                "api_type": (
                    "openai-chat" if row["provider"] == "openai" else row["provider"]
                ),
                "base_url": row["base_url"],
                "api_key": row["api_key"],
                "model": row["model"],
            }
            for row in connection.execute(
                """
                SELECT provider, base_url, api_key, model FROM model_settings
                ORDER BY working_directory
                """
            )
        ]
        model_config = self._unique_migration_value(
            model_configs,
            "model settings",
        )

        with self._migration_transaction(connection):
            for table in (
                "model_settings",
                "mentions",
                "messages",
                "discussion_members",
                "discussions",
                "members",
                "instances",
            ):
                connection.execute(f"DROP TABLE {table}")
            self._create_tables(connection)
            connection.execute(
                "INSERT INTO application_state (id, organization_saved) VALUES (1, ?)",
                (int(organization is not None),),
            )
            if organization is not None:
                self._write_organization(connection, organization)
            if model_config is not None:
                self._write_model_config(connection, model_config)
            SQLiteStore._backfill_mention_references(connection)
            connection.execute(f"PRAGMA user_version = {LEGACY_SCHEMA_VERSION}")

    def _migrate_version_two(self, connection: sqlite3.Connection) -> None:
        with self._migration_transaction(connection):
            connection.execute(
                """
                CREATE TABLE observability_settings (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
                    base_url TEXT NOT NULL,
                    public_key TEXT NOT NULL,
                    secret_key TEXT NOT NULL,
                    environment TEXT NOT NULL,
                    capture_content INTEGER NOT NULL
                        CHECK (capture_content IN (0, 1)),
                    FOREIGN KEY (id) REFERENCES application_state (id)
                        ON DELETE CASCADE
                )
                """
            )
            self._migrate_model_api_type(connection)
            self._create_agent_runs_table(connection)
            self._add_member_deleted_column(connection)
            self._add_member_paused_column(connection)
            self._create_agent_todos_table(connection)
            SQLiteStore._backfill_mention_references(connection)
            connection.execute(f"PRAGMA user_version = {LEGACY_SCHEMA_VERSION}")

    def _migrate_version_three(self, connection: sqlite3.Connection) -> None:
        with self._migration_transaction(connection):
            self._migrate_model_api_type(connection)
            self._create_agent_runs_table(connection)
            self._add_member_deleted_column(connection)
            self._add_member_paused_column(connection)
            self._create_agent_todos_table(connection)
            SQLiteStore._backfill_mention_references(connection)
            connection.execute(f"PRAGMA user_version = {LEGACY_SCHEMA_VERSION}")

    def _migrate_version_four(self, connection: sqlite3.Connection) -> None:
        with self._migration_transaction(connection):
            self._create_agent_runs_table(connection)
            self._add_member_deleted_column(connection)
            self._add_member_paused_column(connection)
            self._add_model_context_window_column(connection)
            self._create_agent_todos_table(connection)
            SQLiteStore._backfill_mention_references(connection)
            connection.execute(f"PRAGMA user_version = {LEGACY_SCHEMA_VERSION}")

    @staticmethod
    def _migrate_version_five(connection: sqlite3.Connection) -> None:
        with SQLiteStore._migration_transaction(connection):
            connection.execute(
                "ALTER TABLE mentions ADD COLUMN reminded INTEGER NOT NULL DEFAULT 0 CHECK (reminded IN (0, 1))"
            )
            connection.execute(
                "ALTER TABLE agent_runs RENAME COLUMN activation_json TO reminder_json"
            )
            SQLiteStore._add_member_deleted_column(connection)
            SQLiteStore._add_member_paused_column(connection)
            SQLiteStore._add_model_context_window_column(connection)
            SQLiteStore._create_agent_todos_table(connection)
            SQLiteStore._backfill_mention_references(connection)
            connection.execute(f"PRAGMA user_version = {LEGACY_SCHEMA_VERSION}")

    @staticmethod
    def _migrate_version_six(connection: sqlite3.Connection) -> None:
        with SQLiteStore._migration_transaction(connection):
            SQLiteStore._add_member_deleted_column(connection)
            SQLiteStore._add_member_paused_column(connection)
            SQLiteStore._add_model_context_window_column(connection)
            SQLiteStore._create_agent_todos_table(connection)
            SQLiteStore._backfill_mention_references(connection)
            connection.execute(f"PRAGMA user_version = {LEGACY_SCHEMA_VERSION}")

    @staticmethod
    def _migrate_version_seven(connection: sqlite3.Connection) -> None:
        with SQLiteStore._migration_transaction(connection):
            SQLiteStore._create_agent_todos_table(connection)
            SQLiteStore._add_member_paused_column(connection)
            SQLiteStore._add_model_context_window_column(connection)
            SQLiteStore._backfill_mention_references(connection)
            connection.execute(f"PRAGMA user_version = {LEGACY_SCHEMA_VERSION}")

    @staticmethod
    def _migrate_version_eight(connection: sqlite3.Connection) -> None:
        with SQLiteStore._migration_transaction(connection):
            SQLiteStore._add_member_paused_column(connection)
            SQLiteStore._add_model_context_window_column(connection)
            SQLiteStore._backfill_mention_references(connection)
            connection.execute(f"PRAGMA user_version = {LEGACY_SCHEMA_VERSION}")

    @staticmethod
    def _migrate_version_nine(connection: sqlite3.Connection) -> None:
        with SQLiteStore._migration_transaction(connection):
            SQLiteStore._add_model_context_window_column(connection)
            SQLiteStore._backfill_mention_references(connection)
            connection.execute(f"PRAGMA user_version = {LEGACY_SCHEMA_VERSION}")

    @staticmethod
    def _migrate_version_ten(connection: sqlite3.Connection) -> None:
        with SQLiteStore._migration_transaction(connection):
            SQLiteStore._backfill_mention_references(connection)
            connection.execute(f"PRAGMA user_version = {LEGACY_SCHEMA_VERSION}")

    @staticmethod
    def _migrate_version_eleven(connection: sqlite3.Connection) -> None:
        with SQLiteStore._migration_transaction(connection):
            SQLiteStore._add_message_sender_name_column(connection)
            SQLiteStore._create_human_mention_notifications_table(connection)
            connection.execute(
                f"PRAGMA user_version = {MESSAGE_IDENTITY_SCHEMA_VERSION}"
            )

    @staticmethod
    def _migrate_version_twelve(connection: sqlite3.Connection) -> None:
        with SQLiteStore._migration_transaction(connection):
            SQLiteStore._create_human_read_state_tables(connection)
            connection.execute(
                f"PRAGMA user_version = {HUMAN_READ_STATE_SCHEMA_VERSION}"
            )

    @staticmethod
    def _migrate_version_thirteen(connection: sqlite3.Connection) -> None:
        with SQLiteStore._migration_transaction(connection):
            SQLiteStore._add_message_created_at_column(connection)
            connection.execute(
                f"PRAGMA user_version = {MESSAGE_CREATED_AT_SCHEMA_VERSION}"
            )

    @staticmethod
    def _migrate_version_fourteen(connection: sqlite3.Connection) -> None:
        with SQLiteStore._migration_transaction(connection):
            SQLiteStore._add_discussion_membership_columns(connection)
            connection.execute(
                """
                UPDATE discussion_members
                SET active = 0
                WHERE member_id IN (SELECT id FROM members WHERE deleted = 1)
                """
            )
            connection.execute(
                """
                INSERT INTO discussion_members (
                    discussion_id, position, member_id, active,
                    joined_after_message_id
                )
                SELECT
                    discussions.id,
                    COALESCE((
                        SELECT MAX(existing.position) + 1
                        FROM discussion_members AS existing
                        WHERE existing.discussion_id = discussions.id
                    ), 0) + members.id - (
                        SELECT MIN(active_humans.id)
                        FROM members AS active_humans
                        WHERE active_humans.type = 'human'
                            AND active_humans.deleted = 0
                    ),
                    members.id,
                    1,
                    COALESCE((
                        SELECT MAX(messages.id)
                        FROM messages
                        WHERE messages.discussion_id = discussions.id
                    ), 0)
                FROM discussions
                CROSS JOIN members
                WHERE members.type = 'human'
                    AND members.deleted = 0
                    AND NOT EXISTS (
                        SELECT 1 FROM discussion_members
                        WHERE discussion_members.discussion_id = discussions.id
                            AND discussion_members.member_id = members.id
                    )
                ORDER BY discussions.id, members.id
                """
            )
            connection.execute(
                """
                INSERT INTO human_discussion_read_states (
                    human_id, discussion_id, read_through_message_id
                )
                SELECT discussion_members.member_id, discussion_members.discussion_id, NULL
                FROM discussion_members
                JOIN members ON members.id = discussion_members.member_id
                WHERE discussion_members.active = 1
                    AND members.type = 'human'
                    AND members.deleted = 0
                    AND NOT EXISTS (
                        SELECT 1 FROM human_discussion_read_states
                        WHERE human_discussion_read_states.human_id =
                                discussion_members.member_id
                            AND human_discussion_read_states.discussion_id =
                                discussion_members.discussion_id
                    )
                """
            )
            connection.execute(
                f"PRAGMA user_version = {GLOBAL_HUMAN_MEMBERSHIP_SCHEMA_VERSION}"
            )

    @staticmethod
    def _migrate_version_fifteen(connection: sqlite3.Connection) -> None:
        with SQLiteStore._migration_transaction(connection):
            columns = {
                row["name"] for row in connection.execute("PRAGMA table_info(messages)")
            }
            if "recipient_snapshot_known" not in columns:
                connection.execute(
                    "ALTER TABLE messages ADD COLUMN recipient_snapshot_known INTEGER NOT NULL DEFAULT 0 CHECK (recipient_snapshot_known IN (0, 1))"
                )
            SQLiteStore._create_delivery_tables(connection)
            connection.execute("UPDATE messages SET recipient_snapshot_known = 0")
            connection.execute("DELETE FROM discussion_activity_frontiers")
            connection.execute("DELETE FROM message_recipients")
            connection.execute("DELETE FROM message_read_receipts")
            connection.execute("DELETE FROM message_mention_acknowledgements")
            connection.execute(
                """
                INSERT OR IGNORE INTO message_read_receipts
                    (discussion_id, message_id, member_id, source, agent_run_id)
                SELECT messages.discussion_id, messages.id, states.human_id,
                    'legacy_human_seen', NULL
                FROM human_discussion_read_states AS states
                JOIN discussion_members AS membership
                    ON membership.discussion_id = states.discussion_id
                    AND membership.member_id = states.human_id
                JOIN messages ON messages.discussion_id = states.discussion_id
                    AND messages.id <= states.read_through_message_id
                    AND messages.id > membership.joined_after_message_id
                    AND messages.sender_id != states.human_id
                WHERE states.read_through_message_id IS NOT NULL
                UNION
                SELECT seen.discussion_id, seen.message_id, seen.human_id,
                    'legacy_human_seen', NULL
                FROM human_discussion_seen_messages AS seen
                JOIN discussion_members AS membership
                    ON membership.discussion_id = seen.discussion_id
                    AND membership.member_id = seen.human_id
                JOIN messages ON messages.discussion_id = seen.discussion_id
                    AND messages.id = seen.message_id
                    AND messages.sender_id != seen.human_id
                WHERE seen.message_id > membership.joined_after_message_id
                UNION
                SELECT notifications.discussion_id, notifications.message_id,
                    notifications.human_id, 'legacy_human_seen', NULL
                FROM human_mention_notifications AS notifications
                JOIN discussion_members AS membership
                    ON membership.discussion_id = notifications.discussion_id
                    AND membership.member_id = notifications.human_id
                JOIN messages ON messages.discussion_id = notifications.discussion_id
                    AND messages.id = notifications.message_id
                    AND messages.sender_id != notifications.human_id
                WHERE notifications.read = 1
                    AND notifications.message_id > membership.joined_after_message_id
                """
            )
            connection.execute(
                """
                INSERT OR IGNORE INTO message_mention_acknowledgements
                    (discussion_id, message_id, member_id, source)
                SELECT discussion_id, message_id, member_id, 'legacy_agent_ack'
                FROM mentions WHERE acked = 1
                """
            )
            # Every Member already present when schema 15 is migrated receives an
            # explicit transaction-time baseline. This is deliberately independent
            # of membership cutoffs: absence of trusted seen facts means "no new
            # activity since migration", not "seen through the join cutoff".
            connection.execute(
                """
                INSERT OR REPLACE INTO discussion_activity_frontiers
                    (member_id, discussion_id, latest_activity_message_id)
                SELECT membership.member_id, membership.discussion_id,
                    COALESCE((
                        SELECT MAX(messages.id) FROM messages
                        WHERE messages.discussion_id = membership.discussion_id
                    ), 0)
                FROM discussion_members AS membership
                JOIN members ON members.id = membership.member_id
                WHERE membership.active = 1 AND members.deleted = 0
                """
            )
            # Trusted legacy Human seen facts replace that baseline with the exact
            # greatest seen position. Legacy Agent read flags are intentionally not
            # receipts and therefore never participate here.
            connection.execute(
                """
                UPDATE discussion_activity_frontiers AS frontier
                SET latest_activity_message_id = MIN(
                    frontier.latest_activity_message_id,
                    MAX(
                        CASE
                            WHEN COALESCE(states.read_through_message_id, 0) >
                                membership.joined_after_message_id
                            THEN states.read_through_message_id
                            ELSE 0
                        END,
                        COALESCE((
                            SELECT MAX(seen.message_id)
                            FROM human_discussion_seen_messages AS seen
                            WHERE seen.human_id = membership.member_id
                                AND seen.discussion_id = membership.discussion_id
                                AND seen.message_id >
                                    membership.joined_after_message_id
                        ), 0),
                        COALESCE((
                            SELECT MAX(notification.message_id)
                            FROM human_mention_notifications AS notification
                            WHERE notification.human_id = membership.member_id
                                AND notification.discussion_id = membership.discussion_id
                                AND notification.read = 1
                                AND notification.message_id >
                                    membership.joined_after_message_id
                        ), 0)
                    )
                )
                FROM discussion_members AS membership
                JOIN members ON members.id = membership.member_id
                LEFT JOIN human_discussion_read_states AS states
                    ON states.human_id = membership.member_id
                    AND states.discussion_id = membership.discussion_id
                WHERE frontier.member_id = membership.member_id
                    AND frontier.discussion_id = membership.discussion_id
                    AND members.type = 'human'
                    AND (
                        COALESCE(states.read_through_message_id, 0) >
                            membership.joined_after_message_id
                        OR EXISTS (
                            SELECT 1 FROM human_discussion_seen_messages AS seen
                            WHERE seen.human_id = membership.member_id
                                AND seen.discussion_id = membership.discussion_id
                                AND seen.message_id >
                                    membership.joined_after_message_id
                        )
                        OR EXISTS (
                            SELECT 1 FROM human_mention_notifications AS notification
                            WHERE notification.human_id = membership.member_id
                                AND notification.discussion_id = membership.discussion_id
                                AND notification.read = 1
                                AND notification.message_id >
                                    membership.joined_after_message_id
                        )
                    )
                """
            )
            connection.execute(f"PRAGMA user_version = {DELIVERY_SCHEMA_VERSION}")

    @staticmethod
    def _migrate_version_sixteen(connection: sqlite3.Connection) -> None:
        with SQLiteStore._migration_transaction(connection):
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS execution_settings (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    backend TEXT NOT NULL CHECK (backend IN ('native', 'wsl')),
                    FOREIGN KEY (id) REFERENCES application_state (id)
                        ON DELETE CASCADE
                )
                """
            )
            connection.execute(
                f"PRAGMA user_version = {EXECUTION_SETTINGS_SCHEMA_VERSION}"
            )

    @staticmethod
    def _migrate_version_seventeen(connection: sqlite3.Connection) -> None:
        with SQLiteStore._migration_transaction(connection):
            columns = {
                row["name"]
                for row in connection.execute("PRAGMA table_info(application_state)")
            }
            if "management_revision" not in columns:
                connection.execute(
                    """
                    ALTER TABLE application_state
                    ADD COLUMN management_revision INTEGER NOT NULL DEFAULT 0
                        CHECK (management_revision >= 0)
                    """
                )
            SQLiteStore._create_authorization_tables(connection)
            connection.execute(f"PRAGMA user_version = {AUTHORIZATION_SCHEMA_VERSION}")

    @staticmethod
    def _migrate_version_eighteen(connection: sqlite3.Connection) -> None:
        with SQLiteStore._migration_transaction(connection):
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS execution_write_directories (
                    position INTEGER PRIMARY KEY CHECK (position >= 0),
                    path TEXT NOT NULL UNIQUE CHECK (length(path) > 0)
                )
                """
            )
            connection.execute(f"PRAGMA user_version = {LIBRARY_SCHEMA_VERSION}")

    @staticmethod
    def _migrate_version_nineteen(connection: sqlite3.Connection) -> None:
        with SQLiteStore._migration_transaction(connection):
            SQLiteStore._create_library_documents_table(connection)
            connection.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")

    @staticmethod
    def _add_discussion_membership_columns(
        connection: sqlite3.Connection,
    ) -> None:
        columns = {
            row["name"]
            for row in connection.execute("PRAGMA table_info(discussion_members)")
        }
        if "active" not in columns:
            connection.execute(
                "ALTER TABLE discussion_members ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))"
            )
        if "joined_after_message_id" not in columns:
            connection.execute(
                "ALTER TABLE discussion_members ADD COLUMN joined_after_message_id INTEGER NOT NULL DEFAULT 0 CHECK (joined_after_message_id >= 0)"
            )

    @staticmethod
    def _add_message_created_at_column(connection: sqlite3.Connection) -> None:
        columns = {
            row["name"] for row in connection.execute("PRAGMA table_info(messages)")
        }
        if "created_at" not in columns:
            connection.execute("ALTER TABLE messages ADD COLUMN created_at TEXT")

    @staticmethod
    def _add_message_sender_name_column(connection: sqlite3.Connection) -> None:
        columns = {
            row["name"] for row in connection.execute("PRAGMA table_info(messages)")
        }
        if "sender_name" not in columns:
            connection.execute("ALTER TABLE messages ADD COLUMN sender_name TEXT")
        connection.execute(
            """
            UPDATE messages
            SET sender_name = (
                SELECT members.name FROM members WHERE members.id = messages.sender_id
            )
            WHERE sender_name IS NULL
            """
        )

    @staticmethod
    def _add_member_deleted_column(connection: sqlite3.Connection) -> None:
        columns = {
            row["name"] for row in connection.execute("PRAGMA table_info(members)")
        }
        if "deleted" not in columns:
            connection.execute(
                "ALTER TABLE members ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1))"
            )

    @staticmethod
    def _add_member_paused_column(connection: sqlite3.Connection) -> None:
        columns = {
            row["name"] for row in connection.execute("PRAGMA table_info(members)")
        }
        if "paused" not in columns:
            connection.execute(
                "ALTER TABLE members ADD COLUMN paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0, 1))"
            )

    @staticmethod
    def _add_model_context_window_column(connection: sqlite3.Connection) -> None:
        columns = {
            row["name"]
            for row in connection.execute("PRAGMA table_info(model_settings)")
        }
        if "context_window" not in columns:
            connection.execute(
                "ALTER TABLE model_settings ADD COLUMN context_window INTEGER CHECK (context_window IS NULL OR context_window >= 2)"
            )

    @staticmethod
    def _delete_orphaned_agent_todos(connection: sqlite3.Connection) -> int:
        active_agents = "SELECT id FROM members WHERE type = 'agent' AND deleted = 0"
        with connection:
            cursor = connection.execute(
                f"DELETE FROM agent_todos WHERE agent_id NOT IN ({active_agents})"
            )
            connection.execute(
                f"DELETE FROM agent_todo_sequences WHERE agent_id NOT IN ({active_agents})"
            )
        return cursor.rowcount

    @staticmethod
    def _interrupt_running_agent_runs(connection: sqlite3.Connection) -> int:
        with connection:
            cursor = connection.execute(
                """
                UPDATE agent_runs
                SET status = 'interrupted', completed_at = ?,
                    error = 'Huddol stopped before this run completed'
                WHERE status = 'running'
                """,
                (datetime.now(UTC).isoformat(),),
            )
        return cursor.rowcount

    @staticmethod
    def _migrate_model_api_type(connection: sqlite3.Connection) -> None:
        connection.execute("ALTER TABLE model_settings RENAME TO model_settings_legacy")
        SQLiteStore._create_model_settings_table(connection)
        connection.execute(
            """
            INSERT INTO model_settings (id, api_type, base_url, api_key, model)
            SELECT id,
                CASE provider WHEN 'openai' THEN 'openai-chat' ELSE provider END,
                base_url, api_key, model
            FROM model_settings_legacy
            """
        )
        connection.execute("DROP TABLE model_settings_legacy")

    @staticmethod
    def _unique_migration_value(
        values: list[dict[str, Any]],
        label: str,
    ) -> dict[str, Any] | None:
        if not values:
            return None
        first = values[0]
        if any(value != first for value in values[1:]):
            raise RuntimeError(
                f"Cannot migrate database with conflicting {label} partitions"
            )
        return first

    @staticmethod
    def _load_version_one_organization(
        connection: sqlite3.Connection,
        key: str,
    ) -> dict[str, Any]:
        members = [
            {"id": row["id"], "type": row["type"], "name": row["name"]}
            for row in connection.execute(
                """
                SELECT id, type, name FROM members
                WHERE working_directory = ? ORDER BY id
                """,
                (key,),
            )
        ]
        discussions: list[dict[str, Any]] = []
        for row in connection.execute(
            """
            SELECT id, topic FROM discussions
            WHERE working_directory = ? ORDER BY id
            """,
            (key,),
        ):
            discussion_id = row["id"]
            member_ids = [
                member["member_id"]
                for member in connection.execute(
                    """
                    SELECT member_id FROM discussion_members
                    WHERE working_directory = ? AND discussion_id = ?
                    ORDER BY position
                    """,
                    (key, discussion_id),
                )
            ]
            messages: list[dict[str, Any]] = []
            for message in connection.execute(
                """
                SELECT id, sender_id, body FROM messages
                WHERE working_directory = ? AND discussion_id = ?
                ORDER BY id
                """,
                (key, discussion_id),
            ):
                mentions = [
                    {
                        "member_id": mention["member_id"],
                        "read": bool(mention["read"]),
                        "acked": bool(mention["acked"]),
                    }
                    for mention in connection.execute(
                        """
                        SELECT member_id, read, acked FROM mentions
                        WHERE working_directory = ?
                            AND discussion_id = ? AND message_id = ?
                        ORDER BY position
                        """,
                        (key, discussion_id, message["id"]),
                    )
                ]
                messages.append(
                    {
                        "id": message["id"],
                        "sender_id": message["sender_id"],
                        "body": message["body"],
                        "mentions": mentions,
                    }
                )
            discussions.append(
                {
                    "id": discussion_id,
                    "topic": row["topic"],
                    "member_ids": member_ids,
                    "messages": messages,
                }
            )
        return {"members": members, "discussions": discussions}

    @staticmethod
    def _member_rows_by_id(
        connection: sqlite3.Connection,
    ) -> dict[int, sqlite3.Row]:
        return {
            row["id"]: row
            for row in connection.execute(
                "SELECT id, type, name, deleted FROM members ORDER BY id"
            )
        }

    @staticmethod
    def _organization_members_by_id(
        organization: Mapping[str, object],
    ) -> dict[int, Mapping[str, object]]:
        members = organization.get("members")
        if isinstance(members, (str, bytes)) or not isinstance(members, Sequence):
            raise AuthorizationDataError("Organization members are invalid")
        result: dict[int, Mapping[str, object]] = {}
        for member in members:
            if not isinstance(member, Mapping):
                raise AuthorizationDataError("Organization member is invalid")
            member_id = _positive_integer(member.get("id"), "Organization member id")
            if member_id in result:
                raise AuthorizationDataError("Organization member IDs must be unique")
            member_type = member.get("type")
            if member_type not in ("human", "agent"):
                raise AuthorizationDataError("Organization member type is invalid")
            deleted = member.get("deleted", False)
            if not isinstance(deleted, bool):
                raise AuthorizationDataError(
                    "Organization member deleted state is invalid"
                )
            result[member_id] = {
                "id": member_id,
                "type": member_type,
                "deleted": deleted,
            }
        return result

    @staticmethod
    def _validated_admin_assignments(
        assignments: Sequence[OrganizationAdminAssignment],
        members: Mapping[int, Mapping[str, object] | sqlite3.Row],
    ) -> tuple[OrganizationAdminAssignment, ...]:
        validated: list[OrganizationAdminAssignment] = []
        seen: set[int] = set()
        for assignment in assignments:
            agent_id = _positive_integer(
                assignment.agent_id, "Organization Admin assignment agent_id"
            )
            if agent_id in seen:
                raise AuthorizationDataError(
                    "Organization Admin assignments contain duplicates"
                )
            seen.add(agent_id)
            agent = members.get(agent_id)
            if agent is None or agent["type"] != "agent" or bool(agent["deleted"]):
                raise AuthorizationDataError(
                    "Organization Admin assignment target must be an active Agent"
                )
            granter_id = _positive_integer(
                assignment.granted_by_human_id,
                "Organization Admin assignment granted_by_human_id",
            )
            granter = members.get(granter_id)
            if granter is None or granter["type"] != "human":
                raise AuthorizationDataError(
                    "Organization Admin assignment granter must be a Human"
                )
            validated.append(
                OrganizationAdminAssignment(
                    agent_id=agent_id,
                    granted_at=_utc_timestamp(
                        assignment.granted_at,
                        "Organization Admin assignment granted_at",
                    ),
                    granted_by_human_id=granter_id,
                )
            )
        return tuple(sorted(validated, key=lambda item: item.agent_id))

    @classmethod
    def _load_admin_assignments(
        cls,
        connection: sqlite3.Connection,
    ) -> tuple[OrganizationAdminAssignment, ...]:
        assignments = tuple(
            OrganizationAdminAssignment(
                agent_id=row["agent_id"],
                granted_at=row["granted_at"],
                granted_by_human_id=row["granted_by_human_id"],
            )
            for row in connection.execute(
                """
                SELECT agent_id, granted_at, granted_by_human_id
                FROM organization_admin_assignments ORDER BY agent_id
                """
            )
        )
        return cls._validated_admin_assignments(
            assignments,
            cls._member_rows_by_id(connection),
        )

    @staticmethod
    def _audit_event_from_row(row: sqlite3.Row) -> PersistedOrganizationAuditEvent:
        event_id = _positive_integer(row["id"], "Organization audit event id")
        event = _validated_audit_event(
            OrganizationAuditEvent(
                occurred_at=row["occurred_at"],
                actor_id=row["actor_id"],
                actor_type=row["actor_type"],
                actor_name=row["actor_name"],
                action=row["action"],
                target_type=row["target_type"],
                target_id=row["target_id"],
                result=row["result"],
                reason_code=row["reason_code"],
                metadata=_load_audit_metadata_json(row["metadata_json"]),
            )
        )
        return PersistedOrganizationAuditEvent(event_id, event)

    @classmethod
    def _load_audit_events(
        cls,
        connection: sqlite3.Connection,
    ) -> tuple[PersistedOrganizationAuditEvent, ...]:
        return tuple(
            cls._audit_event_from_row(row)
            for row in connection.execute(
                """
                SELECT id, occurred_at, actor_id, actor_type, actor_name, action,
                    target_type, target_id, result, reason_code, metadata_json
                FROM organization_audit_events ORDER BY id
                """
            )
        )

    @classmethod
    def _validate_authorization_storage(
        cls,
        connection: sqlite3.Connection,
    ) -> None:
        row = connection.execute(
            "SELECT management_revision FROM application_state WHERE id = 1"
        ).fetchone()
        if row is None:
            raise AuthorizationDataError(
                "Persisted Organization application state is missing"
            )
        _nonnegative_integer(
            row["management_revision"], "Organization management revision"
        )
        cls._load_admin_assignments(connection)
        cls._load_audit_events(connection)

    def load_authorization_state(self) -> OrganizationAuthorizationState:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT management_revision FROM application_state WHERE id = 1"
            ).fetchone()
            if row is None:
                raise AuthorizationDataError(
                    "Persisted Organization application state is missing"
                )
            revision = _nonnegative_integer(
                row["management_revision"], "Organization management revision"
            )
            assignments = self._load_admin_assignments(connection)
        return OrganizationAuthorizationState(revision, assignments)

    def load_audit_events(self) -> tuple[PersistedOrganizationAuditEvent, ...]:
        with self._connect() as connection:
            return self._load_audit_events(connection)

    @staticmethod
    def _replace_admin_assignments(
        connection: sqlite3.Connection,
        assignments: Sequence[OrganizationAdminAssignment],
    ) -> None:
        connection.execute("DELETE FROM organization_admin_assignments")
        connection.executemany(
            """
            INSERT INTO organization_admin_assignments
                (agent_id, granted_at, granted_by_human_id)
            VALUES (?, ?, ?)
            """,
            (
                (
                    assignment.agent_id,
                    assignment.granted_at,
                    assignment.granted_by_human_id,
                )
                for assignment in assignments
            ),
        )

    @staticmethod
    def _insert_audit_event(
        connection: sqlite3.Connection,
        event: OrganizationAuditEvent,
    ) -> int:
        validated = _validated_audit_event(event)
        cursor = connection.execute(
            """
            INSERT INTO organization_audit_events (
                occurred_at, actor_id, actor_type, actor_name, action,
                target_type, target_id, result, reason_code, metadata_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                validated.occurred_at,
                validated.actor_id,
                validated.actor_type,
                validated.actor_name,
                validated.action,
                validated.target_type,
                validated.target_id,
                validated.result,
                validated.reason_code,
                _canonical_audit_metadata_json(validated.metadata or {}),
            ),
        )
        return int(cursor.lastrowid)

    def append_failure_audit(self, event: OrganizationAuditEvent) -> int:
        validated = _validated_audit_event(event)
        if validated.result != "failure":
            raise AuthorizationDataError(
                "Failure audit append requires a failure result"
            )
        self._preflight_database_permissions()
        try:
            with self._connect() as connection, connection:
                event_id = self._insert_audit_event(connection, validated)
        except sqlite3.Error as error:
            raise AuditUnavailableError(
                "Organization audit store is unavailable"
            ) from error
        return event_id

    def commit_management_mutation(
        self,
        *,
        expected_revision: int,
        organization: dict[str, Any],
        admin_assignments: Sequence[OrganizationAdminAssignment],
        audit_event: OrganizationAuditEvent,
    ) -> int:
        expected = _nonnegative_integer(
            expected_revision, "Expected Organization management revision"
        )
        members = self._organization_members_by_id(organization)
        assignments = self._validated_admin_assignments(admin_assignments, members)
        event = _validated_audit_event(audit_event)
        if event.result != "success":
            raise AuthorizationDataError(
                "Management mutation requires a success audit event"
            )
        self._preflight_database_permissions()
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                cursor = connection.execute(
                    """
                    UPDATE application_state
                    SET management_revision = management_revision + 1
                    WHERE id = 1 AND management_revision = ?
                    """,
                    (expected,),
                )
                if cursor.rowcount != 1:
                    raise ManagementRevisionConflict(
                        "Organization management revision is stale"
                    )
                connection.execute(
                    "UPDATE application_state SET organization_saved = 1 WHERE id = 1"
                )
                connection.execute("DELETE FROM discussions")
                connection.execute("DELETE FROM members")
                self._write_organization(connection, organization)
                self._replace_admin_assignments(connection, assignments)
                try:
                    self._insert_audit_event(connection, event)
                except sqlite3.Error as error:
                    raise AuditUnavailableError(
                        "Organization audit store is unavailable"
                    ) from error
            except BaseException:
                connection.rollback()
                raise
            else:
                connection.commit()
        return expected + 1

    def load_organization(self) -> dict[str, Any] | None:
        started = time.monotonic()
        with self._connect() as connection:
            row = connection.execute(
                "SELECT organization_saved FROM application_state WHERE id = 1"
            ).fetchone()
            if row is None or not row["organization_saved"]:
                log_event(
                    "database.organization.loaded",
                    saved=False,
                    duration_ms=round((time.monotonic() - started) * 1000),
                )
                return None
            members = [
                {
                    "id": row["id"],
                    "type": row["type"],
                    "name": row["name"],
                    "deleted": bool(row["deleted"]),
                    "paused": bool(row["paused"]),
                }
                for row in connection.execute(
                    "SELECT id, type, name, deleted, paused FROM members ORDER BY id"
                )
            ]
            discussions: list[dict[str, Any]] = []
            for row in connection.execute(
                "SELECT id, topic FROM discussions ORDER BY id"
            ):
                discussion_id = row["id"]
                memberships = [
                    {
                        "member_id": membership["member_id"],
                        "active": bool(membership["active"]),
                        "joined_after_message_id": membership[
                            "joined_after_message_id"
                        ],
                    }
                    for membership in connection.execute(
                        """
                        SELECT member_id, active, joined_after_message_id
                        FROM discussion_members
                        WHERE discussion_id = ? ORDER BY position
                        """,
                        (discussion_id,),
                    )
                ]
                messages: list[dict[str, Any]] = []
                for message in connection.execute(
                    """
                    SELECT id, sender_id, sender_name, body, created_at, recipient_snapshot_known FROM messages
                    WHERE discussion_id = ? ORDER BY id
                    """,
                    (discussion_id,),
                ):
                    references = [
                        {
                            "member_id": reference["member_id"],
                            "name": reference["name"],
                            "start": reference["start"],
                            "end": reference["end"],
                            "in_discussion": bool(reference["in_discussion"]),
                            "notified": bool(reference["notified"]),
                            "deleted": bool(reference["deleted"]),
                        }
                        for reference in connection.execute(
                            """
                            SELECT member_id, name, start, end, in_discussion, notified,
                                deleted
                            FROM mention_references
                            WHERE discussion_id = ? AND message_id = ?
                            ORDER BY position
                            """,
                            (discussion_id, message["id"]),
                        )
                    ]
                    mentions = [
                        {
                            "member_id": mention["member_id"],
                            "read": bool(mention["read"]),
                            "acked": bool(mention["acked"]),
                            "reminded": bool(mention["reminded"]),
                        }
                        for mention in connection.execute(
                            """
                            SELECT member_id, read, acked, reminded FROM mentions
                            WHERE discussion_id = ? AND message_id = ?
                            ORDER BY position
                            """,
                            (discussion_id, message["id"]),
                        )
                    ]
                    human_mentions = [
                        {
                            "member_id": notification["human_id"],
                            "read": bool(notification["read"]),
                        }
                        for notification in connection.execute(
                            """
                            SELECT human_id, read FROM human_mention_notifications
                            WHERE discussion_id = ? AND message_id = ?
                            ORDER BY human_id
                            """,
                            (discussion_id, message["id"]),
                        )
                    ]
                    recipients = [
                        {
                            "member_id": recipient["member_id"],
                            "member_type_at_send": recipient["member_type_at_send"],
                            "member_name_at_send": recipient["member_name_at_send"],
                            "mentioned": bool(recipient["mentioned"]),
                        }
                        for recipient in connection.execute(
                            """
                            SELECT member_id, member_type_at_send, member_name_at_send, mentioned
                            FROM message_recipients
                            WHERE discussion_id = ? AND message_id = ? ORDER BY member_id
                            """,
                            (discussion_id, message["id"]),
                        )
                    ]
                    read_receipts = [
                        {
                            "member_id": receipt["member_id"],
                            "source": receipt["source"],
                            "agent_run_id": receipt["agent_run_id"],
                        }
                        for receipt in connection.execute(
                            """
                            SELECT member_id, source, agent_run_id
                            FROM message_read_receipts
                            WHERE discussion_id = ? AND message_id = ? ORDER BY member_id
                            """,
                            (discussion_id, message["id"]),
                        )
                    ]
                    acknowledgements = [
                        {"member_id": item["member_id"], "source": item["source"]}
                        for item in connection.execute(
                            """
                            SELECT member_id, source
                            FROM message_mention_acknowledgements
                            WHERE discussion_id = ? AND message_id = ? ORDER BY member_id
                            """,
                            (discussion_id, message["id"]),
                        )
                    ]
                    messages.append(
                        {
                            "id": message["id"],
                            "sender_id": message["sender_id"],
                            "sender_name": message["sender_name"],
                            "body": message["body"],
                            "created_at": message["created_at"],
                            "references": references,
                            "mentions": mentions,
                            "human_mentions": human_mentions,
                            "recipient_snapshot_known": bool(
                                message["recipient_snapshot_known"]
                            ),
                            "recipients": recipients,
                            "read_receipts": read_receipts,
                            "mention_acknowledgements": acknowledgements,
                        }
                    )
                human_read_states = [
                    {
                        "member_id": state["human_id"],
                        "read_through_message_id": state["read_through_message_id"],
                        "seen_message_ids": [
                            seen["message_id"]
                            for seen in connection.execute(
                                """
                                SELECT message_id FROM human_discussion_seen_messages
                                WHERE human_id = ? AND discussion_id = ?
                                ORDER BY message_id
                                """,
                                (state["human_id"], discussion_id),
                            )
                        ],
                    }
                    for state in connection.execute(
                        """
                        SELECT human_id, read_through_message_id
                        FROM human_discussion_read_states
                        WHERE discussion_id = ? ORDER BY human_id
                        """,
                        (discussion_id,),
                    )
                ]
                activity_frontiers = [
                    {
                        "member_id": frontier["member_id"],
                        "latest_activity_message_id": frontier[
                            "latest_activity_message_id"
                        ],
                    }
                    for frontier in connection.execute(
                        """
                        SELECT member_id, latest_activity_message_id
                        FROM discussion_activity_frontiers
                        WHERE discussion_id = ? ORDER BY member_id
                        """,
                        (discussion_id,),
                    )
                ]
                discussions.append(
                    {
                        "id": discussion_id,
                        "topic": row["topic"],
                        "memberships": memberships,
                        "messages": messages,
                        "human_read_states": human_read_states,
                        "activity_frontiers": activity_frontiers,
                    }
                )
            organization = {"members": members, "discussions": discussions}
        log_event(
            "database.organization.loaded",
            saved=True,
            duration_ms=round((time.monotonic() - started) * 1000),
            **organization_metrics(organization),
        )
        return organization

    def save_organization(self, organization: dict[str, Any]) -> None:
        started = time.monotonic()
        self._preflight_database_permissions()
        with self._connect() as connection, connection:
            connection.execute(
                "UPDATE application_state SET organization_saved = 1 WHERE id = 1"
            )
            connection.execute("DELETE FROM discussions")
            connection.execute("DELETE FROM members")
            self._write_organization(connection, organization)
        log_event(
            "database.organization.saved",
            duration_ms=round((time.monotonic() - started) * 1000),
            **organization_metrics(organization),
        )

    @staticmethod
    def _write_organization(
        connection: sqlite3.Connection,
        organization: dict[str, Any],
    ) -> None:
        for member in organization["members"]:
            connection.execute(
                "INSERT INTO members (id, type, name, deleted, paused) VALUES (?, ?, ?, ?, ?)",
                (
                    member["id"],
                    member["type"],
                    member["name"],
                    int(member.get("deleted", False)),
                    int(member.get("paused", False)),
                ),
            )
        member_names = {
            member["id"]: member["name"] for member in organization["members"]
        }
        for discussion in organization["discussions"]:
            discussion_id = discussion["id"]
            connection.execute(
                "INSERT INTO discussions (id, topic) VALUES (?, ?)",
                (discussion_id, discussion["topic"]),
            )
            memberships = discussion.get("memberships")
            if memberships is None:
                memberships = [
                    {
                        "member_id": member_id,
                        "active": True,
                        "joined_after_message_id": 0,
                    }
                    for member_id in discussion["member_ids"]
                ]
            for position, membership in enumerate(memberships):
                connection.execute(
                    """
                    INSERT INTO discussion_members
                        (discussion_id, position, member_id, active,
                         joined_after_message_id)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (
                        discussion_id,
                        position,
                        membership["member_id"],
                        int(membership.get("active", True)),
                        membership.get("joined_after_message_id", 0),
                    ),
                )
            for message in discussion["messages"]:
                connection.execute(
                    """
                    INSERT INTO messages
                        (discussion_id, id, sender_id, sender_name, body, created_at,
                         recipient_snapshot_known)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        discussion_id,
                        message["id"],
                        message["sender_id"],
                        message.get("sender_name", member_names[message["sender_id"]]),
                        message["body"],
                        message.get("created_at"),
                        int(message.get("recipient_snapshot_known", False)),
                    ),
                )
                for position, reference in enumerate(message.get("references", [])):
                    connection.execute(
                        """
                        INSERT INTO mention_references
                            (discussion_id, message_id, position, member_id, name, start,
                             end, in_discussion, notified, deleted)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            discussion_id,
                            message["id"],
                            position,
                            reference["member_id"],
                            reference["name"],
                            reference["start"],
                            reference["end"],
                            int(reference["in_discussion"]),
                            int(
                                reference["notified"]
                                and reference["member_id"] != message["sender_id"]
                            ),
                            int(reference.get("deleted", False)),
                        ),
                    )
                for position, mention in enumerate(
                    item
                    for item in message["mentions"]
                    if item["member_id"] != message["sender_id"]
                ):
                    connection.execute(
                        """
                        INSERT INTO mentions
                            (discussion_id, message_id, position, member_id, read, acked, reminded)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            discussion_id,
                            message["id"],
                            position,
                            mention["member_id"],
                            int(mention["read"]),
                            int(mention["acked"]),
                            int(mention.get("reminded", False)),
                        ),
                    )
                for notification in (
                    item
                    for item in message.get("human_mentions", [])
                    if item["member_id"] != message["sender_id"]
                ):
                    connection.execute(
                        """
                        INSERT INTO human_mention_notifications
                            (human_id, discussion_id, message_id, read)
                        VALUES (?, ?, ?, ?)
                        """,
                        (
                            notification["member_id"],
                            discussion_id,
                            message["id"],
                            int(notification.get("read", False)),
                        ),
                    )
                for recipient in message.get("recipients", []):
                    connection.execute(
                        """
                        INSERT INTO message_recipients
                            (discussion_id, message_id, member_id,
                             member_type_at_send, member_name_at_send, mentioned)
                        VALUES (?, ?, ?, ?, ?, ?)
                        """,
                        (
                            discussion_id,
                            message["id"],
                            recipient["member_id"],
                            recipient["member_type_at_send"],
                            recipient["member_name_at_send"],
                            int(recipient.get("mentioned", False)),
                        ),
                    )
                for receipt in message.get("read_receipts", []):
                    connection.execute(
                        """
                        INSERT INTO message_read_receipts
                            (discussion_id, message_id, member_id, source, agent_run_id)
                        VALUES (?, ?, ?, ?, ?)
                        """,
                        (
                            discussion_id,
                            message["id"],
                            receipt["member_id"],
                            receipt["source"],
                            receipt.get("agent_run_id"),
                        ),
                    )
                for acknowledgement in message.get("mention_acknowledgements", []):
                    connection.execute(
                        """
                        INSERT INTO message_mention_acknowledgements
                            (discussion_id, message_id, member_id, source)
                        VALUES (?, ?, ?, ?)
                        """,
                        (
                            discussion_id,
                            message["id"],
                            acknowledgement["member_id"],
                            acknowledgement["source"],
                        ),
                    )
            for frontier in discussion.get("activity_frontiers", []):
                connection.execute(
                    """
                    INSERT INTO discussion_activity_frontiers
                        (member_id, discussion_id, latest_activity_message_id)
                    VALUES (?, ?, ?)
                    """,
                    (
                        frontier["member_id"],
                        discussion_id,
                        frontier["latest_activity_message_id"],
                    ),
                )
            for state in discussion.get("human_read_states", []):
                connection.execute(
                    """
                    INSERT INTO human_discussion_read_states
                        (human_id, discussion_id, read_through_message_id)
                    VALUES (?, ?, ?)
                    """,
                    (
                        state["member_id"],
                        discussion_id,
                        state.get("read_through_message_id"),
                    ),
                )
                for message_id in state.get("seen_message_ids", []):
                    connection.execute(
                        """
                        INSERT INTO human_discussion_seen_messages
                            (human_id, discussion_id, message_id)
                        VALUES (?, ?, ?)
                        """,
                        (state["member_id"], discussion_id, message_id),
                    )

    def load_execution_settings(self) -> tuple[str, tuple[str, ...]]:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT backend FROM execution_settings WHERE id = 1"
            ).fetchone()
            write_directories = tuple(
                item["path"]
                for item in connection.execute(
                    """
                    SELECT path FROM execution_write_directories
                    ORDER BY position
                    """
                )
            )
        backend = row["backend"] if row is not None else "native"
        log_event(
            "database.execution_config.loaded",
            backend=backend,
            write_directory_count=len(write_directories),
        )
        return backend, write_directories

    def load_execution_backend(self) -> str:
        return self.load_execution_settings()[0]

    def save_execution_settings(
        self,
        backend: str,
        write_directories: tuple[str, ...],
    ) -> None:
        if backend not in ("native", "wsl"):
            raise ValueError("backend must be native or wsl")
        if any(not isinstance(path, str) or not path for path in write_directories):
            raise ValueError("write_directories must contain non-empty strings")
        if len(write_directories) != len(set(write_directories)):
            raise ValueError("write_directories must not contain duplicates")
        with self._connect() as connection, connection:
            connection.execute(
                """
                INSERT INTO execution_settings (id, backend) VALUES (1, ?)
                ON CONFLICT (id) DO UPDATE SET backend = excluded.backend
                """,
                (backend,),
            )
            connection.execute("DELETE FROM execution_write_directories")
            connection.executemany(
                """
                INSERT INTO execution_write_directories (position, path)
                VALUES (?, ?)
                """,
                enumerate(write_directories),
            )
        self.path.chmod(0o600)
        log_event(
            "database.execution_config.saved",
            backend=backend,
            write_directory_count=len(write_directories),
        )

    def save_execution_backend(self, backend: str) -> None:
        self.save_execution_settings(
            backend,
            self.load_execution_settings()[1],
        )

    def load_model_config(self) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT api_type, base_url, api_key, model, context_window
                FROM model_settings WHERE id = 1
                """
            ).fetchone()
            if row is None:
                log_event("database.model_config.loaded", configured=False)
                return None
            config = {
                "api_type": row["api_type"],
                "base_url": row["base_url"],
                "api_key": row["api_key"],
                "model": row["model"],
                "context_window": row["context_window"],
            }
        log_event(
            "database.model_config.loaded",
            configured=True,
            api_type=config["api_type"],
            model=config["model"],
        )
        return config

    def save_model_config(self, config: dict[str, Any]) -> None:
        with self._connect() as connection, connection:
            self._write_model_config(connection, config)
        self.path.chmod(0o600)
        log_event(
            "database.model_config.saved",
            api_type=config["api_type"],
            model=config["model"],
        )

    def begin_agent_run(
        self,
        agent_id: int,
        run_id: str,
        started_at: str,
        reminder: dict[str, Any],
    ) -> int:
        with self._connect() as connection, connection:
            row = connection.execute(
                "SELECT COALESCE(MAX(sequence), 0) + 1 FROM agent_runs WHERE agent_id = ?",
                (agent_id,),
            ).fetchone()
            sequence = int(row[0])
            connection.execute(
                """
                INSERT INTO agent_runs
                    (agent_id, sequence, run_id, status, started_at, reminder_json)
                VALUES (?, ?, ?, 'running', ?, ?)
                """,
                (
                    agent_id,
                    sequence,
                    run_id,
                    started_at,
                    json.dumps(reminder, separators=(",", ":")),
                ),
            )
        self.path.chmod(0o600)
        return sequence

    def complete_agent_run(
        self,
        agent_id: int,
        run_id: str,
        status: RunStatus,
        completed_at: str,
        messages_json: str,
        usage: dict[str, Any] | None,
        error: str | None,
    ) -> None:
        if status == "running":
            raise ValueError("A completed Agent run cannot remain running")
        with self._connect() as connection, connection:
            cursor = connection.execute(
                """
                UPDATE agent_runs
                SET status = ?, completed_at = ?, messages_json = ?,
                    usage_json = ?, error = ?
                WHERE agent_id = ? AND run_id = ? AND status = 'running'
                """,
                (
                    status,
                    completed_at,
                    messages_json,
                    json.dumps(usage, separators=(",", ":"))
                    if usage is not None
                    else None,
                    error,
                    agent_id,
                    run_id,
                ),
            )
            if cursor.rowcount != 1:
                raise RuntimeError("Agent run is not active")
        self.path.chmod(0o600)

    def delete_agent_runs(self, agent_id: int) -> None:
        with self._connect() as connection, connection:
            connection.execute("DELETE FROM agent_runs WHERE agent_id = ?", (agent_id,))
        self.path.chmod(0o600)

    def load_agent_run_page(
        self, agent_id: int, before_sequence: int | None, limit: int
    ) -> list[dict[str, Any]]:
        if limit < 1:
            raise ValueError("limit must be positive")
        where = "agent_id = ?"
        arguments: list[Any] = [agent_id]
        if before_sequence is not None:
            where += " AND sequence < ?"
            arguments.append(before_sequence)
        arguments.append(limit)
        with self._connect() as connection:
            rows = connection.execute(
                f"""
                SELECT agent_id, sequence, run_id, status, started_at, completed_at,
                    usage_json, error,
                    1 + COALESCE((
                        SELECT SUM(json_array_length(
                            json_extract(value, char(36) || '.parts')
                        ))
                        FROM json_each(agent_runs.messages_json)
                    ), 0) + CASE WHEN error IS NULL THEN 0 ELSE 1 END AS entry_count
                FROM agent_runs WHERE {where}
                ORDER BY sequence DESC LIMIT ?
                """,
                arguments,
            )
            return [
                {
                    "agent_id": row["agent_id"],
                    "sequence": row["sequence"],
                    "run_id": row["run_id"],
                    "status": row["status"],
                    "started_at": row["started_at"],
                    "completed_at": row["completed_at"],
                    "usage": json.loads(row["usage_json"])
                    if row["usage_json"] is not None
                    else None,
                    "error": row["error"],
                    "entry_count": row["entry_count"],
                }
                for row in rows
            ]

    def load_agent_run(self, agent_id: int, run_id: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT agent_id, sequence, run_id, status, started_at, completed_at,
                    reminder_json, messages_json, usage_json, error
                FROM agent_runs WHERE agent_id = ? AND run_id = ?
                """,
                (agent_id, run_id),
            ).fetchone()
        if row is None:
            return None
        return {
            "agent_id": row["agent_id"],
            "sequence": row["sequence"],
            "run_id": row["run_id"],
            "status": row["status"],
            "started_at": row["started_at"],
            "completed_at": row["completed_at"],
            "reminder": json.loads(row["reminder_json"]),
            "messages_json": row["messages_json"],
            "usage": json.loads(row["usage_json"])
            if row["usage_json"] is not None
            else None,
            "error": row["error"],
        }

    def load_agent_runs(self, agent_id: int) -> list[dict[str, Any]]:
        with self._connect() as connection:
            return [
                {
                    "agent_id": row["agent_id"],
                    "sequence": row["sequence"],
                    "run_id": row["run_id"],
                    "status": row["status"],
                    "started_at": row["started_at"],
                    "completed_at": row["completed_at"],
                    "reminder": json.loads(row["reminder_json"]),
                    "messages_json": row["messages_json"],
                    "usage": json.loads(row["usage_json"])
                    if row["usage_json"] is not None
                    else None,
                    "error": row["error"],
                }
                for row in connection.execute(
                    """
                    SELECT agent_id, sequence, run_id, status, started_at,
                        completed_at, reminder_json, messages_json, usage_json, error
                    FROM agent_runs WHERE agent_id = ? ORDER BY sequence
                    """,
                    (agent_id,),
                )
            ]

    def create_todo(
        self,
        agent_id: int,
        subject: str,
        description: str,
        created_at: str,
    ) -> dict[str, Any]:
        with self._connect() as connection, connection:
            row = connection.execute(
                "SELECT next_id FROM agent_todo_sequences WHERE agent_id = ?",
                (agent_id,),
            ).fetchone()
            if row is None:
                todo_id = 1
                connection.execute(
                    "INSERT INTO agent_todo_sequences (agent_id, next_id) VALUES (?, 2)",
                    (agent_id,),
                )
            else:
                todo_id = int(row["next_id"])
                connection.execute(
                    "UPDATE agent_todo_sequences SET next_id = ? WHERE agent_id = ?",
                    (todo_id + 1, agent_id),
                )
            connection.execute(
                """
                INSERT INTO agent_todos (
                    agent_id, id, subject, description, status,
                    created_at, updated_at, completed_at
                ) VALUES (?, ?, ?, ?, 'pending', ?, ?, NULL)
                """,
                (
                    agent_id,
                    todo_id,
                    subject,
                    description,
                    created_at,
                    created_at,
                ),
            )
        self.path.chmod(0o600)
        return {
            "id": todo_id,
            "subject": subject,
            "description": description,
            "status": "pending",
            "created_at": created_at,
            "updated_at": created_at,
            "completed_at": None,
        }

    def load_todos(
        self,
        agent_id: int,
        status: TodoStatus | None = None,
    ) -> list[dict[str, Any]]:
        query = """
            SELECT id, subject, description, status, created_at, updated_at,
                completed_at
            FROM agent_todos WHERE agent_id = ?
        """
        parameters: tuple[Any, ...] = (agent_id,)
        if status is not None:
            query += " AND status = ?"
            parameters = (agent_id, status)
        query += " ORDER BY id"
        with self._connect() as connection:
            return [
                self._todo_data(row) for row in connection.execute(query, parameters)
            ]

    def load_todos_page(
        self,
        agent_id: int,
        status: TodoStatus,
        limit: int,
        cursor: int | None,
    ) -> list[dict[str, Any]]:
        comparison = "<" if status == "completed" else ">"
        order = "DESC" if status == "completed" else "ASC"
        query = """
            SELECT id, subject, description, status, created_at, updated_at,
                completed_at
            FROM agent_todos WHERE agent_id = ? AND status = ?
        """
        parameters: list[Any] = [agent_id, status]
        if cursor is not None:
            query += f" AND id {comparison} ?"
            parameters.append(cursor)
        query += f" ORDER BY id {order} LIMIT ?"
        parameters.append(limit)
        with self._connect() as connection:
            return [
                self._todo_data(row)
                for row in connection.execute(query, tuple(parameters))
            ]

    def load_todo(self, agent_id: int, todo_id: int) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT id, subject, description, status, created_at, updated_at,
                    completed_at
                FROM agent_todos WHERE agent_id = ? AND id = ?
                """,
                (agent_id, todo_id),
            ).fetchone()
        return None if row is None else self._todo_data(row)

    def update_todo(
        self,
        agent_id: int,
        todo_id: int,
        subject: str,
        description: str,
        updated_at: str,
    ) -> None:
        with self._connect() as connection, connection:
            cursor = connection.execute(
                """
                UPDATE agent_todos
                SET subject = ?, description = ?, updated_at = ?
                WHERE agent_id = ? AND id = ?
                """,
                (subject, description, updated_at, agent_id, todo_id),
            )
            if cursor.rowcount != 1:
                raise RuntimeError("Todo does not exist")
        self.path.chmod(0o600)

    def set_todo_status(
        self,
        agent_id: int,
        todo_id: int,
        status: TodoStatus,
        updated_at: str,
        completed_at: str | None,
    ) -> None:
        with self._connect() as connection, connection:
            cursor = connection.execute(
                """
                UPDATE agent_todos
                SET status = ?, updated_at = ?, completed_at = ?
                WHERE agent_id = ? AND id = ?
                """,
                (status, updated_at, completed_at, agent_id, todo_id),
            )
            if cursor.rowcount != 1:
                raise RuntimeError("Todo does not exist")
        self.path.chmod(0o600)

    def delete_todo(self, agent_id: int, todo_id: int) -> None:
        with self._connect() as connection, connection:
            cursor = connection.execute(
                "DELETE FROM agent_todos WHERE agent_id = ? AND id = ?",
                (agent_id, todo_id),
            )
            if cursor.rowcount != 1:
                raise RuntimeError("Todo does not exist")
        self.path.chmod(0o600)

    def delete_agent_todos(self, agent_id: int) -> None:
        with self._connect() as connection, connection:
            connection.execute(
                "DELETE FROM agent_todos WHERE agent_id = ?",
                (agent_id,),
            )
            connection.execute(
                "DELETE FROM agent_todo_sequences WHERE agent_id = ?",
                (agent_id,),
            )
        self.path.chmod(0o600)

    @staticmethod
    def _todo_data(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "subject": row["subject"],
            "description": row["description"],
            "status": row["status"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "completed_at": row["completed_at"],
        }

    def list_library_documents(self) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT id, title, revision, created_at, updated_at
                FROM library_documents ORDER BY title COLLATE NOCASE, id
                """
            )
            return [self._library_document_data(row) for row in rows]

    def load_library_document(self, document_id: int) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT id, title, content, revision, created_at, updated_at
                FROM library_documents WHERE id = ?
                """,
                (document_id,),
            ).fetchone()
        return (
            None
            if row is None
            else self._library_document_data(row, include_content=True)
        )

    def create_library_document(
        self,
        title: str,
        content: str,
        created_at: str,
    ) -> dict[str, Any]:
        with self._connect() as connection, connection:
            cursor = connection.execute(
                """
                INSERT INTO library_documents
                    (title, content, revision, created_at, updated_at)
                VALUES (?, ?, 1, ?, ?)
                """,
                (title, content, created_at, created_at),
            )
            document_id = int(cursor.lastrowid)
        self.path.chmod(0o600)
        document = self.load_library_document(document_id)
        if document is None:
            raise RuntimeError("Library document was not saved")
        return document

    def update_library_document(
        self,
        document_id: int,
        title: str,
        content: str,
        updated_at: str,
    ) -> dict[str, Any]:
        with self._connect() as connection, connection:
            cursor = connection.execute(
                """
                UPDATE library_documents
                SET title = ?, content = ?, revision = revision + 1, updated_at = ?
                WHERE id = ?
                """,
                (title, content, updated_at, document_id),
            )
            if cursor.rowcount != 1:
                raise RuntimeError("Library document does not exist")
        self.path.chmod(0o600)
        document = self.load_library_document(document_id)
        if document is None:
            raise RuntimeError("Library document was not saved")
        return document

    def delete_library_document(self, document_id: int) -> bool:
        with self._connect() as connection, connection:
            cursor = connection.execute(
                "DELETE FROM library_documents WHERE id = ?", (document_id,)
            )
        self.path.chmod(0o600)
        return cursor.rowcount == 1

    @staticmethod
    def _library_document_data(
        row: sqlite3.Row, *, include_content: bool = False
    ) -> dict[str, Any]:
        document = {
            "id": row["id"],
            "title": row["title"],
            "revision": row["revision"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }
        if include_content:
            document["content"] = row["content"]
        return document

    def load_observability_config(self) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT enabled, base_url, public_key, secret_key, environment,
                    capture_content
                FROM observability_settings WHERE id = 1
                """
            ).fetchone()
            if row is None:
                log_event("database.observability_config.loaded", configured=False)
                return None
            config = {
                "enabled": bool(row["enabled"]),
                "base_url": row["base_url"],
                "public_key": row["public_key"],
                "secret_key": row["secret_key"],
                "environment": row["environment"],
                "capture_content": bool(row["capture_content"]),
            }
        log_event(
            "database.observability_config.loaded",
            configured=True,
            enabled=config["enabled"],
            environment=config["environment"],
            capture_content=config["capture_content"],
        )
        return config

    def save_observability_config(self, config: dict[str, Any]) -> None:
        with self._connect() as connection, connection:
            connection.execute(
                """
                INSERT INTO observability_settings
                    (id, enabled, base_url, public_key, secret_key, environment,
                        capture_content)
                VALUES (1, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (id) DO UPDATE SET
                    enabled = excluded.enabled,
                    base_url = excluded.base_url,
                    public_key = excluded.public_key,
                    secret_key = excluded.secret_key,
                    environment = excluded.environment,
                    capture_content = excluded.capture_content
                """,
                (
                    int(config["enabled"]),
                    config["base_url"],
                    config["public_key"],
                    config["secret_key"],
                    config["environment"],
                    int(config["capture_content"]),
                ),
            )
        self.path.chmod(0o600)
        log_event(
            "database.observability_config.saved",
            enabled=config["enabled"],
            environment=config["environment"],
            capture_content=config["capture_content"],
        )

    @staticmethod
    def _write_model_config(
        connection: sqlite3.Connection,
        config: dict[str, Any],
    ) -> None:
        connection.execute(
            """
            INSERT INTO model_settings
                (id, api_type, base_url, api_key, model, context_window)
            VALUES (1, ?, ?, ?, ?, ?)
            ON CONFLICT (id) DO UPDATE SET
                api_type = excluded.api_type,
                base_url = excluded.base_url,
                api_key = excluded.api_key,
                model = excluded.model,
                context_window = excluded.context_window
            """,
            (
                config["api_type"],
                config["base_url"],
                config["api_key"],
                config["model"],
                config.get("context_window"),
            ),
        )
