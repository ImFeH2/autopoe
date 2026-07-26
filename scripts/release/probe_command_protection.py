from __future__ import annotations

import argparse
import sys
import tempfile
from pathlib import Path

from flowent.sandbox import CommandResult, SandboxRunner
from flowent.sandboxing.linux import LinuxSandboxBackend
from flowent.sandboxing.resources import ExecutableResolver, native_resource_path
from flowent.shell import windows_system_shell_paths

PROBE_SOURCE = """
import faulthandler
import sys
from pathlib import Path

faulthandler.dump_traceback_later(10)
allowed = Path(sys.argv[1])
blocked = Path(sys.argv[2])
allowed.write_text("ready", encoding="utf8")
try:
    blocked.write_text("unexpected", encoding="utf8")
except OSError:
    pass
else:
    raise SystemExit(20)
faulthandler.cancel_dump_traceback_later()
print("ready", end="")
"""


def _runner(cwd: Path) -> SandboxRunner:
    if not sys.platform.startswith("linux"):
        timeout = 20 if sys.platform == "win32" else 60
        return SandboxRunner(cwd=cwd, timeout_seconds=timeout)
    resolver = ExecutableResolver(
        system_names=(),
        bundled_provider=lambda: native_resource_path("bubblewrap"),
    )
    return SandboxRunner(
        cwd=cwd,
        timeout_seconds=60,
        backend=LinuxSandboxBackend(resolver=resolver),
    )


def _environment() -> dict[str, str] | None:
    if sys.platform == "win32":
        return {"FLOWENT_NATIVE_TRACE": "1"}
    return None


def _require_success(result: CommandResult, label: str) -> None:
    if result.exit_code == 0 and result.failure is None:
        return
    message = result.stderr
    if not message and result.failure is not None:
        message = result.failure.message
    raise RuntimeError(f"{label}: {message or 'Protected command failed.'}")


def probe_command_protection(root: Path) -> None:
    probe_root = root.expanduser().resolve(strict=False)
    probe_root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(
        prefix="flowent-command-protection-",
        dir=probe_root,
    ) as directory:
        boundary = Path(directory)
        workspace = boundary / "workspace"
        workspace.mkdir()
        allowed_file = workspace / "allowed.txt"
        blocked_file = boundary / "blocked.txt"
        runner = _runner(workspace)
        if sys.platform == "win32":
            _, cmd = windows_system_shell_paths()
            launch_result = runner.run(
                [cmd, "/d", "/c", "exit", "0"],
                env=_environment(),
            )
            _require_success(launch_result, "Windows protected process launch failed")
            print("Windows protected process launch passed.")
            helper = runner.status.executable
            if helper is None:
                raise RuntimeError("Windows command protection file is unavailable.")
            native_result = runner.run(
                [str(helper), "help"],
                env=_environment(),
            )
            _require_success(native_result, "Windows protected runtime launch failed")
            if not native_result.stdout.startswith("Usage:"):
                raise RuntimeError(
                    "Windows protected runtime returned unexpected output."
                )
            print("Windows protected runtime launch passed.")
        result = runner.run(
            [
                sys.executable,
                "-I",
                "-c",
                PROBE_SOURCE,
                str(allowed_file),
                str(blocked_file),
            ],
            env=_environment(),
        )
        _require_success(result, "Command protection boundary failed")
        if result.stdout != "ready":
            raise RuntimeError("Protected command returned unexpected output.")
        if allowed_file.read_text(encoding="utf8") != "ready":
            raise RuntimeError("Protected command could not write in its workspace.")
        if blocked_file.exists():
            raise RuntimeError("Protected command wrote outside its workspace.")
        status = runner.status
        if not status.available:
            raise RuntimeError("Command protection did not remain available.")
        if sys.platform.startswith("linux") and status.source != "bundled":
            raise RuntimeError(
                "Linux did not use the built-in command protection file."
            )
        print(f"Command protection probe passed: {status.backend} ({status.source})")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    args = parser.parse_args()
    probe_command_protection(args.root)


if __name__ == "__main__":
    main()
