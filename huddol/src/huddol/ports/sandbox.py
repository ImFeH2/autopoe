from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class RunResult:
    exit_code: int
    stdout: str
    stderr: str
    truncated: bool


@dataclass(frozen=True)
class EditResult:
    path: str
    diff: str
    replacements: int


class Sandbox(Protocol):
    @property
    def root(self) -> str: ...

    @property
    def write_directories(self) -> tuple[str, ...]: ...

    def configure(self, write_directories: Sequence[str]) -> None: ...

    def describe_environment(self) -> str: ...

    def run(
        self, argv: Sequence[str], *, cwd: str | None = None, timeout: int | None = None
    ) -> RunResult: ...

    def edit(
        self, path: str, old_text: str, new_text: str, *, replace_all: bool = False
    ) -> EditResult: ...
