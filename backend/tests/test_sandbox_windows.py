from __future__ import annotations

import base64
import json
import subprocess
from pathlib import Path

import pytest

from flowent.sandboxing import (
    SandboxError,
    SandboxFailureKind,
    SandboxPolicy,
    SandboxState,
)
from flowent.sandboxing.resources import ResolvedExecutable, ResourceSource
from flowent.sandboxing.windows import (
    WindowsSandboxBackend,
    _is_windows_platform_path,
    current_owner_sid,
    launch_elevated_setup,
)


def status_record(
    state: str, code: str, message: str, **extra: object
) -> dict[str, object]:
    return {
        "version": 1,
        "operation": "probe",
        "state": state,
        "code": code,
        "message": message,
        "setup_version": 1,
        **extra,
    }


def resolved_helper(path: Path):
    return lambda: ResolvedExecutable(path=path, source=ResourceSource.BUNDLED)


def test_windows_platform_paths_do_not_require_runtime_acl_changes() -> None:
    assert _is_windows_platform_path(Path("C:/Windows/System32/cmd.exe"))
    assert not _is_windows_platform_path(
        Path("C:/hostedtoolcache/windows/Python/3.13.13/x64/python.exe")
    )


def test_windows_backend_reports_ready_from_helper_probe(tmp_path: Path) -> None:
    helper = tmp_path / "flowent-native.exe"
    helper.write_bytes(b"helper")

    def run(args: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        status_path = Path(args[args.index("--status-file") + 1])
        status_path.write_text(
            json.dumps(status_record("ready", "ready", "Protection is ready."))
        )
        return subprocess.CompletedProcess(args, 0, "", "")

    backend = WindowsSandboxBackend(
        resolver=resolved_helper(helper),
        state_dir=tmp_path / "state",
        command_runner=run,
    )

    status = backend.status()

    assert status.state is SandboxState.AVAILABLE
    assert status.executable == helper
    assert status.source == "bundled"
    assert {"filesystem", "network_policy", "process_tree"} <= status.capabilities


def test_windows_backend_preserves_setup_required_state(tmp_path: Path) -> None:
    helper = tmp_path / "flowent-native.exe"
    helper.write_bytes(b"helper")

    def run(args: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        status_path = Path(args[args.index("--status-file") + 1])
        status_path.write_text(
            json.dumps(
                status_record(
                    "setup_required",
                    "setup_required",
                    "One-time setup is required.",
                )
            )
        )
        return subprocess.CompletedProcess(args, 1, "", "")

    backend = WindowsSandboxBackend(
        resolver=resolved_helper(helper),
        state_dir=tmp_path / "state",
        command_runner=run,
    )

    status = backend.status()

    assert status.state is SandboxState.SETUP_REQUIRED
    assert status.failure is not None
    assert status.failure.kind is SandboxFailureKind.BACKEND_UNAVAILABLE
    assert status.failure.message == "One-time setup is required."


def test_windows_prepare_runs_setup_once_and_builds_strict_policy(
    tmp_path: Path,
) -> None:
    helper = tmp_path / "flowent-native.exe"
    helper.write_bytes(b"helper")
    state_dir = tmp_path / "state"
    probes = 0
    setups = 0

    def run(args: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        nonlocal probes
        probes += 1
        status_path = Path(args[args.index("--status-file") + 1])
        state = "setup_required" if probes == 1 else "ready"
        status_path.write_text(
            json.dumps(
                status_record(
                    state, state, "Setup required." if probes == 1 else "Ready."
                )
            )
        )
        return subprocess.CompletedProcess(args, 1 if probes == 1 else 0, "", "")

    def setup(
        executable: Path,
        selected_state_dir: Path,
        status_path: Path,
        owner_sid: str,
    ) -> None:
        nonlocal setups
        setups += 1
        assert executable == helper
        assert selected_state_dir == state_dir.resolve()
        assert owner_sid == "S-1-5-21-1000"
        selected_state_dir.mkdir(parents=True, exist_ok=True)
        status_path.write_text(
            json.dumps(status_record("ready", "ready", "Setup complete."))
        )

    workspace = tmp_path / "workspace"
    temporary = tmp_path / "temporary"
    approved = tmp_path / "approved"
    command_runtime = tmp_path / "runtime"
    for path in (workspace, temporary, approved, command_runtime):
        path.mkdir()
    executable = command_runtime / "python.exe"
    executable.write_bytes(b"python")
    backend = WindowsSandboxBackend(
        resolver=resolved_helper(helper),
        state_dir=state_dir,
        command_runner=run,
        setup_launcher=setup,
        owner_sid_provider=lambda: "S-1-5-21-1000",
    )

    prepared = backend.prepare(
        [str(executable), "-c", "print('hello')"],
        SandboxPolicy(
            cwd=workspace,
            writable_roots=(approved,),
            temporary_roots=(temporary,),
            allow_network=False,
        ),
    )

    assert setups == 1
    assert probes == 2
    assert prepared.args[:2] == [str(prepared.args[0]), "run"]
    assert prepared.args[-4:] == ["--", str(executable), "-c", "print('hello')"]
    policy_path = Path(prepared.args[prepared.args.index("--policy") + 1])
    policy = json.loads(policy_path.read_text())
    assert policy == {
        "version": 1,
        "cwd": str(workspace.resolve()),
        "writable_roots": [
            str(workspace.resolve()),
            str(temporary.resolve()),
            str(approved.resolve()),
        ],
        "readable_roots": [str(command_runtime.resolve())],
        "runtime_dir": str(policy_path.parent),
        "network": "disabled",
        "status_file": str(policy_path.parent / "status.json"),
    }
    copied_helper = Path(prepared.args[0])
    assert copied_helper.parent == policy_path.parent
    assert copied_helper.read_bytes() == b"helper"
    assert prepared.metadata["status_file"] == policy_path.parent / "status.json"
    prepared.close()
    assert not policy_path.parent.exists()


def test_windows_backend_rejects_invalid_helper_status(tmp_path: Path) -> None:
    helper = tmp_path / "flowent-native.exe"
    helper.write_bytes(b"helper")

    def run(args: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        status_path = Path(args[args.index("--status-file") + 1])
        status_path.write_text('{"state":"ready"}')
        return subprocess.CompletedProcess(args, 0, "", "")

    backend = WindowsSandboxBackend(
        resolver=resolved_helper(helper),
        state_dir=tmp_path / "state",
        command_runner=run,
    )

    status = backend.status()

    assert status.state is SandboxState.UNAVAILABLE
    assert status.failure is not None
    assert status.failure.kind is SandboxFailureKind.BACKEND_UNAVAILABLE


def test_windows_result_uses_status_file_to_distinguish_child_failure(
    tmp_path: Path,
) -> None:
    helper = tmp_path / "flowent-native.exe"
    helper.write_bytes(b"helper")
    backend = WindowsSandboxBackend(
        resolver=resolved_helper(helper),
        state_dir=tmp_path / "state",
        command_runner=lambda args, **kwargs: subprocess.CompletedProcess(
            args, 0, "", ""
        ),
    )
    status_path = tmp_path / "status.json"
    status_path.write_text(
        json.dumps(
            {
                **status_record("completed", "completed", "Command completed."),
                "operation": "run",
                "exit_code": 7,
            }
        )
    )

    failure = backend.classify_prepared_result(
        7,
        "Permission denied",
        {"status_file": status_path},
    )

    assert failure is not None
    assert failure.kind is SandboxFailureKind.COMMAND_FAILED


def test_windows_prepare_stops_when_setup_is_not_completed(tmp_path: Path) -> None:
    helper = tmp_path / "flowent-native.exe"
    helper.write_bytes(b"helper")

    def run(args: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        status_path = Path(args[args.index("--status-file") + 1])
        status_path.write_text(
            json.dumps(
                status_record("setup_required", "setup_required", "Setup required.")
            )
        )
        return subprocess.CompletedProcess(args, 1, "", "")

    def setup(*args: object) -> None:
        raise OSError("cancelled")

    backend = WindowsSandboxBackend(
        resolver=resolved_helper(helper),
        state_dir=tmp_path / "state",
        command_runner=run,
        setup_launcher=setup,
        owner_sid_provider=lambda: "S-1-5-21-1000",
    )

    with pytest.raises(SandboxError) as error:
        backend.prepare(["cmd.exe"], SandboxPolicy(cwd=tmp_path))

    assert error.value.failure.kind is SandboxFailureKind.BACKEND_UNAVAILABLE


def test_windows_setup_uses_trusted_powershell_and_encoded_command(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[list[str], dict[str, object]]] = []
    monkeypatch.setattr(
        "flowent.sandboxing.windows.windows_system_shell_paths",
        lambda: (
            "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
            "C:\\Windows\\System32\\cmd.exe",
        ),
    )

    def run(args: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        calls.append((args, kwargs))
        return subprocess.CompletedProcess(args, 0, "", "")

    monkeypatch.setattr("flowent.sandboxing.windows.subprocess.run", run)
    helper = tmp_path / "Flowent's helper.exe"

    launch_elevated_setup(
        helper,
        tmp_path / "state folder",
        tmp_path / "setup status.json",
        "S-1-5-21-1000",
    )

    args, kwargs = calls[0]
    assert args[0] == "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
    assert args[1:5] == ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand"]
    decoded = base64.b64decode(args[5]).decode("utf-16-le")
    assert "Start-Process" in decoded
    assert "-Verb RunAs" in decoded
    assert "Flowent''s helper.exe" in decoded
    assert kwargs["check"] is False


def test_windows_setup_reports_helper_failure(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "flowent.sandboxing.windows.windows_system_shell_paths",
        lambda: (
            "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
            "C:\\Windows\\System32\\cmd.exe",
        ),
    )

    def run(args: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        status_path.write_text(
            json.dumps(
                {
                    **status_record(
                        "failed",
                        "account_setup_failed",
                        "Protected account setup failed.",
                    ),
                    "operation": "setup",
                }
            )
        )
        return subprocess.CompletedProcess(args, 70, "", "")

    monkeypatch.setattr("flowent.sandboxing.windows.subprocess.run", run)
    status_path = tmp_path / "setup.json"

    with pytest.raises(OSError, match="Protected account setup failed"):
        launch_elevated_setup(
            tmp_path / "flowent-native.exe",
            tmp_path / "state",
            status_path,
            "S-1-5-21-1000",
        )


def test_windows_owner_sid_uses_system_whoami(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[list[str]] = []
    monkeypatch.setattr(
        "flowent.sandboxing.windows.windows_system_shell_paths",
        lambda: (
            "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
            "C:\\Windows\\System32\\cmd.exe",
        ),
    )

    def run(args: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        calls.append(args)
        return subprocess.CompletedProcess(
            args,
            0,
            '"DESKTOP\\user","S-1-5-21-1000"\n',
            "",
        )

    monkeypatch.setattr("flowent.sandboxing.windows.subprocess.run", run)

    assert current_owner_sid() == "S-1-5-21-1000"
    assert calls == [
        [
            "C:\\Windows\\System32\\whoami.exe",
            "/user",
            "/fo",
            "csv",
            "/nh",
        ]
    ]
