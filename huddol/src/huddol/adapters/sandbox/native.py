from __future__ import annotations

import difflib
import os
import subprocess
import sys
from collections.abc import Sequence
from pathlib import Path

from huddol.adapters.sandbox.commands import (
    linux_command,
    macos_command,
    windows_command,
)
from huddol.adapters.sandbox.paths import (
    is_within,
    normalize_directories,
    normalize_tolerantly,
)
from huddol.core.errors import DomainError
from huddol.ports.sandbox import EditResult, RunResult

MAX_OUTPUT = 200_000
DEFAULT_TIMEOUT = 120


class NativeSandbox:
    def __init__(
        self,
        root: Path | str,
        write_directories: Sequence[str] = (),
        *,
        enforce: bool = True,
        tolerant: bool = False,
    ) -> None:
        self._root = Path(root).resolve()
        self._enforce = enforce
        self._windows: object | None = None
        self.skipped: tuple[tuple[str, str], ...] = ()
        if tolerant:
            result = normalize_tolerantly(write_directories)
            self._roots = result.accepted
            self.skipped = result.skipped
        else:
            self._roots = normalize_directories(write_directories)

    @property
    def root(self) -> str:
        return str(self._root)

    @property
    def write_directories(self) -> tuple[str, ...]:
        return tuple(str(item) for item in self._roots)

    def configure(self, write_directories: Sequence[str]) -> None:
        self._roots = normalize_directories(write_directories)
        if self._windows is not None:
            self._windows.configure(  # type: ignore[attr-defined]
                tuple(root for root in self._roots if root.is_dir())
            )

    def close(self) -> None:
        if self._windows is not None:
            self._windows.close()  # type: ignore[attr-defined]
            self._windows = None

    def describe_environment(self) -> str:
        listing = "\n".join(f"- {item}" for item in self.write_directories) or "- none"
        return (
            f"Your working root is {self._root}.\n"
            f"You can read any path the host user can read.\n"
            f"You can only write inside:\n{listing}"
        )

    def require_writable(self, path: Path) -> None:
        if not self._enforce:
            return
        if not is_within(path.resolve(), self._roots):
            raise DomainError(
                "not_writable", "Path is outside the configured writable directories"
            )

    def _wrap(self, argv: Sequence[str], cwd: Path) -> list[str]:
        if not self._enforce:
            return list(argv)
        existing = tuple(root for root in self._roots if root.is_dir())
        if sys.platform.startswith("linux"):
            return linux_command(argv, cwd, existing)
        if sys.platform == "darwin":
            return macos_command(argv, existing)
        if os.name == "nt":
            from huddol.adapters.sandbox.windows import WindowsWriteAccess

            if self._windows is None:
                self._windows = WindowsWriteAccess(existing)
            return windows_command(
                self._windows.sid,  # type: ignore[attr-defined]
                argv,
            )
        raise DomainError(
            "sandbox_unavailable",
            "Filesystem write protection is unavailable on this platform",
        )

    def _resolve_cwd(self, cwd: str | None) -> Path:
        if cwd is None:
            return self._root
        candidate = Path(cwd)
        target = candidate if candidate.is_absolute() else self._root / candidate
        resolved = target.resolve()
        if not resolved.is_dir():
            raise DomainError("invalid_cwd", f"{cwd} is not a directory")
        return resolved

    def run(
        self,
        argv: Sequence[str],
        *,
        cwd: str | None = None,
        timeout: int | None = None,
    ) -> RunResult:
        if not argv or not all(isinstance(item, str) for item in argv):
            raise DomainError(
                "invalid_argv", "argv must be a non-empty list of strings"
            )
        directory = self._resolve_cwd(cwd)
        command = self._wrap(argv, directory)
        try:
            completed = subprocess.run(
                command,
                cwd=directory,
                stdin=subprocess.DEVNULL,
                capture_output=True,
                timeout=timeout or DEFAULT_TIMEOUT,
                check=False,
            )
        except FileNotFoundError as error:
            raise DomainError("command_not_found", str(error)) from error
        except subprocess.TimeoutExpired as error:
            raise DomainError(
                "timeout", f"Command exceeded {timeout or DEFAULT_TIMEOUT} seconds"
            ) from error

        stdout = completed.stdout.decode("utf-8", "replace")
        stderr = completed.stderr.decode("utf-8", "replace")
        truncated = len(stdout) > MAX_OUTPUT or len(stderr) > MAX_OUTPUT
        return RunResult(
            exit_code=completed.returncode,
            stdout=stdout[:MAX_OUTPUT],
            stderr=stderr[:MAX_OUTPUT],
            truncated=truncated,
        )

    def edit(
        self,
        path: str,
        old_text: str,
        new_text: str,
        *,
        replace_all: bool = False,
    ) -> EditResult:
        if not isinstance(old_text, str) or not old_text:
            raise DomainError("invalid_edit", "old_text must be a non-empty string")
        if not isinstance(new_text, str):
            raise DomainError("invalid_edit", "new_text must be a string")
        candidate = Path(path)
        target = (
            candidate if candidate.is_absolute() else self._root / candidate
        ).resolve()
        if not target.is_file():
            raise DomainError("not_found", f"{path} does not exist")
        self.require_writable(target)

        try:
            original = target.read_text(encoding="utf-8")
        except UnicodeDecodeError as error:
            raise DomainError("not_text", f"{path} is not valid UTF-8") from error

        occurrences = original.count(old_text)
        if occurrences == 0:
            raise DomainError("no_match", "old_text does not appear in the file")
        if occurrences > 1 and not replace_all:
            raise DomainError(
                "ambiguous_match",
                f"old_text appears {occurrences} times; pass replace_all to change all",
            )

        updated = (
            original.replace(old_text, new_text)
            if replace_all
            else original.replace(old_text, new_text, 1)
        )
        temporary = target.with_name(target.name + ".huddol-tmp")
        temporary.write_text(updated, encoding="utf-8")
        os.replace(temporary, target)

        diff = "".join(
            difflib.unified_diff(
                original.splitlines(keepends=True),
                updated.splitlines(keepends=True),
                fromfile=str(target),
                tofile=str(target),
                n=3,
            )
        )
        return EditResult(
            path=str(target),
            diff=diff,
            replacements=occurrences if replace_all else 1,
        )
