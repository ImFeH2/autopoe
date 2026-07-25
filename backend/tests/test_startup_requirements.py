import importlib
import os
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace

import pytest

from flowent.cli import main
from flowent.main import create_app
from flowent.paths import WORKDIR_ENV_VAR
from flowent.sandbox import (
    SandboxError,
    SandboxFailure,
    SandboxFailureKind,
    SandboxState,
    SandboxStatus,
)
from flowent.system_tools import (
    RuntimeFilesState,
    RuntimeFilesStatus,
    SystemToolError,
    SystemToolState,
    SystemToolStatus,
    ripgrep_binary,
    ripgrep_status,
    runtime_files_status,
)


def sandbox_status(
    state: SandboxState,
    *,
    executable: Path | None = None,
    source: str | None = None,
) -> SandboxStatus:
    failure = None
    if state not in {SandboxState.AVAILABLE, SandboxState.DEGRADED}:
        failure = SandboxFailure(
            kind=SandboxFailureKind.BACKEND_UNAVAILABLE,
            message="Command protection is not ready.",
            backend="test",
        )
    return SandboxStatus(
        backend="test",
        state=state,
        executable=executable,
        source=source,
        failure=failure,
    )


def patch_startup_protection(monkeypatch, status: SandboxStatus) -> None:
    monkeypatch.setattr(
        "flowent.bootstrap.SandboxRunner",
        lambda: SimpleNamespace(status=status),
    )


def patch_doctor_protection(monkeypatch, status: SandboxStatus) -> None:
    monkeypatch.setattr(
        "flowent.sandbox.SandboxRunner",
        lambda: SimpleNamespace(status=status),
    )


def test_create_app_fails_when_sandbox_is_missing(monkeypatch) -> None:
    patch_startup_protection(monkeypatch, sandbox_status(SandboxState.UNAVAILABLE))

    with pytest.raises(SandboxError, match="Command protection is not ready") as error:
        create_app(serve_frontend=False)

    assert error.value.failure.kind is SandboxFailureKind.BACKEND_UNAVAILABLE


def test_create_app_starts_when_bwrap_is_available(monkeypatch) -> None:
    patch_startup_protection(
        monkeypatch,
        sandbox_status(
            SandboxState.AVAILABLE,
            executable=Path("/usr/bin/bwrap"),
            source="system",
        ),
    )

    app = create_app(serve_frontend=False)

    assert app.title == "Flowent"


def test_create_app_starts_when_built_in_protection_is_available(monkeypatch) -> None:
    patch_startup_protection(
        monkeypatch,
        sandbox_status(
            SandboxState.AVAILABLE,
            executable=Path("/opt/flowent/bwrap"),
            source="bundled",
        ),
    )

    app = create_app(serve_frontend=False)

    assert app.title == "Flowent"


def test_create_app_starts_while_windows_setup_is_required(monkeypatch) -> None:
    patch_startup_protection(
        monkeypatch,
        sandbox_status(SandboxState.SETUP_REQUIRED),
    )
    monkeypatch.setattr(
        "flowent.system_tools.ripgrep_binary", lambda: "/opt/flowent/rg"
    )

    app = create_app(serve_frontend=False)

    assert app.title == "Flowent"


def test_create_app_fails_when_search_tool_is_missing(monkeypatch) -> None:
    patch_startup_protection(monkeypatch, sandbox_status(SandboxState.AVAILABLE))
    monkeypatch.setattr("flowent.system_tools.ripgrep_binary", lambda: None)

    with pytest.raises(SystemToolError, match="File search is not available"):
        create_app(serve_frontend=False)


def test_ripgrep_prefers_verified_built_in_resource(tmp_path, monkeypatch) -> None:
    built_in_rg = tmp_path / "runtime" / "rg"
    built_in_rg.parent.mkdir()
    built_in_rg.write_text("built in")
    built_in_rg.chmod(0o755)
    native = ModuleType("flowent_native")
    native.resource_path = lambda name: built_in_rg
    monkeypatch.setitem(sys.modules, "flowent_native", native)
    monkeypatch.setattr("flowent.system_tools._is_source_development", lambda: False)
    monkeypatch.setattr(
        "flowent.system_tools.shutil.which",
        lambda name: "/usr/bin/rg",
    )

    status = ripgrep_status()

    assert status == SystemToolStatus(
        state=SystemToolState.AVAILABLE,
        executable=built_in_rg.resolve(),
        source="built-in",
    )


