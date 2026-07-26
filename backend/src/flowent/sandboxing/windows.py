from __future__ import annotations

import base64
import csv
import json
import shutil
import subprocess
import tempfile
import threading
from collections.abc import Callable, Mapping
from pathlib import Path, PureWindowsPath
from typing import Any, TypeAlias

from flowent.paths import data_directory
from flowent.sandboxing.core import (
    CleanupResource,
    PreparedProcess,
    ProcessLaunchOptions,
    SandboxBackend,
    SandboxError,
    SandboxFailure,
    SandboxFailureKind,
    SandboxPolicy,
    SandboxState,
    SandboxStatus,
)
from flowent.sandboxing.environment import build_shell_environment
from flowent.sandboxing.resources import (
    ResolvedExecutable,
    ResourceResolutionError,
    ResourceSource,
    native_resource_path,
)
from flowent.shell import windows_system_shell_paths

CommandRunner: TypeAlias = Callable[..., subprocess.CompletedProcess[str]]
HelperResolver: TypeAlias = Callable[[], ResolvedExecutable | None]
SetupLauncher: TypeAlias = Callable[[Path, Path, Path, str], None]
OwnerSidProvider: TypeAlias = Callable[[], str]
_SETUP_LOCK = threading.Lock()
_SETUP_VERSION = 2
_STATUS_FIELDS = {
    "version",
    "operation",
    "state",
    "code",
    "message",
    "setup_version",
    "process_id",
    "exit_code",
}
_STATUS_STATES = {
    "ready",
    "setup_required",
    "running",
    "completed",
    "failed",
    "unavailable",
}


def default_windows_helper() -> ResolvedExecutable | None:
    path = native_resource_path("flowent-native")
    if path is None:
        return None
    resolved = path.expanduser().resolve(strict=False)
    if not resolved.is_file():
        raise ResourceResolutionError("Built-in Windows helper is not a file.")
    return ResolvedExecutable(path=resolved, source=ResourceSource.BUNDLED)


def _powershell_quote(value: str) -> str:
    escaped = value.replace("'", "''")
    return f"'{escaped}'"


def _encoded_powershell(command: str) -> str:
    return base64.b64encode(command.encode("utf-16-le")).decode("ascii")


