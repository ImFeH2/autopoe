from __future__ import annotations

import asyncio
import subprocess
import sys
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path

from flowent.sandboxing import (
    CORE_SHELL_ENVIRONMENT_NAMES,
    DEFAULT_POSIX_SHELL_PATH,
    PreparedProcess,
    ResolvedExecutable,
    ResourceResolutionError,
    ResourceSource,
    SandboxBackend,
    SandboxCommand,
    SandboxError,
    SandboxFailure,
    SandboxFailureKind,
    SandboxPolicy,
    SandboxState,
    SandboxStatus,
    UnavailableSandboxBackend,
    WindowsSandboxBackend,
    build_shell_environment,
    default_bwrap_resolver,
    is_core_shell_environment_variable,
)
from flowent.sandboxing.linux import (
    SANDBOX_INSTALL_HINT,
    SANDBOX_PROC_MOUNT_SUPPORT,
    LinuxSandboxBackend,
    ProcMountProbe,
    SeccompFilter,
    is_proc_mount_failure,
    true_command,
)
from flowent.sandboxing.macos import MacOSSandboxBackend
from flowent.sandboxing.process import (
    create_process,
    run_legacy_process,
    run_process,
    terminate_process_tree,
)


@dataclass(frozen=True)
class CommandResult:
    command: str
    exit_code: int
    stderr: str
    stdout: str
    failure: SandboxFailure | None = None


OutputCallback = Callable[[str], Awaitable[None]]
DEFAULT_SHELL_PATH = DEFAULT_POSIX_SHELL_PATH
_DEFAULT_BWRAP_RESOLVER = default_bwrap_resolver()
_PROC_MOUNT_PROBE = ProcMountProbe(SANDBOX_PROC_MOUNT_SUPPORT)


def sandbox_binary() -> str | None:
    try:
        executable = _DEFAULT_BWRAP_RESOLVER.resolve()
    except ResourceResolutionError as error:
        failure = SandboxFailure(
            kind=SandboxFailureKind.BACKEND_UNAVAILABLE,
            message=f"Sandbox is not available. {SANDBOX_INSTALL_HINT}",
            backend="linux",
            details=(("reason", "bundled_resource_invalid"),),
        )
        raise SandboxError(failure=failure) from error
    if executable is None:
        return None
    return str(executable.path)


def ensure_sandbox_available() -> str:
    executable = sandbox_binary()
    if executable is None:
        failure = SandboxFailure(
            kind=SandboxFailureKind.BACKEND_UNAVAILABLE,
            message=f"Sandbox is not available. {SANDBOX_INSTALL_HINT}",
            backend="linux",
            details=(("reason", "executable_missing"),),
        )
        raise SandboxError(failure=failure)
    return executable


def sandbox_supports_proc_mount() -> bool:
    executable = Path(ensure_sandbox_available())
    return _PROC_MOUNT_PROBE.supports(executable, build_shell_environment())


def path_is_within(path: Path, roots: list[Path]) -> bool:
    resolved_path = path.expanduser().resolve(strict=False)
    for root in roots:
        try:
            resolved_path.relative_to(root.expanduser().resolve(strict=False))
            return True
        except ValueError:
            continue
    return False


def _compat_resolve_bwrap() -> tuple[ResolvedExecutable, ...] | None:
    try:
        executable = sandbox_binary()
    except SandboxError as error:
        raise ResourceResolutionError("Bubblewrap could not be resolved.") from error
    if executable is None:
        return None
    resolved_path = Path(executable).expanduser().resolve(strict=False)
    try:
        default_candidates = _DEFAULT_BWRAP_RESOLVER.resolve_candidates()
    except ResourceResolutionError:
        default_candidates = ()
    matching = next(
        (
            candidate
            for candidate in default_candidates
            if candidate.path == resolved_path
        ),
        None,
    )
    if matching is not None:
        return (
            matching,
            *(candidate for candidate in default_candidates if candidate != matching),
        )
    return (
        ResolvedExecutable(
            path=resolved_path,
            source=ResourceSource.SYSTEM,
        ),
    )


def _compat_proc_mount_probe(executable: Path) -> bool:
    try:
        selected = sandbox_binary()
    except SandboxError:
        selected = None
    if selected is not None and Path(selected).resolve(strict=False) == executable:
        return sandbox_supports_proc_mount()
    return _PROC_MOUNT_PROBE.supports(executable, build_shell_environment())


