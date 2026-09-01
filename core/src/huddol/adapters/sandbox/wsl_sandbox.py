from __future__ import annotations

import difflib
import os
import subprocess
from collections.abc import Sequence
from pathlib import Path

from huddol.adapters.sandbox.wsl import (
    WslProbe,
    normalize_wsl_directories,
    to_windows_path,
    wsl_command,
)
from huddol.core.errors import DomainError
from huddol.ports.sandbox import EditResult, RunResult

MAX_OUTPUT = 200_000
DEFAULT_TIMEOUT = 120


class WslSandbox:
    def __init__(
        self,
        root: str,
        write_directories: Sequence[str],
        probe: WslProbe,
        *,
        tolerant: bool = False,
    ) -> None:
        self._root = root
        self._probe = probe
        self.skipped: tuple[tuple[str, str], ...] = ()
        if tolerant:
            accepted: list[str] = []
            skipped: list[tuple[str, str]] = []
            for value in write_directories:
                try:
                    accepted.extend(normalize_wsl_directories([value]))
                except DomainError as error:
                    skipped.append((str(value), error.code))
            self._roots = tuple(dict.fromkeys(accepted))
            self.skipped = tuple(skipped)
        else:
            self._roots = normalize_wsl_directories(write_directories)

    @property
    def root(self) -> str:
        return self._root

    @property
    def write_directories(self) -> tuple[str, ...]:
        return self._roots

    def configure(self, write_directories: Sequence[str]) -> None:
        self._roots = normalize_wsl_directories(write_directories)

    def describe_environment(self) -> str:
        listing = "\n".join(f"- {item}" for item in self._roots) or "- none"
        return (
            f"Your commands run inside WSL {self._probe.distribution}.\n"
            "Always give paths in absolute form. Relative paths resolve against "
            f"{self._root}, which is not a project directory and is not writable.\n"
            "Windows drives are available under /mnt/<drive-letter>.\n"
            f"You can only write inside:\n{listing}"
        )

    def _within(self, path: str) -> bool:
        return any(path == root or path.startswith(f"{root}/") for root in self._roots)

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
        directory = cwd or self._root
        if not directory.startswith("/"):
            directory = f"{self._root.rstrip('/')}/{directory}"
        command = wsl_command(argv, directory, self._roots, self._probe.distribution)
        try:
            completed = subprocess.run(
                command,
                stdin=subprocess.DEVNULL,
                capture_output=True,
                timeout=timeout or DEFAULT_TIMEOUT,
                check=False,
            )
        except FileNotFoundError as error:
            raise DomainError("sandbox_unavailable", str(error)) from error
        except subprocess.TimeoutExpired as error:
            raise DomainError(
                "timeout", f"Command exceeded {timeout or DEFAULT_TIMEOUT} seconds"
            ) from error

        stdout = completed.stdout.decode("utf-8", "replace")
        stderr = completed.stderr.decode("utf-8", "replace")
        return RunResult(
            exit_code=completed.returncode,
            stdout=stdout[:MAX_OUTPUT],
            stderr=stderr[:MAX_OUTPUT],
            truncated=len(stdout) > MAX_OUTPUT or len(stderr) > MAX_OUTPUT,
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
        posix = path if path.startswith("/") else f"{self._root.rstrip('/')}/{path}"
        if not self._within(posix):
            raise DomainError(
                "not_writable", "Path is outside the configured writable directories"
            )
        target = Path(to_windows_path(posix, self._probe.distribution))
        if not target.is_file():
            raise DomainError("not_found", f"{path} does not exist")

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

        return EditResult(
            path=posix,
            diff="".join(
                difflib.unified_diff(
                    original.splitlines(keepends=True),
                    updated.splitlines(keepends=True),
                    fromfile=posix,
                    tofile=posix,
                    n=3,
                )
            ),
            replacements=occurrences if replace_all else 1,
        )
