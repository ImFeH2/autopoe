from __future__ import annotations

import subprocess
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import PurePosixPath, PureWindowsPath

from huddol.core.errors import DomainError

WSL_EXECUTABLE = "wsl.exe"
MOUNT_ROOT = "/mnt"


@dataclass(frozen=True)
class WslProbe:
    distribution: str


def normalize_wsl_directories(values: Sequence[str]) -> tuple[str, ...]:
    normalized: list[str] = []
    seen: set[str] = set()
    for value in values:
        if not isinstance(value, str) or not value.strip():
            raise DomainError(
                "invalid_directory", "Writable directories must be non-empty strings"
            )
        text = value.strip().replace("\\", "/")
        if not PurePosixPath(text).is_absolute():
            raise DomainError(
                "invalid_directory",
                "WSL writable directories must be absolute POSIX paths",
            )
        parts = [part for part in PurePosixPath(text).parts if part not in (".",)]
        if ".." in parts:
            raise DomainError(
                "invalid_directory", "Writable directories must not contain .."
            )
        rendered = PurePosixPath(*parts).as_posix()
        if rendered in seen:
            continue
        seen.add(rendered)
        normalized.append(rendered)
    return tuple(normalized)


def to_windows_path(posix_path: str, distribution: str) -> str:
    pure = PurePosixPath(posix_path.replace("\\", "/"))
    if not pure.is_absolute():
        raise DomainError("invalid_path", "Expected an absolute POSIX path")
    parts = pure.parts[1:]
    if len(parts) >= 2 and f"/{parts[0]}" == MOUNT_ROOT and len(parts[1]) == 1:
        drive = parts[1].upper()
        remainder = parts[2:]
        return str(PureWindowsPath(f"{drive}:\\", *remainder))
    return str(PureWindowsPath(f"\\\\wsl.localhost\\{distribution}", *parts))


def to_posix_path(windows_path: str) -> str:
    pure = PureWindowsPath(windows_path)
    drive = pure.drive
    remainder = pure.parts[1:]
    if drive.startswith("\\\\"):
        return PurePosixPath("/", *remainder).as_posix()
    if drive.endswith(":"):
        return PurePosixPath(MOUNT_ROOT, drive[:-1].lower(), *remainder).as_posix()
    raise DomainError("invalid_path", f"Cannot translate {windows_path} into WSL")


def wsl_command(
    argv: Sequence[str],
    cwd: str,
    write_directories: Sequence[str],
    distribution: str,
    *,
    bwrap: str = "/usr/bin/bwrap",
) -> list[str]:
    inner = [
        bwrap,
        "--new-session",
        "--die-with-parent",
        "--ro-bind",
        "/",
        "/",
        "--dev",
        "/dev",
        "--unshare-user",
    ]
    for root in sorted(write_directories, key=lambda item: item.count("/")):
        inner.extend(("--bind", root, root))
    inner.extend(("--chdir", cwd, "--cap-drop", "ALL", "--", *argv))
    return [WSL_EXECUTABLE, "-d", distribution, "--", *inner]


def probe_wsl(runner: object = None) -> WslProbe | None:
    execute = runner if callable(runner) else _default_probe
    try:
        output = execute()
    except (OSError, subprocess.SubprocessError):
        return None
    if not output:
        return None
    return WslProbe(distribution=output)


def _default_probe() -> str:
    result = subprocess.run(
        [WSL_EXECUTABLE, "-l", "-q"],
        capture_output=True,
        check=False,
        timeout=10,
    )
    if result.returncode != 0:
        return ""
    text = result.stdout.decode("utf-16-le", "ignore").strip()
    if not text:
        text = result.stdout.decode("utf-8", "ignore").strip()
    for line in text.splitlines():
        candidate = line.strip().strip("\x00")
        if candidate:
            return candidate
    return ""
