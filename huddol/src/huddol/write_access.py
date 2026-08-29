from __future__ import annotations

import os
import shutil
import sys
from collections.abc import Sequence
from pathlib import Path
from threading import Lock


def normalize_write_directories(
    values: Sequence[str],
    *,
    require_existing: bool,
) -> tuple[Path, ...]:
    normalized: list[Path] = []
    identities: set[str] = set()
    for value in values:
        if not isinstance(value, str) or not value:
            raise ValueError("write_directories must contain non-empty strings")
        candidate = Path(value).expanduser()
        if not candidate.is_absolute():
            raise ValueError("Writable directories must be absolute paths")
        try:
            resolved = candidate.resolve(strict=require_existing)
        except (OSError, RuntimeError, ValueError) as error:
            raise ValueError(f"Cannot resolve writable directory: {error}") from error
        if require_existing and not resolved.is_dir():
            raise ValueError("Writable directories must identify existing directories")
        identity = os.path.normcase(str(resolved))
        if identity in identities:
            continue
        identities.add(identity)
        normalized.append(resolved)
    return tuple(normalized)


def path_is_within(path: Path, roots: Sequence[Path]) -> bool:
    return any(path == root or path.is_relative_to(root) for root in roots)


class WriteAccessPolicy:
    def __init__(
        self,
        write_directories: Sequence[str] = (),
        *,
        enforce: bool = True,
    ) -> None:
        self._lock = Lock()
        self._enforce = enforce
        self._roots = normalize_write_directories(
            write_directories,
            require_existing=False,
        )
        self._windows = None
        if enforce and os.name == "nt":
            from huddol.windows_write_access import WindowsWriteAccess

            self._windows = WindowsWriteAccess(self._roots)

    @property
    def directories(self) -> tuple[str, ...]:
        with self._lock:
            return tuple(str(path) for path in self._roots)

    def require_writable(self, path: Path) -> None:
        if not self._enforce:
            return
        with self._lock:
            writable = path_is_within(path, self._roots)
        if not writable:
            raise _host_tool_error(
                "Path is outside the configured writable directories"
            )

    def command(self, argv: list[str], cwd: Path) -> list[str]:
        if not self._enforce:
            return argv
        with self._lock:
            roots = tuple(root for root in self._roots if root.is_dir())
            windows = self._windows
        if windows is not None:
            return _windows_command(windows.sid, argv)
        if sys.platform.startswith("linux"):
            return linux_write_sandbox_command(argv, cwd, roots)
        if sys.platform == "darwin":
            return macos_write_sandbox_command(argv, roots)
        raise _host_tool_error(
            "Filesystem write protection is unavailable on this platform"
        )

    def close(self) -> None:
        with self._lock:
            windows = self._windows
            self._windows = None
        if windows is not None:
            windows.close()


def linux_write_sandbox_command(
    argv: list[str],
    cwd: Path | str,
    write_directories: Sequence[Path | str],
    *,
    bwrap: str | None = None,
) -> list[str]:
    executable = bwrap or _bubblewrap_executable()
    roots = [str(root) for root in write_directories]
    command = [
        executable,
        "--new-session",
        "--die-with-parent",
        "--ro-bind",
        "/",
        "/",
        "--dev",
        "/dev",
        "--unshare-user",
    ]
    for rendered in sorted(
        roots,
        key=lambda path: path.count("/") + path.count("\\"),
    ):
        command.extend(("--bind", rendered, rendered))
    command.extend(("--chdir", str(cwd), "--cap-drop", "ALL", "--", *argv))
    return command


def macos_write_sandbox_command(
    argv: list[str],
    write_directories: Sequence[Path | str],
) -> list[str]:
    roots = [Path(root) for root in write_directories if Path(root).is_dir()]
    if roots:
        requirements = "\n".join(
            f'    (require-not (subpath (param "WRITABLE_{index}")))'
            for index in range(len(roots))
        )
        write_rule = (
            "(deny file-write*\n"
            "  (require-all\n"
            '    (require-not (literal "/dev/null"))\n'
            f"{requirements}))"
        )
    else:
        write_rule = '(deny file-write* (require-not (literal "/dev/null")))'
    unlink_rules = "\n".join(
        "(deny file-write-unlink\n"
        "  (require-all\n"
        f'    (literal (param "WRITABLE_{index}"))\n'
        "    (vnode-type DIRECTORY)))"
        for index in range(len(roots))
    )
    profile = "\n".join(
        part
        for part in ("(version 1)", "(allow default)", write_rule, unlink_rules)
        if part
    )
    parameters = [
        item
        for index, root in enumerate(roots)
        for item in (f"-DWRITABLE_{index}={root}",)
    ]
    return ["/usr/bin/sandbox-exec", "-p", profile, *parameters, "--", *argv]


def _bubblewrap_executable() -> str:
    for candidate in ("/usr/bin/bwrap", "/bin/bwrap"):
        if Path(candidate).is_file():
            return candidate
    executable = shutil.which("bwrap")
    if executable is None:
        raise _host_tool_error("bubblewrap is required for filesystem write protection")
    return str(Path(executable).resolve())


def _host_tool_error(message: str) -> Exception:
    from huddol.host_tools import HostToolError

    return HostToolError(message)


def _windows_command(sid: str, argv: list[str]) -> list[str]:
    if getattr(sys, "frozen", False):
        prefix = [sys.executable]
    else:
        prefix = [sys.executable, "-m", "huddol"]
    return [*prefix, "--windows-write-sandbox", sid, "--", *argv]
