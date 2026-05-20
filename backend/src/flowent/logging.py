from __future__ import annotations

import logging
import os
import re
import sys
from datetime import datetime
from pathlib import Path

from flowent.paths import data_directory

TRACE_LEVEL = 5
DEFAULT_LOG_RETENTION = 5
_configured_log_file: Path | None = None
_configured_log_process_id: int | None = None
_SECRET_PATTERNS = (
    re.compile(r"(?i)\b(bearer)\s+([^\s,}]+)"),
    re.compile(
        r"(?i)(api[_-]?key|authorization|secret[_-]?reference|access[_-]?key)([\"'\s:=]+)([^\"'\s,}]+)"
    ),
)


def install_trace_level() -> None:
    if logging.getLevelName(TRACE_LEVEL) != "TRACE":
        logging.addLevelName(TRACE_LEVEL, "TRACE")


def redact_log_value(value: object) -> str:
    text = str(value)
    for pattern in _SECRET_PATTERNS:
        text = pattern.sub(
            lambda match: f"{match.group(1)}{match.group(2)}[REDACTED]", text
        )
    return text


def log_directory(directory: Path | None = None) -> Path:
    return (directory or data_directory()) / "logs"


def parse_log_level(value: str | None, default: int) -> int:
    if not value:
        return default
    normalized = value.strip().upper()
    if normalized == "TRACE":
        return TRACE_LEVEL
    if normalized.isdigit():
        return int(normalized)
    level = logging.getLevelName(normalized)
    return level if isinstance(level, int) else default


def development_mode() -> bool:
    return os.environ.get("DEBUG", "").strip().lower() in {"1", "true", "yes", "on"}


def console_log_level() -> int:
    default = logging.DEBUG if development_mode() else logging.INFO
    return parse_log_level(os.environ.get("LOG_LEVEL"), default)


def log_retention() -> int:
    raw_retention = os.environ.get("FLOWENT_LOG_RETENTION")
    if not raw_retention:
        return DEFAULT_LOG_RETENTION
    try:
        return max(1, int(raw_retention))
    except ValueError:
        return DEFAULT_LOG_RETENTION


def new_log_file_path(directory: Path | None = None) -> Path:
    logs = log_directory(directory)
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    return logs / f"flowent-{timestamp}-{os.getpid()}.log"


def prune_old_logs(logs: Path, *, keep: int = DEFAULT_LOG_RETENTION) -> None:
    files = sorted(logs.glob("flowent-*.log"), key=lambda item: item.name)
    for old_log in files[:-keep]:
        try:
            old_log.unlink()
        except OSError as error:
            logging.getLogger("flowent.logging").warning(
                "Could not remove old log file %s: %s", old_log, error
            )


class RedactingFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        rendered = super().format(record)
        return redact_log_value(rendered)


class ConsoleNoiseFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        return record.levelno > logging.DEBUG or record.name.startswith("flowent")


def configure_logging(*, directory: Path | None = None) -> Path:
    global _configured_log_file, _configured_log_process_id

    install_trace_level()

    log_file = new_log_file_path(directory)
    log_file.parent.mkdir(mode=0o700, parents=True, exist_ok=True)

    root_logger = logging.getLogger()
    for handler in list(root_logger.handlers):
        root_logger.removeHandler(handler)
        handler.close()

    root_logger.setLevel(TRACE_LEVEL)

    file_handler = logging.FileHandler(log_file, encoding="utf-8")
    file_handler.setLevel(TRACE_LEVEL)
    file_handler.setFormatter(
        RedactingFormatter(
            "%(asctime)s %(levelname)s [%(process)d] %(name)s: %(message)s"
        )
    )

    console_handler = logging.StreamHandler(sys.stderr)
    console_handler.setLevel(console_log_level())
    console_handler.setFormatter(
        RedactingFormatter("%(levelname)s %(name)s: %(message)s")
    )
    console_handler.addFilter(ConsoleNoiseFilter())

    root_logger.addHandler(file_handler)
    root_logger.addHandler(console_handler)

    prune_old_logs(log_file.parent, keep=log_retention())

    logger = logging.getLogger("flowent")
    logger.info("Flowent logging initialized")
    logger.info("Data directory: %s", directory or data_directory())
    logger.info("Log file: %s", log_file)
    logger.debug("Console log level: %s", logging.getLevelName(console_log_level()))
    logger.log(TRACE_LEVEL, "File log level: TRACE")

    _configured_log_file = log_file
    _configured_log_process_id = os.getpid()

    return log_file


def ensure_logging_configured(*, directory: Path | None = None) -> Path:
    target_log_directory = log_directory(directory).resolve(strict=False)
    if (
        _configured_log_file is not None
        and _configured_log_process_id == os.getpid()
        and _configured_log_file.parent.resolve(strict=False) == target_log_directory
    ):
        return _configured_log_file

    return configure_logging(directory=directory)
