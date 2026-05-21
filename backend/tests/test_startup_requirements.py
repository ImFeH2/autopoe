import pytest

from flowent.cli import main
from flowent.main import create_app
from flowent.sandbox import SandboxError


def test_create_app_fails_when_sandbox_is_missing(monkeypatch) -> None:
    monkeypatch.setattr("flowent.sandbox.sandbox_binary", lambda: None)

    with pytest.raises(SandboxError, match="Install bubblewrap"):
        create_app(serve_frontend=False)


def test_create_app_starts_when_bwrap_is_available(monkeypatch) -> None:
    monkeypatch.setattr("flowent.sandbox.sandbox_binary", lambda: "/usr/bin/bwrap")

    app = create_app(serve_frontend=False)

    assert app.title == "Flowent"


def test_create_app_starts_when_bubblewrap_fallback_is_available(monkeypatch) -> None:
    monkeypatch.setattr("flowent.sandbox.sandbox_binary", lambda: "/usr/bin/bubblewrap")

    app = create_app(serve_frontend=False)

    assert app.title == "Flowent"


def test_doctor_reports_missing_sandbox(monkeypatch, capsys) -> None:
    monkeypatch.setattr("flowent.sandbox.sandbox_binary", lambda: None)

    with pytest.raises(SystemExit) as error:
        main(["doctor"])

    assert error.value.code == 1
    assert "Sandbox: missing." in capsys.readouterr().err


def test_doctor_reports_available_sandbox(monkeypatch, capsys) -> None:
    monkeypatch.setattr("flowent.sandbox.sandbox_binary", lambda: "/usr/bin/bwrap")

    with pytest.raises(SystemExit) as error:
        main(["doctor"])

    assert error.value.code == 0
    assert "Sandbox: /usr/bin/bwrap" in capsys.readouterr().out
