import os
import sys
from types import SimpleNamespace

import pytest

from flowent.cli import main
from flowent.main import create_app
from flowent.paths import WORKDIR_ENV_VAR
from flowent.sandbox import SandboxError
from flowent.system_tools import SystemToolError


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


def test_create_app_fails_when_search_tool_is_missing(monkeypatch) -> None:
    monkeypatch.setattr("flowent.system_tools.ripgrep_binary", lambda: None)

    with pytest.raises(SystemToolError, match="Install ripgrep"):
        create_app(serve_frontend=False)


def test_legacy_main_module_exports_create_app() -> None:
    from flowent.app import create_app as canonical_create_app
    from flowent.main import create_app as legacy_create_app

    assert legacy_create_app is canonical_create_app


def test_doctor_reports_missing_sandbox(monkeypatch, capsys) -> None:
    monkeypatch.setattr("flowent.sandbox.sandbox_binary", lambda: None)

    with pytest.raises(SystemExit) as error:
        main(["doctor"])

    assert error.value.code == 1
    assert "Sandbox: missing." in capsys.readouterr().err


def test_doctor_reports_missing_search_tool(monkeypatch, capsys) -> None:
    monkeypatch.setattr("flowent.system_tools.ripgrep_binary", lambda: None)

    with pytest.raises(SystemExit) as error:
        main(["doctor"])

    output = capsys.readouterr()
    assert error.value.code == 1
    assert "Sandbox: /usr/bin/bwrap" in output.out
    assert "Search: missing." in output.err
    assert "Install ripgrep" in output.err


def test_doctor_reports_available_sandbox(monkeypatch, capsys) -> None:
    monkeypatch.setattr("flowent.sandbox.sandbox_binary", lambda: "/usr/bin/bwrap")
    monkeypatch.setattr("flowent.system_tools.ripgrep_binary", lambda: "/usr/bin/rg")

    with pytest.raises(SystemExit) as error:
        main(["doctor"])

    output = capsys.readouterr()
    assert error.value.code == 0
    assert "Sandbox: /usr/bin/bwrap" in output.out
    assert "Search: /usr/bin/rg" in output.out


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
    assert calls == [("flowent.app:app", {"host": "127.0.0.1", "port": 6899})]


def test_main_uses_default_host_when_environment_is_not_set(
    tmp_path, monkeypatch
) -> None:
    workdir = tmp_path / "workspace"
    workdir.mkdir()
    calls: list[tuple[str, dict[str, object]]] = []

    def fake_run(app: str, **kwargs: object) -> None:
        calls.append((app, kwargs))

    monkeypatch.delenv("FLOWENT_HOST", raising=False)
    monkeypatch.setenv(WORKDIR_ENV_VAR, str(workdir))
    monkeypatch.setitem(sys.modules, "uvicorn", SimpleNamespace(run=fake_run))

    main(["--workdir", str(workdir), "--port", "6899"])

    assert calls == [("flowent.app:app", {"host": "127.0.0.1", "port": 6899})]


def test_main_reads_host_from_environment(tmp_path, monkeypatch) -> None:
    workdir = tmp_path / "workspace"
    workdir.mkdir()
    calls: list[tuple[str, dict[str, object]]] = []

    def fake_run(app: str, **kwargs: object) -> None:
        calls.append((app, kwargs))

    monkeypatch.setenv("FLOWENT_HOST", "0.0.0.0")
    monkeypatch.setenv(WORKDIR_ENV_VAR, str(workdir))
    monkeypatch.setitem(sys.modules, "uvicorn", SimpleNamespace(run=fake_run))

    main(["--workdir", str(workdir), "--port", "6899"])

    assert calls == [("flowent.app:app", {"host": "0.0.0.0", "port": 6899})]


def test_main_prefers_host_argument_over_environment(tmp_path, monkeypatch) -> None:
    workdir = tmp_path / "workspace"
    workdir.mkdir()
    calls: list[tuple[str, dict[str, object]]] = []

    def fake_run(app: str, **kwargs: object) -> None:
        calls.append((app, kwargs))

    monkeypatch.setenv("FLOWENT_HOST", "0.0.0.0")
    monkeypatch.setenv(WORKDIR_ENV_VAR, str(workdir))
    monkeypatch.setitem(sys.modules, "uvicorn", SimpleNamespace(run=fake_run))

    main(["--workdir", str(workdir), "--host", "127.0.0.1", "--port", "6899"])

    assert calls == [("flowent.app:app", {"host": "127.0.0.1", "port": 6899})]


def test_main_rejects_missing_workdir(tmp_path, capsys) -> None:
    missing = tmp_path / "missing"

    with pytest.raises(SystemExit) as error:
        main(["--workdir", str(missing)])

    assert error.value.code == 2
    assert f"Workdir does not exist: {missing}" in capsys.readouterr().err
