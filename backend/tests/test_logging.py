import logging

from flowent.logging import (
    TRACE_LEVEL,
    configure_logging,
    redact_log_value,
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
