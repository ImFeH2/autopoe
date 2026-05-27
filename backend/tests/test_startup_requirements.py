import os
import sys
from types import SimpleNamespace

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


def test_main_sets_workdir_for_server_start(tmp_path, monkeypatch) -> None:
    env_workdir = tmp_path / "env-workspace"
    workdir = tmp_path / "workspace"
    env_workdir.mkdir()
    workdir.mkdir()
    calls: list[tuple[str, dict[str, object]]] = []

    def fake_run(app: str, **kwargs: object) -> None:
        calls.append((app, kwargs))

    monkeypatch.setenv("FLOWENT_WORKDIR", str(env_workdir))
    monkeypatch.setitem(sys.modules, "uvicorn", SimpleNamespace(run=fake_run))

    main(
        [
            "--workdir",
            str(workdir),
            "--host",
            "127.0.0.1",
            "--port",
            "6899",
        ]
    )

    assert os.environ["FLOWENT_WORKDIR"] == str(workdir.resolve(strict=False))
    assert calls == [("flowent.main:app", {"host": "127.0.0.1", "port": 6899})]


def test_main_rejects_missing_workdir(tmp_path, capsys) -> None:
    missing = tmp_path / "missing"

    with pytest.raises(SystemExit) as error:
        main(["--workdir", str(missing)])

    assert error.value.code == 2
    assert f"Workdir does not exist: {missing}" in capsys.readouterr().err
