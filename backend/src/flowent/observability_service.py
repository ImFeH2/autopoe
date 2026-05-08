from __future__ import annotations

import copy
import json
import threading
import time
import uuid
from dataclasses import dataclass
from typing import Any, Literal

from flowent.models import LLMUsage
from flowent.state_db import open_state_db

OBSERVABILITY_RETENTION_SECONDS = 30 * 24 * 60 * 60


def serialize_usage(usage: LLMUsage | None) -> dict[str, Any] | None:
    if usage is None:
        return None
    return {
        "total_tokens": usage.total_tokens,
        "input_tokens": usage.input_tokens,
        "output_tokens": usage.output_tokens,
        "cached_input_tokens": usage.cached_input_tokens,
        "cache_read_tokens": usage.cache_read_tokens,
        "cache_write_tokens": usage.cache_write_tokens,
        "details": dict(usage.details),
    }


@dataclass(frozen=True)
class RequestRecordInput:
    node_id: str
    node_label: str
    role_name: str | None
    tab_id: str | None
    tab_title: str | None
    provider_id: str | None
    provider_name: str | None
    provider_type: str | None
    model: str | None
    started_at: float
    ended_at: float
    retry_count: int
    result: Literal["success", "error"]
    normalized_usage: LLMUsage | None = None
    raw_usage: dict[str, Any] | None = None
    error_summary: str | None = None


@dataclass(frozen=True)
class CompactRecordInput:
    node_id: str
    node_label: str
    role_name: str | None
    tab_id: str | None
    tab_title: str | None
    provider_id: str | None
    provider_name: str | None
    provider_type: str | None
    model: str | None
    trigger_type: Literal["manual", "auto"]
    started_at: float
    ended_at: float
    result: Literal["success", "error"]
    error_summary: str | None = None


class ObservabilityStore:
    def __init__(self) -> None:
        self._lock = threading.Lock()

    def reset(self) -> None:
        connection = open_state_db(create=False)
        if connection is None:
            return
        try:
            with connection:
                connection.execute("DELETE FROM llm_request_records")
                connection.execute("DELETE FROM compact_records")
        finally:
            connection.close()

    def _prune_locked(self, connection, now: float) -> None:
        min_timestamp = now - OBSERVABILITY_RETENTION_SECONDS
        connection.execute(
            "DELETE FROM llm_request_records WHERE ended_at < ?",
            (min_timestamp,),
        )
        connection.execute(
            "DELETE FROM compact_records WHERE ended_at < ?",
            (min_timestamp,),
        )

    def record_request(self, record: RequestRecordInput) -> None:
        payload = {
            "id": str(uuid.uuid4()),
            "node_id": record.node_id,
            "node_label": record.node_label,
            "role_name": record.role_name,
            "tab_id": record.tab_id,
            "tab_title": record.tab_title,
            "provider_id": record.provider_id,
            "provider_name": record.provider_name,
            "provider_type": record.provider_type,
            "model": record.model,
            "started_at": record.started_at,
            "ended_at": record.ended_at,
            "duration_ms": max(0.0, (record.ended_at - record.started_at) * 1000),
            "retry_count": max(record.retry_count, 0),
            "result": record.result,
            "error_summary": record.error_summary,
            "normalized_usage": serialize_usage(record.normalized_usage),
            "raw_usage": copy.deepcopy(record.raw_usage),
        }
        with self._lock:
            connection = open_state_db(create=True)
            assert connection is not None
            try:
                with connection:
                    self._prune_locked(connection, time.time())
                    connection.execute(
                        """
                        INSERT INTO llm_request_records (id, ended_at, payload)
                        VALUES (?, ?, ?)
                        """,
                        (
                            payload["id"],
                            payload["ended_at"],
                            json.dumps(payload, ensure_ascii=False),
                        ),
                    )
            finally:
                connection.close()

    def record_compact(self, record: CompactRecordInput) -> None:
        payload = {
            "id": str(uuid.uuid4()),
            "node_id": record.node_id,
            "node_label": record.node_label,
            "role_name": record.role_name,
            "tab_id": record.tab_id,
            "tab_title": record.tab_title,
            "provider_id": record.provider_id,
            "provider_name": record.provider_name,
            "provider_type": record.provider_type,
            "model": record.model,
            "trigger_type": record.trigger_type,
            "started_at": record.started_at,
            "ended_at": record.ended_at,
            "duration_ms": max(0.0, (record.ended_at - record.started_at) * 1000),
            "result": record.result,
            "error_summary": record.error_summary,
        }
        with self._lock:
            connection = open_state_db(create=True)
            assert connection is not None
            try:
                with connection:
                    self._prune_locked(connection, time.time())
                    connection.execute(
                        """
                        INSERT INTO compact_records (id, ended_at, payload)
                        VALUES (?, ?, ?)
                        """,
                        (
                            payload["id"],
                            payload["ended_at"],
                            json.dumps(payload, ensure_ascii=False),
                        ),
                    )
            finally:
                connection.close()

    def list_requests(self, *, since: float) -> list[dict[str, Any]]:
        with self._lock:
            return self._list_records(
                table_name="llm_request_records",
                since=since,
            )

    def list_compacts(self, *, since: float) -> list[dict[str, Any]]:
        with self._lock:
            return self._list_records(
                table_name="compact_records",
                since=since,
            )

    def _list_records(self, *, table_name: str, since: float) -> list[dict[str, Any]]:
        connection = open_state_db(create=False)
        if connection is None:
            return []
        try:
            with connection:
                self._prune_locked(connection, time.time())
                rows = connection.execute(
                    f"""
                    SELECT payload
                    FROM {table_name}
                    WHERE ended_at >= ?
                    ORDER BY ended_at
                    """,
                    (since,),
                ).fetchall()
        finally:
            connection.close()
        records: list[dict[str, Any]] = []
        for row in rows:
            payload = row["payload"]
            if not isinstance(payload, str):
                continue
            parsed = json.loads(payload)
            if isinstance(parsed, dict):
                records.append(parsed)
        return records


observability_store = ObservabilityStore()
