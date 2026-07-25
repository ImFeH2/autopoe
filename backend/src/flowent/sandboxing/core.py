from __future__ import annotations

import os
import tempfile
from abc import ABC, abstractmethod
from collections.abc import Callable, Iterable, Mapping
from contextlib import suppress
from dataclasses import dataclass, field, replace
from enum import StrEnum
from pathlib import Path
from typing import BinaryIO, Protocol


class SandboxFailureKind(StrEnum):
    POLICY_DENIED = "policy_denied"
    BACKEND_UNAVAILABLE = "backend_unavailable"
    BACKEND_LAUNCH_FAILED = "backend_launch_failed"
    PREPARATION_FAILED = "preparation_failed"
    COMMAND_FAILED = "command_failed"
    TIMEOUT = "timeout"
    CANCELLED = "cancelled"


@dataclass(frozen=True)
class SandboxFailure:
    kind: SandboxFailureKind
    message: str
    backend: str | None = None
    details: tuple[tuple[str, str], ...] = ()


class SandboxState(StrEnum):
    AVAILABLE = "available"
    DEGRADED = "degraded"
    SETUP_REQUIRED = "setup_required"
    UNAVAILABLE = "unavailable"


@dataclass(frozen=True)
class SandboxStatus:
    backend: str
    state: SandboxState
    executable: Path | None = None
    source: str | None = None
    capabilities: frozenset[str] = frozenset()
    failure: SandboxFailure | None = None

    @property
    def available(self) -> bool:
        return self.state in {SandboxState.AVAILABLE, SandboxState.DEGRADED}


class SandboxError(RuntimeError):
    def __init__(
        self,
        message: str | None = None,
        *,
        failure: SandboxFailure | None = None,
    ) -> None:
        resolved_message = message or (
            failure.message if failure is not None else "Command protection failed."
        )
        self.failure = failure or SandboxFailure(
            kind=SandboxFailureKind.PREPARATION_FAILED,
            message=resolved_message,
        )
        super().__init__(resolved_message)


def default_temporary_roots() -> tuple[Path, ...]:
    if os.name == "nt":
        return (Path(tempfile.gettempdir()),)
    return (Path("/tmp"),)


def normalized_path(path: Path) -> Path:
    return path.expanduser().resolve(strict=False)


@dataclass(frozen=True)
class SandboxPolicy:
    cwd: Path
    writable_roots: tuple[Path, ...] = ()
    temporary_roots: tuple[Path, ...] = field(default_factory=default_temporary_roots)
    allow_network: bool = True

    def __post_init__(self) -> None:
        cwd = normalized_path(self.cwd)
        roots: list[Path] = []
        for root in (cwd, *self.temporary_roots, *self.writable_roots):
            resolved = normalized_path(root)
            if resolved not in roots:
                roots.append(resolved)
        object.__setattr__(self, "cwd", cwd)
        object.__setattr__(
            self,
            "temporary_roots",
            tuple(normalized_path(root) for root in self.temporary_roots),
        )
        object.__setattr__(self, "writable_roots", tuple(roots))

    def allows_write(self, path: Path) -> bool:
        resolved = normalized_path(path)
        for root in self.writable_roots:
            try:
                resolved.relative_to(root)
                return True
            except ValueError:
                continue
        return False


@dataclass(frozen=True)
class ProcessLaunchOptions:
    start_new_session: bool = True
    pass_fds: tuple[int, ...] = ()
    creationflags: int = 0


class Closeable(Protocol):
    def close(self) -> object: ...


class CleanupResource:
    def __init__(self, cleanup: Callable[[], object]) -> None:
        self.cleanup = cleanup
        self._closed = False

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self.cleanup()


class PreparedProcess:
    def __init__(
        self,
        args: list[str],
        seccomp_available: bool | None = None,
        seccomp_file: BinaryIO | None = None,
        *,
        launch_options: ProcessLaunchOptions | None = None,
        capabilities: Iterable[str] = (),
        resources: Iterable[Closeable] = (),
        status: SandboxStatus | None = None,
        metadata: Mapping[str, object] | None = None,
    ) -> None:
        resolved_capabilities = set(capabilities)
        if seccomp_available is True:
            resolved_capabilities.add("seccomp")
        if seccomp_available is False:
            resolved_capabilities.discard("seccomp")
        if seccomp_available is None and seccomp_file is not None:
            resolved_capabilities.add("seccomp")
        resolved_resources = list(resources)
        if seccomp_file is not None and all(
            resource is not seccomp_file for resource in resolved_resources
        ):
            resolved_resources.append(seccomp_file)
        options = launch_options or ProcessLaunchOptions()
        if seccomp_file is not None and seccomp_file.fileno() not in options.pass_fds:
            options = replace(
                options,
                pass_fds=(*options.pass_fds, seccomp_file.fileno()),
            )
        self.args = list(args)
        self.launch_options = options
        self.capabilities = frozenset(resolved_capabilities)
        self.resources = tuple(resolved_resources)
        self.status = status
        self.metadata = dict(metadata or {})
        self.seccomp_available = "seccomp" in self.capabilities
        self.seccomp_file = seccomp_file
        self._closed = False

    @property
    def pass_fds(self) -> tuple[int, ...]:
        return self.launch_options.pass_fds

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        for resource in reversed(self.resources):
            with suppress(Exception):
                resource.close()

    def __enter__(self) -> PreparedProcess:
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.close()


class SandboxCommand(PreparedProcess):
    pass


class SandboxBackend(ABC):
    name: str

    @abstractmethod
    def status(self) -> SandboxStatus:
        raise NotImplementedError

    @abstractmethod
    def prepare(
        self,
        command: list[str],
        policy: SandboxPolicy,
        *,
        include_seccomp: bool = True,
    ) -> PreparedProcess:
        raise NotImplementedError

    def classify_result(
        self,
        exit_code: int,
        stderr: str,
    ) -> SandboxFailure | None:
        if exit_code == 0:
            return None
        return SandboxFailure(
            kind=SandboxFailureKind.COMMAND_FAILED,
            message="Command failed.",
            backend=self.name,
            details=(("exit_code", str(exit_code)),),
        )

    def classify_prepared_result(
        self,
        exit_code: int,
        stderr: str,
        metadata: Mapping[str, object],
    ) -> SandboxFailure | None:
        return self.classify_result(exit_code, stderr)


class UnavailableSandboxBackend(SandboxBackend):
    def __init__(self, name: str, reason: str = "unsupported_platform") -> None:
        self.name = name
        self.reason = reason

    def status(self) -> SandboxStatus:
        failure = SandboxFailure(
            kind=SandboxFailureKind.BACKEND_UNAVAILABLE,
            message="Command protection is unavailable on this system.",
            backend=self.name,
            details=(("reason", self.reason),),
        )
        return SandboxStatus(
            backend=self.name,
            state=(
                SandboxState.SETUP_REQUIRED
                if self.reason == "setup_required"
                else SandboxState.UNAVAILABLE
            ),
            failure=failure,
        )

    def prepare(
        self,
        command: list[str],
        policy: SandboxPolicy,
        *,
        include_seccomp: bool = True,
    ) -> PreparedProcess:
        status = self.status()
        raise SandboxError(failure=status.failure)
