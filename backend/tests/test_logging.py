import logging
import sys

from flowent.logging import (
    LITELLM_LOGGER_NAMES,
    TRACE_LEVEL,
    configure_litellm_logging,
    configure_logging,
    ensure_logging_configured,
    redact_log_value,
    sanitize_diagnostic_value,
)


def test_logging_creates_run_file_under_data_logs(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))

    log_file = configure_logging()

    assert log_file.parent == tmp_path / "logs"
    assert log_file.name.startswith("flowent-")
    assert log_file.suffix == ".log"
    assert log_file.is_file()


def test_file_logging_accepts_trace_and_console_uses_mode_levels(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("DEBUG", "False")

    log_file = configure_logging()
    handlers = logging.getLogger().handlers
    file_handler = next(
        handler for handler in handlers if isinstance(handler, logging.FileHandler)
    )
    console_handler = next(
        handler for handler in handlers if not isinstance(handler, logging.FileHandler)
    )

    assert file_handler.level == TRACE_LEVEL
    assert console_handler.level == logging.INFO

    logging.getLogger("flowent.test").log(TRACE_LEVEL, "trace-only detail")
    for handler in logging.getLogger().handlers:
        handler.flush()

    assert "trace-only detail" in log_file.read_text()

    monkeypatch.setenv("DEBUG", "True")
    configure_logging()
    console_handler = next(
        handler
        for handler in logging.getLogger().handlers
        if not isinstance(handler, logging.FileHandler)
    )

    assert console_handler.level == logging.DEBUG


def test_logging_prunes_old_run_logs(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    logs = tmp_path / "logs"
    logs.mkdir(parents=True)
    for index in range(6):
        (logs / f"flowent-20260101-00000{index}-1.log").write_text(str(index))

    configure_logging()

    files = sorted(log.name for log in logs.glob("flowent-*.log"))
    assert len(files) == 5
    assert "flowent-20260101-000000-1.log" not in files


def test_logging_path_follows_flowent_data_dir(tmp_path, monkeypatch) -> None:
    data_dir = tmp_path / "custom-flowent"
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(data_dir))

    log_file = configure_logging()

    assert log_file.parent == data_dir / "logs"


def test_logging_redacts_full_api_key_but_keeps_context(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    log_file = configure_logging()

    logging.getLogger("flowent.test").log(
        TRACE_LEVEL,
        "provider=OpenAI model=gpt-5 output=hello api_key=sk-secret-value",
    )
    for handler in logging.getLogger().handlers:
        handler.flush()

    rendered = log_file.read_text()

    assert "provider=OpenAI" in rendered
    assert "model=gpt-5" in rendered
    assert "output=hello" in rendered
    assert "sk-secret-value" not in rendered
    assert "api_key=[REDACTED]" in rendered
    assert redact_log_value("authorization=Bearer sk-secret-value") == (
        "authorization=[REDACTED]"
    )


def test_diagnostic_sanitizer_removes_secret_fields_and_values() -> None:
    sanitized = sanitize_diagnostic_value(
        {
            "api_key": "sk-root-secret",
            "messages": [
                {
                    "role": "user",
                    "content": "authorization=Bearer sk-message-secret",
                }
            ],
            "tools": [
                {
                    "function": {
                        "name": "send_message",
                        "description": "Needs api_key=sk-tool-secret.",
                    }
                }
            ],
        }
    )

    rendered = str(sanitized)

    assert "api_key" not in rendered
    assert "sk-root-secret" not in rendered
    assert "sk-message-secret" not in rendered
    assert "sk-tool-secret" not in rendered


def test_direct_app_import_creates_data_log_file(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    sys.modules.pop("flowent.app", None)
    sys.modules.pop("flowent.main", None)

    try:
        __import__("flowent.app")
    finally:
        sys.modules.pop("flowent.app", None)
        sys.modules.pop("flowent.main", None)

    files = sorted((tmp_path / "logs").glob("flowent-*.log"))
    assert len(files) == 1


def test_create_app_creates_data_log_file(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))

    from flowent.main import create_app

    create_app(serve_frontend=False)

    files = sorted((tmp_path / "logs").glob("flowent-*.log"))
    assert len(files) == 1


def test_create_app_reuses_logging_handlers(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))

    from flowent.main import create_app

    create_app(serve_frontend=False)
    create_app(serve_frontend=False)

    handlers = logging.getLogger().handlers
    file_handlers = [
        handler for handler in handlers if isinstance(handler, logging.FileHandler)
    ]
    console_handlers = [
        handler for handler in handlers if not isinstance(handler, logging.FileHandler)
    ]
    files = sorted((tmp_path / "logs").glob("flowent-*.log"))

    assert len(file_handlers) == 1
    assert len(console_handlers) == 1
    assert len(files) == 1


def test_any_logging_path_follows_flowent_data_dir(tmp_path, monkeypatch) -> None:
    data_dir = tmp_path / "custom-flowent"
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(data_dir))

    log_file = ensure_logging_configured()

    assert log_file.parent == data_dir / "logs"


def test_litellm_debug_logs_use_flowent_handlers(tmp_path, monkeypatch, capsys) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("LITELLM_LOG", raising=False)

    log_file = configure_logging()
    import litellm  # noqa: F401

    configure_litellm_logging()
    logging.getLogger("LiteLLM").debug("stream chunk detail")
    for handler in logging.getLogger().handlers:
        handler.flush()

    captured = capsys.readouterr()
    litellm_handlers = [
        handler
        for logger_name in LITELLM_LOGGER_NAMES
        for handler in logging.getLogger(logger_name).handlers
    ]

    assert litellm_handlers == []
    assert "stream chunk detail" not in captured.err
    assert "stream chunk detail" in log_file.read_text()