def test_corrupted_built_in_ripgrep_does_not_fall_back_to_path(monkeypatch) -> None:
    class NativeResourceError(RuntimeError):
        pass

    native = ModuleType("flowent_native")

    def invalid_resource(name: str) -> Path:
        raise NativeResourceError("SHA256 mismatch")

    native.resource_path = invalid_resource
    monkeypatch.setitem(sys.modules, "flowent_native", native)
    monkeypatch.setattr("flowent.system_tools._is_source_development", lambda: False)
    monkeypatch.setenv("FLOWENT_SYSTEM_RUNTIME", "1")
    path_lookups: list[str] = []
    monkeypatch.setattr(
        "flowent.system_tools.shutil.which",
        lambda name: path_lookups.append(name) or "/usr/bin/rg",
    )

    status = ripgrep_status()

    assert status.state is SystemToolState.INVALID
    assert status.source == "built-in"
    assert path_lookups == []
    with pytest.raises(SystemToolError, match="built-in file failed verification"):
        ripgrep_binary()


def test_source_development_uses_system_files_before_unstaged_native_package(
    tmp_path, monkeypatch
) -> None:
    rg = tmp_path / "rg"
    rg.write_text("development")
    rg.chmod(0o755)
    native = ModuleType("flowent_native")

    def unstaged_resource(name: str) -> Path:
        raise RuntimeError("Runtime resources have not been staged")

    native.resource_path = unstaged_resource
    monkeypatch.setitem(sys.modules, "flowent_native", native)
    monkeypatch.setattr("flowent.system_tools._is_source_development", lambda: True)
    monkeypatch.setattr(
        "flowent.system_tools.shutil.which",
        lambda name: str(rg) if name == "rg" else None,
    )

    assert ripgrep_status() == SystemToolStatus(
        state=SystemToolState.AVAILABLE,
        executable=rg.resolve(),
        source="system",
    )
    assert runtime_files_status() == RuntimeFilesStatus(
        state=RuntimeFilesState.DEVELOPMENT,
        source="system",
    )


def test_container_runtime_uses_only_its_included_system_files(
    tmp_path, monkeypatch
) -> None:
    bwrap = tmp_path / "bwrap"
    rg = tmp_path / "rg"
    for executable in (bwrap, rg):
        executable.write_text("runtime")
        executable.chmod(0o755)
    paths = {"bwrap": str(bwrap), "rg": str(rg)}
    monkeypatch.setattr("flowent.system_tools._native_runtime_module", lambda: None)
    monkeypatch.setattr("flowent.system_tools._is_source_development", lambda: False)
    monkeypatch.setattr("flowent.system_tools.shutil.which", paths.get)
    monkeypatch.setenv("FLOWENT_SYSTEM_RUNTIME", "1")

    search = ripgrep_status()
    runtime = runtime_files_status()

    assert search == SystemToolStatus(
        state=SystemToolState.AVAILABLE,
        executable=rg.resolve(),
        source="system",
    )
    assert runtime == RuntimeFilesStatus(
        state=RuntimeFilesState.AVAILABLE,
        source="container",
        resource_count=2,
    )


def test_container_runtime_reports_a_missing_included_file(
    tmp_path, monkeypatch
) -> None:
    bwrap = tmp_path / "bwrap"
    bwrap.write_text("runtime")
    bwrap.chmod(0o755)
    monkeypatch.setattr("flowent.system_tools._native_runtime_module", lambda: None)
    monkeypatch.setattr("flowent.system_tools._is_source_development", lambda: False)
    monkeypatch.setattr(
        "flowent.system_tools.shutil.which",
        lambda name: str(bwrap) if name == "bwrap" else None,
    )
    monkeypatch.setenv("FLOWENT_SYSTEM_RUNTIME", "1")

    assert ripgrep_status() == SystemToolStatus(
        state=SystemToolState.MISSING,
        source="system",
    )
    assert runtime_files_status() == RuntimeFilesStatus(
        state=RuntimeFilesState.MISSING,
        source="container",
    )


def test_installed_flowent_does_not_fall_back_when_runtime_files_are_missing(
    monkeypatch,
) -> None:
    original_import_module = importlib.import_module

    def missing_native_runtime(name: str) -> ModuleType:
        if name == "flowent_native":
            raise ModuleNotFoundError(
                "No module named 'flowent_native'",
                name="flowent_native",
            )
        return original_import_module(name)

    path_lookups: list[str] = []
    monkeypatch.setattr(
        "flowent.system_tools.importlib.import_module",
        missing_native_runtime,
    )
    monkeypatch.setattr("flowent.system_tools._is_source_development", lambda: False)
    monkeypatch.setattr(
        "flowent.system_tools.shutil.which",
        lambda name: path_lookups.append(name) or "/usr/bin/rg",
    )

    status = ripgrep_status()

    assert status.state is SystemToolState.MISSING
    assert status.source == "built-in"
    assert path_lookups == []


def test_legacy_main_module_exports_create_app() -> None:
    from flowent.app import create_app as canonical_create_app
    from flowent.main import create_app as legacy_create_app

    assert legacy_create_app is canonical_create_app


