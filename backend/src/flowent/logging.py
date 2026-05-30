from __future__ import annotations

import json
import logging
import os
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

from flowent.paths import data_directory

TRACE_LEVEL = 5
DEFAULT_LOG_RETENTION = 5
LITELLM_LOGGER_NAMES = ("LiteLLM", "LiteLLM Router", "LiteLLM Proxy")
_configured_log_file: Path | None = None
_configured_log_process_id: int | None = None
_llm_request_counter = 0
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


def redact_diagnostic_value(value: object) -> str:
    text = str(value)
    for pattern in _SECRET_PATTERNS:
        text = pattern.sub("[REDACTED]", text)
    return text


def log_directory(directory: Path | None = None) -> Path:
    return (directory or data_directory()) / "logs"


def llm_request_log_directory(directory: Path | None = None) -> Path:
    return log_directory(directory) / "llm-requests"


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


def litellm_handler_level_name(value: str | None) -> str:
    if not value:
        return "INFO"
    normalized = value.strip().upper()
    if normalized.isdigit():
        numeric_level = int(normalized)
        if numeric_level <= logging.INFO:
            return "INFO"
        level_name = logging.getLevelName(numeric_level)
        return level_name if isinstance(level_name, str) else "INFO"
    level = parse_log_level(normalized, logging.INFO)
    if level < logging.INFO:
        return "INFO"
    if normalized == "WARN":
        return "WARNING"
    if isinstance(logging.getLevelName(normalized), int):
        return normalized
    return "INFO"


def configure_litellm_logging() -> None:
    os.environ["LITELLM_LOG"] = litellm_handler_level_name(
        os.environ.get("LITELLM_LOG")
    )
    handlers_to_close: set[logging.Handler] = set()
    for logger_name in LITELLM_LOGGER_NAMES:
        litellm_logger = logging.getLogger(logger_name)
        for handler in list(litellm_logger.handlers):
            litellm_logger.removeHandler(handler)
            handlers_to_close.add(handler)
        litellm_logger.propagate = True
    for handler in handlers_to_close:
        handler.close()


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


def sanitize_diagnostic_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: sanitize_diagnostic_value(item)
            for key, item in value.items()
            if not secret_field_name(str(key))
        }
    if isinstance(value, list | tuple):
        return [sanitize_diagnostic_value(item) for item in value]
    if isinstance(value, str):
        return redact_diagnostic_value(value)
    return value


def secret_field_name(name: str) -> bool:
    normalized = re.sub(r"[^a-z0-9]", "", name.lower())
    return "secret" in normalized or normalized in {
        "accesstoken",
        "apikey",
        "authorization",
        "password",
        "refreshtoken",
        "token",
    }


def write_llm_request_diagnostic(payload: dict[str, Any]) -> Path | None:
    global _llm_request_counter

    if not development_mode():
        return None

    _llm_request_counter += 1
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    path = llm_request_log_directory() / (
        f"llm-request-{timestamp}-{os.getpid()}-{_llm_request_counter:06d}.json"
    )
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    path.write_text(
        json.dumps(sanitize_diagnostic_value(payload), ensure_ascii=False, indent=2)
        + "\n",
        encoding="utf-8",
    )
    return path


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
    configure_litellm_logging()

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
    configure_litellm_logging()

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