def launch_elevated_setup(
    executable: Path,
    state_dir: Path,
    status_path: Path,
    owner_sid: str,
) -> None:
    powershell, _ = windows_system_shell_paths()
    arguments = subprocess.list2cmdline(
        [
            "setup",
            "--state-dir",
            str(state_dir),
            "--status-file",
            str(status_path),
            "--owner-sid",
            owner_sid,
        ]
    )
    command = (
        f"$process = Start-Process -FilePath {_powershell_quote(str(executable))} "
        f"-ArgumentList {_powershell_quote(arguments)} -Verb RunAs -Wait -PassThru; "
        "exit $process.ExitCode"
    )
    completed = subprocess.run(
        [
            powershell,
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-EncodedCommand",
            _encoded_powershell(command),
        ],
        check=False,
        env=build_shell_environment(),
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        try:
            record = _read_status(status_path, "setup")
            message = str(record["message"])
        except ValueError:
            message = (
                completed.stderr.strip()
                or completed.stdout.strip()
                or "Command protection setup failed."
            )
        raise OSError(message)


def current_owner_sid() -> str:
    _, cmd = windows_system_shell_paths()
    whoami = str(PureWindowsPath(cmd).parent / "whoami.exe")
    completed = subprocess.run(
        [whoami, "/user", "/fo", "csv", "/nh"],
        check=True,
        env=build_shell_environment(),
        capture_output=True,
        text=True,
    )
    rows = list(csv.reader(completed.stdout.splitlines()))
    if len(rows) != 1 or len(rows[0]) != 2:
        raise OSError("Windows user identity is unavailable.")
    sid = rows[0][1].strip()
    if not sid.upper().startswith("S-1-"):
        raise OSError("Windows user identity is invalid.")
    return sid


def _read_status(path: Path, expected_operation: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ValueError("Command protection status could not be read.") from error
    if not isinstance(value, dict) or set(value) - _STATUS_FIELDS:
        raise ValueError("Command protection status has an invalid structure.")
    required = {
        "version": int,
        "operation": str,
        "state": str,
        "code": str,
        "message": str,
        "setup_version": int,
    }
    for name, expected_type in required.items():
        item = value.get(name)
        if isinstance(item, bool) or not isinstance(item, expected_type):
            raise ValueError("Command protection status has an invalid structure.")
    if value["version"] != 1 or value["setup_version"] != _SETUP_VERSION:
        raise ValueError("Command protection status uses an unsupported version.")
    if value["operation"] != expected_operation or value["state"] not in _STATUS_STATES:
        raise ValueError("Command protection status has an invalid operation or state.")
    for name in ("process_id", "exit_code"):
        item = value.get(name)
        if item is not None and (isinstance(item, bool) or not isinstance(item, int)):
            raise ValueError("Command protection status has an invalid result.")
    return value


def _is_windows_platform_path(path: Path) -> bool:
    try:
        _, system_cmd = windows_system_shell_paths()
        windows_root = PureWindowsPath(system_cmd).parent.parent
        PureWindowsPath(path).relative_to(windows_root)
    except (OSError, ValueError):
        return False
    return True


def _command_runtime_roots(executable: str) -> tuple[Path, ...]:
    path = Path(executable)
    if not path.is_absolute():
        located = shutil.which(executable, path=build_shell_environment().get("PATH"))
        if located is None:
            return ()
        path = Path(located)
    try:
        resolved = path.resolve(strict=True)
    except OSError:
        return ()
    if not resolved.is_file() or _is_windows_platform_path(resolved):
        return ()
    return (resolved.parent,)


def _unavailable_status(
    message: str,
    *,
    state: SandboxState = SandboxState.UNAVAILABLE,
    executable: Path | None = None,
    source: str | None = None,
    reason: str,
) -> SandboxStatus:
    failure = SandboxFailure(
        kind=SandboxFailureKind.BACKEND_UNAVAILABLE,
        message=message,
        backend="windows",
        details=(("reason", reason),),
    )
    return SandboxStatus(
        backend="windows",
        state=state,
        executable=executable,
        source=source,
        failure=failure,
    )


class WindowsSandboxBackend(SandboxBackend):
    name = "windows"

    def __init__(
        self,
        *,
        resolver: HelperResolver = default_windows_helper,
        state_dir: Path | None = None,
        command_runner: CommandRunner = subprocess.run,
        setup_launcher: SetupLauncher = launch_elevated_setup,
        owner_sid_provider: OwnerSidProvider = current_owner_sid,
    ) -> None:
        self.resolver = resolver
        self.state_dir = (
            (state_dir or data_directory() / "command-protection" / "windows")
            .expanduser()
            .resolve(strict=False)
        )
        self.command_runner = command_runner
        self.setup_launcher = setup_launcher
        self.owner_sid_provider = owner_sid_provider

    def _resolve(self) -> ResolvedExecutable | None:
        try:
            return self.resolver()
        except Exception as error:
            if isinstance(error, ResourceResolutionError):
                raise
            raise ResourceResolutionError(
                "Built-in Windows helper could not be resolved."
            ) from error

    def status(self) -> SandboxStatus:
        try:
            resolved = self._resolve()
        except ResourceResolutionError:
            return _unavailable_status(
                "Built-in command protection failed verification.",
                reason="helper_invalid",
            )
        if resolved is None:
            return _unavailable_status(
                "Built-in command protection is unavailable.",
                reason="helper_missing",
            )
        source = resolved.source.value
        with tempfile.TemporaryDirectory(prefix="flowent-windows-probe-") as raw_dir:
            status_path = Path(raw_dir) / "status.json"
            try:
                self.command_runner(
                    [
                        str(resolved.path),
                        "probe",
                        "--state-dir",
                        str(self.state_dir),
                        "--status-file",
                        str(status_path),
                    ],
                    check=False,
                    env=build_shell_environment(),
                    capture_output=True,
                    text=True,
                    timeout=15,
                )
                record = _read_status(status_path, "probe")
            except (OSError, subprocess.SubprocessError, ValueError):
                return _unavailable_status(
                    "Command protection could not verify this system.",
                    executable=resolved.path,
                    source=source,
                    reason="probe_failed",
                )
        if record["state"] == "ready" and record["code"] == "ready":
            return SandboxStatus(
                backend=self.name,
                state=SandboxState.AVAILABLE,
                executable=resolved.path,
                source=source,
                capabilities=frozenset(
                    {"filesystem", "network_policy", "process_tree"}
                ),
            )
        if record["state"] == "setup_required":
            return _unavailable_status(
                record["message"],
                state=SandboxState.SETUP_REQUIRED,
                executable=resolved.path,
                source=source,
                reason="setup_required",
            )
        return _unavailable_status(
            record["message"],
            executable=resolved.path,
            source=source,
            reason=str(record["code"]),
        )

    def _ready_status(self) -> SandboxStatus:
        with _SETUP_LOCK:
            status = self.status()
            if status.state is SandboxState.SETUP_REQUIRED:
                if status.executable is None:
                    raise SandboxError(failure=status.failure)
                with tempfile.TemporaryDirectory(
                    prefix="flowent-windows-setup-"
                ) as raw_dir:
                    setup_status = Path(raw_dir) / "status.json"
                    try:
                        self.setup_launcher(
                            status.executable,
                            self.state_dir,
                            setup_status,
                            self.owner_sid_provider(),
                        )
                    except (OSError, subprocess.SubprocessError) as error:
                        failure = SandboxFailure(
                            kind=SandboxFailureKind.BACKEND_UNAVAILABLE,
                            message="Command protection setup was not completed.",
                            backend=self.name,
                            details=(("reason", "setup_not_completed"),),
                        )
                        raise SandboxError(failure=failure) from error
                status = self.status()
            if not status.available:
                raise SandboxError(failure=status.failure)
            return status

    def prepare(
        self,
        command: list[str],
        policy: SandboxPolicy,
        *,
        include_seccomp: bool = True,
    ) -> PreparedProcess:
        if not command or not command[0]:
            failure = SandboxFailure(
                kind=SandboxFailureKind.PREPARATION_FAILED,
                message="Protected command is empty.",
                backend=self.name,
            )
            raise SandboxError(failure=failure)
        status = self._ready_status()
        if status.executable is None:
            raise SandboxError(failure=status.failure)
        temporary = tempfile.TemporaryDirectory(prefix="flowent-windows-command-")
        runtime_dir = Path(temporary.name).resolve(strict=False)
        helper = runtime_dir / "flowent-native.exe"
        policy_path = runtime_dir / "policy.json"
        status_path = runtime_dir / "status.json"
        try:
            shutil.copy2(status.executable, helper)
            policy_record = {
                "version": 1,
                "cwd": str(policy.cwd),
                "writable_roots": [str(path) for path in policy.writable_roots],
                "readable_roots": [
                    str(path) for path in _command_runtime_roots(command[0])
                ],
                "runtime_dir": str(runtime_dir),
                "network": "enabled" if policy.allow_network else "disabled",
                "status_file": str(status_path),
            }
            policy_path.write_text(
                json.dumps(policy_record, separators=(",", ":")),
                encoding="utf8",
            )
        except (OSError, TypeError, ValueError) as error:
            temporary.cleanup()
            failure = SandboxFailure(
                kind=SandboxFailureKind.PREPARATION_FAILED,
                message="Command protection could not prepare the command.",
                backend=self.name,
            )
            raise SandboxError(failure=failure) from error
        return PreparedProcess(
            args=[
                str(helper),
                "run",
                "--state-dir",
                str(self.state_dir),
                "--policy",
                str(policy_path),
                "--",
                *command,
            ],
            launch_options=ProcessLaunchOptions(start_new_session=False),
            capabilities=status.capabilities,
            resources=(CleanupResource(temporary.cleanup),),
            status=status,
            metadata={"status_file": status_path},
        )

    def classify_prepared_result(
        self,
        exit_code: int,
        stderr: str,
        metadata: Mapping[str, object],
    ) -> SandboxFailure | None:
        status_path = metadata.get("status_file")
        if not isinstance(status_path, Path):
            return SandboxFailure(
                kind=SandboxFailureKind.BACKEND_LAUNCH_FAILED,
                message="Command protection did not report a result.",
                backend=self.name,
                details=(("reason", "status_path_missing"),),
            )
        try:
            record = _read_status(status_path, "run")
        except ValueError:
            return SandboxFailure(
                kind=SandboxFailureKind.BACKEND_LAUNCH_FAILED,
                message="Command protection did not report a valid result.",
                backend=self.name,
                details=(("reason", "status_invalid"),),
            )
        if record["state"] == "completed" and record.get("exit_code") == exit_code:
            if exit_code == 0:
                return None
            return SandboxFailure(
                kind=SandboxFailureKind.COMMAND_FAILED,
                message="Command failed.",
                backend=self.name,
                details=(("exit_code", str(exit_code)),),
            )
        if record["state"] in {"setup_required", "unavailable"}:
            kind = SandboxFailureKind.BACKEND_UNAVAILABLE
        else:
            kind = SandboxFailureKind.BACKEND_LAUNCH_FAILED
        return SandboxFailure(
            kind=kind,
            message=record["message"],
            backend=self.name,
            details=(("code", str(record["code"])),),
        )