def _default_backend() -> SandboxBackend:
    if sys.platform.startswith("linux"):
        return LinuxSandboxBackend(
            resolver=_compat_resolve_bwrap,
            proc_mount_probe=_compat_proc_mount_probe,
            environment_builder=build_shell_environment,
        )
    if sys.platform == "darwin":
        return MacOSSandboxBackend()
    if sys.platform == "win32":
        return WindowsSandboxBackend()
    return UnavailableSandboxBackend(sys.platform)


class SandboxRunner:
    def __init__(
        self,
        *,
        cwd: Path | None = None,
        timeout_seconds: float = 30,
        output_limit: int = 20000,
        writable_roots: list[Path] | None = None,
        backend: SandboxBackend | None = None,
    ) -> None:
        self.cwd = (cwd or Path.cwd()).resolve(strict=False)
        self.timeout_seconds = timeout_seconds
        self.output_limit = output_limit
        self.extra_writable_roots = [
            root.expanduser().resolve(strict=False) for root in (writable_roots or [])
        ]
        self.backend = backend or _default_backend()
        self.policy = SandboxPolicy(
            cwd=self.cwd,
            writable_roots=tuple(self.extra_writable_roots),
        )

    @property
    def writable_roots(self) -> list[Path]:
        return list(self.policy.writable_roots)

    @property
    def status(self) -> SandboxStatus:
        return self.backend.status()

    def ensure_writable_path(self, path: Path) -> None:
        if not self.policy.allows_write(path):
            raise SandboxError("Path is outside writable locations.")

    def build_command(
        self,
        command: list[str],
        *,
        include_seccomp: bool = True,
    ) -> PreparedProcess:
        return self.backend.prepare(
            command,
            self.policy,
            include_seccomp=include_seccomp,
        )

    def _text_output(self, value: bytes | str | None) -> str:
        if value is None:
            return ""
        if isinstance(value, bytes):
            return value.decode(errors="replace")
        return value

    def _timeout(self, timeout_seconds: float | None) -> float:
        if timeout_seconds is None:
            return self.timeout_seconds
        return timeout_seconds

    def _launch_failure(self, error: OSError) -> SandboxError:
        failure = SandboxFailure(
            kind=SandboxFailureKind.BACKEND_LAUNCH_FAILED,
            message="Command protection could not start the command.",
            backend=self.backend.name,
            details=(("error", type(error).__name__),),
        )
        return SandboxError(failure=failure)

    def _result(
        self,
        command: list[str],
        exit_code: int,
        stderr: str,
        stdout: str,
        *,
        backend: SandboxBackend,
        prepared: PreparedProcess,
    ) -> CommandResult:
        failure = backend.classify_prepared_result(
            exit_code,
            stderr,
            prepared.metadata,
        )
        return CommandResult(
            command=" ".join(command),
            exit_code=exit_code,
            stderr=stderr[: self.output_limit],
            stdout=stdout[: self.output_limit],
            failure=failure,
        )

    def run(
        self,
        command: list[str],
        *,
        env: dict[str, str] | None = None,
        input_text: str | None = None,
        timeout_seconds: float | None = None,
    ) -> CommandResult:
        prepared = self.build_command(command)
        process_env = build_shell_environment(env)
        try:
            try:
                process_runner = (
                    run_legacy_process
                    if isinstance(prepared, SandboxCommand) and prepared.status is None
                    else run_process
                )
                completed = process_runner(
                    prepared.args,
                    cwd=self.cwd,
                    environment=process_env,
                    input_text=input_text,
                    timeout=self._timeout(timeout_seconds),
                    options=prepared.launch_options,
                )
            except subprocess.TimeoutExpired as error:
                failure = SandboxFailure(
                    kind=SandboxFailureKind.TIMEOUT,
                    message="Command timed out.",
                    backend=self.backend.name,
                )
                return CommandResult(
                    command=" ".join(command),
                    exit_code=124,
                    stderr=str(error) or failure.message,
                    stdout=self._text_output(error.stdout)[: self.output_limit],
                    failure=failure,
                )
            except OSError as error:
                raise self._launch_failure(error) from error
            return self._result(
                command,
                completed.returncode,
                self._text_output(completed.stderr),
                self._text_output(completed.stdout),
                backend=self.backend,
                prepared=prepared,
            )
        finally:
            prepared.close()

    async def _read_stream(
        self,
        stream: asyncio.StreamReader | None,
        callback: OutputCallback | None,
    ) -> str:
        if stream is None:
            return ""
        chunks: list[str] = []
        remaining = self.output_limit
        while True:
            chunk = await stream.read(4096)
            if not chunk:
                break
            text = self._text_output(chunk)
            if remaining <= 0:
                continue
            limited = text[:remaining]
            remaining -= len(limited)
            chunks.append(limited)
            if callback is not None and limited:
                await callback(limited)
        return "".join(chunks)

    async def _stop_async_process(
        self,
        process: asyncio.subprocess.Process,
        prepared: PreparedProcess,
        *,
        graceful: bool,
    ) -> None:
        terminate_process_tree(
            process,
            prepared.launch_options,
            force=not graceful,
        )
        if graceful:
            try:
                await asyncio.wait_for(process.wait(), timeout=1)
                return
            except TimeoutError:
                terminate_process_tree(process, prepared.launch_options, force=True)
        await process.wait()

    async def _run_prepared_async(
        self,
        command: list[str],
        prepared: PreparedProcess,
        *,
        env: dict[str, str] | None,
        input_text: str | None,
        on_stderr: OutputCallback | None,
        on_stdout: OutputCallback | None,
        timeout_seconds: float | None,
        backend: SandboxBackend,
    ) -> CommandResult:
        process_env = build_shell_environment(env)
        try:
            process = await create_process(
                prepared.args,
                cwd=self.cwd,
                environment=process_env,
                input_enabled=input_text is not None,
                options=prepared.launch_options,
            )
        except OSError as error:
            raise self._launch_failure(error) from error
        stdout_task = asyncio.create_task(self._read_stream(process.stdout, on_stdout))
        stderr_task = asyncio.create_task(self._read_stream(process.stderr, on_stderr))
        try:
            if input_text is not None and process.stdin is not None:
                process.stdin.write(input_text.encode())
                await process.stdin.drain()
                process.stdin.close()
            await asyncio.wait_for(
                process.wait(),
                timeout=self._timeout(timeout_seconds),
            )
        except TimeoutError:
            await self._stop_async_process(process, prepared, graceful=False)
            stdout, stderr = await asyncio.gather(stdout_task, stderr_task)
            failure = SandboxFailure(
                kind=SandboxFailureKind.TIMEOUT,
                message="Command timed out.",
                backend=backend.name,
            )
            return CommandResult(
                command=" ".join(command),
                exit_code=124,
                stderr=failure.message,
                stdout=stdout,
                failure=failure,
            )
        except asyncio.CancelledError:
            await self._stop_async_process(process, prepared, graceful=True)
            for task in (stdout_task, stderr_task):
                task.cancel()
            await asyncio.gather(stdout_task, stderr_task, return_exceptions=True)
            raise
        except BaseException:
            await self._stop_async_process(process, prepared, graceful=False)
            for task in (stdout_task, stderr_task):
                task.cancel()
            await asyncio.gather(stdout_task, stderr_task, return_exceptions=True)
            raise
        stdout, stderr = await asyncio.gather(stdout_task, stderr_task)
        return self._result(
            command,
            process.returncode or 0,
            stderr,
            stdout,
            backend=backend,
            prepared=prepared,
        )

    async def run_async(
        self,
        command: list[str],
        *,
        env: dict[str, str] | None = None,
        input_text: str | None = None,
        on_stderr: OutputCallback | None = None,
        on_stdout: OutputCallback | None = None,
        timeout_seconds: float | None = None,
    ) -> CommandResult:
        prepared = self.build_command(command)
        try:
            return await self._run_prepared_async(
                command,
                prepared,
                env=env,
                input_text=input_text,
                on_stderr=on_stderr,
                on_stdout=on_stdout,
                timeout_seconds=timeout_seconds,
                backend=self.backend,
            )
        finally:
            prepared.close()


__all__ = [
    "CORE_SHELL_ENVIRONMENT_NAMES",
    "DEFAULT_SHELL_PATH",
    "SANDBOX_INSTALL_HINT",
    "SANDBOX_PROC_MOUNT_SUPPORT",
    "CommandResult",
    "LinuxSandboxBackend",
    "MacOSSandboxBackend",
    "OutputCallback",
    "PreparedProcess",
    "SandboxBackend",
    "SandboxCommand",
    "SandboxError",
    "SandboxFailure",
    "SandboxFailureKind",
    "SandboxPolicy",
    "SandboxRunner",
    "SandboxState",
    "SandboxStatus",
    "SeccompFilter",
    "WindowsSandboxBackend",
    "build_shell_environment",
    "ensure_sandbox_available",
    "is_core_shell_environment_variable",
    "is_proc_mount_failure",
    "path_is_within",
    "sandbox_binary",
    "sandbox_supports_proc_mount",
    "true_command",
]