def test_doctor_reports_unavailable_command_protection(monkeypatch, capsys) -> None:
    patch_doctor_protection(monkeypatch, sandbox_status(SandboxState.UNAVAILABLE))
    monkeypatch.setattr(
        "flowent.system_tools.ripgrep_status",
        lambda: SystemToolStatus(
            state=SystemToolState.AVAILABLE,
            executable=Path("/usr/bin/rg"),
            source="system",
        ),
    )
    monkeypatch.setattr(
        "flowent.system_tools.runtime_files_status",
        lambda: RuntimeFilesStatus(
            state=RuntimeFilesState.DEVELOPMENT,
            source="system",
        ),
    )

    with pytest.raises(SystemExit) as error:
        main(["doctor"])

    output = capsys.readouterr()
    assert error.value.code == 1
    assert "Command protection: unavailable" in output.err
    assert "Sandbox" not in output.out + output.err


def test_doctor_reports_missing_search_tool(monkeypatch, capsys) -> None:
    patch_doctor_protection(
        monkeypatch,
        sandbox_status(
            SandboxState.AVAILABLE,
            executable=Path("/usr/bin/bwrap"),
            source="system",
        ),
    )
    monkeypatch.setattr(
        "flowent.system_tools.ripgrep_status",
        lambda: SystemToolStatus(state=SystemToolState.MISSING),
    )
    monkeypatch.setattr(
        "flowent.system_tools.runtime_files_status",
        lambda: RuntimeFilesStatus(
            state=RuntimeFilesState.DEVELOPMENT,
            source="system",
        ),
    )

    with pytest.raises(SystemExit) as error:
        main(["doctor"])

    output = capsys.readouterr()
    assert error.value.code == 1
    assert "Command protection: ready (system: /usr/bin/bwrap)" in output.out
    assert "File search: unavailable" in output.err
    assert "Runtime files: ready (system files for development)" in output.out


def test_doctor_reports_available_built_in_files(monkeypatch, capsys) -> None:
    patch_doctor_protection(
        monkeypatch,
        sandbox_status(
            SandboxState.AVAILABLE,
            executable=Path("/opt/flowent/bwrap"),
            source="bundled",
        ),
    )
    monkeypatch.setattr(
        "flowent.system_tools.ripgrep_status",
        lambda: SystemToolStatus(
            state=SystemToolState.AVAILABLE,
            executable=Path("/opt/flowent/rg"),
            source="built-in",
        ),
    )
    monkeypatch.setattr(
        "flowent.system_tools.runtime_files_status",
        lambda: RuntimeFilesStatus(
            state=RuntimeFilesState.AVAILABLE,
            source="built-in",
            resource_count=2,
        ),
    )

    with pytest.raises(SystemExit) as error:
        main(["doctor"])

    output = capsys.readouterr()
    assert error.value.code == 0
    assert "Command protection: ready (built-in: /opt/flowent/bwrap)" in output.out
    assert "File search: ready (built-in: /opt/flowent/rg)" in output.out
    assert "Runtime files: ready (2 built-in files verified)" in output.out


def test_doctor_reports_included_container_files(monkeypatch, capsys) -> None:
    patch_doctor_protection(
        monkeypatch,
        sandbox_status(
            SandboxState.AVAILABLE,
            executable=Path("/usr/bin/bwrap"),
            source="system",
        ),
    )
    monkeypatch.setattr(
        "flowent.system_tools.ripgrep_status",
        lambda: SystemToolStatus(
            state=SystemToolState.AVAILABLE,
            executable=Path("/usr/bin/rg"),
            source="system",
        ),
    )
    monkeypatch.setattr(
        "flowent.system_tools.runtime_files_status",
        lambda: RuntimeFilesStatus(
            state=RuntimeFilesState.AVAILABLE,
            source="container",
            resource_count=2,
        ),
    )

    with pytest.raises(SystemExit) as error:
        main(["doctor"])

    output = capsys.readouterr()
    assert error.value.code == 0
    assert "Runtime files: ready (2 included files verified)" in output.out


def test_doctor_reports_windows_setup_required_without_calling_it_missing(
    monkeypatch, capsys
) -> None:
    patch_doctor_protection(
        monkeypatch,
        sandbox_status(SandboxState.SETUP_REQUIRED),
    )
    monkeypatch.setattr(
        "flowent.system_tools.ripgrep_status",
        lambda: SystemToolStatus(
            state=SystemToolState.AVAILABLE,
            executable=Path("C:/Flowent/rg.exe"),
            source="built-in",
        ),
    )
    monkeypatch.setattr(
        "flowent.system_tools.runtime_files_status",
        lambda: RuntimeFilesStatus(
            state=RuntimeFilesState.AVAILABLE,
            source="built-in",
            resource_count=2,
        ),
    )

    with pytest.raises(SystemExit) as error:
        main(["doctor"])

    output = capsys.readouterr()
    assert error.value.code == 1
    assert "Command protection: setup required" in output.err
    assert "approve Windows command protection setup" in output.err
    assert "missing" not in output.out + output.err


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
