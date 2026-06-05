from __future__ import annotations

import os
import shutil
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class ShellInvocation:
    args: list[str]
    env: dict[str, str]
    shell: str


def executable_path(path: Path) -> str | None:
    if path.is_file() and os.access(path, os.X_OK):
        return str(path.resolve(strict=False))
    return None


def executable_command_path(command: str) -> str | None:
    resolved = shutil.which(command)
    if resolved is None:
        return None
    return executable_path(Path(resolved))


def shell_path(raw_shell: str) -> str | None:
    raw_shell = raw_shell.strip()
    if not raw_shell:
        return None
    expanded = Path(raw_shell).expanduser()
    if expanded.is_absolute():
        return executable_path(expanded)
    return executable_command_path(raw_shell)


def user_default_shell() -> str | None:
    try:
        import pwd
    except ImportError:
        return None

    try:
        shell = pwd.getpwuid(os.getuid()).pw_shell
    except (AttributeError, KeyError, OSError):
        return None
    return shell_path(shell)


def environment_shell() -> str | None:
    return shell_path(os.environ.get("SHELL", ""))


FALLBACK_SHELL_PATHS = {
    "bash": [Path("/bin/bash"), Path("/usr/bin/bash")],
    "sh": [Path("/bin/sh"), Path("/usr/bin/sh")],
}


def fallback_shell(command: str) -> str | None:
    shell = executable_command_path(command)
    if shell is not None:
        return shell
    for fallback in FALLBACK_SHELL_PATHS.get(command, []):
        shell = executable_path(fallback)
        if shell is not None:
            return shell
    return None


def default_shell() -> str:
    for shell in [user_default_shell(), environment_shell()]:
        if shell is not None:
            return shell
    for command in ["bash", "sh"]:
        shell = fallback_shell(command)
        if shell is not None:
            return shell
    return "sh"


def shell_invocation(command: str) -> ShellInvocation:
    shell = default_shell()
    return ShellInvocation(
        args=[shell, "-c", command],
        env={"SHELL": shell},
        shell=shell,
    )


def shell_invocation_description() -> str:
    return f"{default_shell()} -c"
