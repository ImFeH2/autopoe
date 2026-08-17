from __future__ import annotations

import json
import logging
import re
import sys
import traceback
from datetime import UTC, datetime
from logging.handlers import RotatingFileHandler
from pathlib import Path
from threading import Lock
from typing import Any

LOG_DIRECTORY_NAME = "logs"
LOG_FILE_NAME = "flowent.jsonl"
MAX_LOG_BYTES = 10 * 1024 * 1024
BACKUP_COUNT = 5

_logger = logging.getLogger("flowent.diagnostics")
_logger.setLevel(logging.DEBUG)
_logger.propagate = False
_lock = Lock()
_secrets: set[str] = set()
_sensitive_key = re.compile(
    r"(^|_)(api_key|authorization|credential|password|secret|token)($|_)",
    re.IGNORECASE,
)
_bearer = re.compile(r"(?i)(bearer\s+)[^\s,;]+")
_secret_prefix = re.compile(r"\b(?:sk|key)-[A-Za-z0-9._-]{8,}\b")


class SecureRotatingFileHandler(RotatingFileHandler):
    def _open(self) -> Any:
        stream = super()._open()
        try:
            Path(self.baseFilename).chmod(0o600)
        except OSError:
            stream.close()
            raise
        return stream


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        fields = getattr(record, "flowent_fields", {})
        payload = {
            "timestamp": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "level": record.levelname,
            "event": getattr(record, "flowent_event", "diagnostics.unknown"),
            "process_id": record.process,
            "thread": record.threadName,
            **fields,
        }
        return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def configure_diagnostics(
    directory: Path,
    *,
    max_bytes: int = MAX_LOG_BYTES,
    backup_count: int = BACKUP_COUNT,
) -> Path | None:
    try:
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        directory.chmod(0o700)
        logs_directory = directory / LOG_DIRECTORY_NAME
        logs_directory.mkdir(mode=0o700, exist_ok=True)
        logs_directory.chmod(0o700)
        path = logs_directory / LOG_FILE_NAME
        handler = SecureRotatingFileHandler(
            path,
            maxBytes=max_bytes,
            backupCount=backup_count,
            encoding="utf-8",
        )
        handler.setLevel(logging.INFO)
        handler.setFormatter(JsonFormatter())
    except OSError as error:
        print(
            f"[Flowent] Diagnostic logging unavailable: {type(error).__name__}",
            file=sys.stderr,
        )
        return None

    with _lock:
        for existing in _logger.handlers:
            existing.close()
        _logger.handlers = [handler]
    log_event(
        "diagnostics.configured",
        log_file=str(path),
        max_bytes=max_bytes,
        backup_count=backup_count,
    )
    return path


def shutdown_diagnostics() -> None:
    with _lock:
        handlers = list(_logger.handlers)
        _logger.handlers = []
    for handler in handlers:
        handler.close()


def register_secret(value: str | None) -> None:
    if value:
        with _lock:
            _secrets.add(value)


def log_event(event: str, *, level: int = logging.INFO, **fields: Any) -> None:
    if not _logger.handlers:
        return
    safe_fields = {
        key: _sanitize_value(value, sensitive=bool(_sensitive_key.search(key)))
        for key, value in fields.items()
    }
    _logger.log(
        level,
        event,
        extra={"flowent_event": event, "flowent_fields": safe_fields},
    )


def log_exception(event: str, error: BaseException, **fields: Any) -> None:
    print(f"[Flowent] {event}: {type(error).__name__}", file=sys.stderr)
    error_types = exception_chain_types(error)
    stack = [
        f"{frame.filename}:{frame.lineno}:{frame.name}"
        for frame in traceback.extract_tb(error.__traceback__)
    ]
    log_event(
        event,
        level=logging.ERROR,
        error_type=error_types[0],
        error_cause_type=error_types[1] if len(error_types) > 1 else None,
        root_error_type=error_types[-1],
        stack=stack,
        **fields,
    )


def exception_chain_types(error: BaseException) -> tuple[str, ...]:
    types: list[str] = []
    seen: set[int] = set()
    current: BaseException | None = error
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        types.append(type(current).__name__)
        current = current.__cause__ or current.__context__
    return tuple(types)


def _sanitize_value(value: Any, *, sensitive: bool = False) -> Any:
    if sensitive:
        return "[REDACTED]"
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return _sanitize_text(value)
    if isinstance(value, (list, tuple)):
        return [_sanitize_value(item) for item in value]
    return "[UNSUPPORTED]"


def _sanitize_text(value: str) -> str:
    with _lock:
        secrets = tuple(_secrets)
    sanitized = value
    for secret in secrets:
        sanitized = sanitized.replace(secret, "[REDACTED]")
    sanitized = _bearer.sub(r"\1[REDACTED]", sanitized)
    return _secret_prefix.sub("[REDACTED]", sanitized)
