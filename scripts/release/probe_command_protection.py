from __future__ import annotations

import argparse
import sys
import tempfile
from pathlib import Path

from flowent.sandbox import SandboxRunner
from flowent.sandboxing.linux import LinuxSandboxBackend
from flowent.sandboxing.resources import ExecutableResolver, native_resource_path

PROBE_SOURCE = """
import sys
from pathlib import Path

allowed = Path(sys.argv[1])
blocked = Path(sys.argv[2])
allowed.write_text("ready", encoding="utf8")
try:
    blocked.write_text("unexpected", encoding="utf8")
except OSError:
    pass
else:
    raise SystemExit(20)
print("ready", end="")
"""


def _runner(cwd: Path) -> SandboxRunner:
    if not sys.platform.startswith("linux"):
        return SandboxRunner(cwd=cwd, timeout_seconds=60)
    resolver = ExecutableResolver(
        system_names=(),
        bundled_provider=lambda: native_resource_path("bubblewrap"),
    )
    return SandboxRunner(
        cwd=cwd,
        timeout_seconds=60,
        backend=LinuxSandboxBackend(resolver=resolver),
    )


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
        result = runner.run(
            [
                sys.executable,
                "-I",
                "-c",
                PROBE_SOURCE,
                str(allowed_file),
                str(blocked_file),
            ]
        )
        if result.exit_code != 0 or result.failure is not None:
            message = result.stderr
            if not message and result.failure is not None:
                message = result.failure.message
            raise RuntimeError(message or "Protected command failed.")
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
