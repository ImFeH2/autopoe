from __future__ import annotations

import ctypes
import errno
import io
import os
import subprocess
import tempfile
from collections.abc import Callable, Mapping
from dataclasses import replace
from pathlib import Path
from typing import BinaryIO

from flowent.sandboxing.core import (
    ProcessLaunchOptions,
    SandboxBackend,
    SandboxCommand,
    SandboxError,
    SandboxFailure,
    SandboxFailureKind,
    SandboxPolicy,
    SandboxState,
    SandboxStatus,
)
from flowent.sandboxing.environment import build_shell_environment
from flowent.sandboxing.resources import (
    ExecutableResolver,
    ResolvedExecutable,
    ResourceResolutionError,
    ResourceSource,
    default_bwrap_resolver,
)

SANDBOX_INSTALL_HINT = "Reinstall Flowent with the platform files for this system."
SANDBOX_PROC_MOUNT_SUPPORT: dict[str, bool] = {}
SCMP_ACT_ALLOW = 0x7FFF0000
SCMP_ACT_ERRNO = 0x00050000

ResolvedExecutableProvider = Callable[
    [], ResolvedExecutable | tuple[ResolvedExecutable, ...] | None
]
ProcMountSupport = Callable[[Path], bool]
SeccompExporter = Callable[[], BinaryIO | None]
EnvironmentBuilder = Callable[[Mapping[str, str] | None], dict[str, str]]


def is_proc_mount_failure(stderr: str) -> bool:
    return (
        "Can't mount proc" in stderr
        and "/newroot/proc" in stderr
        and (
            "Invalid argument" in stderr
            or "Operation not permitted" in stderr
            or "Permission denied" in stderr
        )
    )


def true_command() -> str:
    for candidate in ("/usr/bin/true", "/bin/true"):
        if Path(candidate).exists():
            return candidate
    return "true"


class ProcMountProbe:
    def __init__(self, cache: dict[str, bool] | None = None) -> None:
        self.cache = cache if cache is not None else {}

    def supports(
        self,
        executable: Path,
        environment: Mapping[str, str] | None = None,
    ) -> bool:
        key = str(executable.expanduser().resolve(strict=False))
        if key in self.cache:
            return self.cache[key]
        result = subprocess.run(
            [
                key,
                "--ro-bind",
                "/",
                "/",
                "--dev",
                "/dev",
                "--proc",
                "/proc",
                "--unshare-user",
                "--unshare-pid",
                "--new-session",
                "--die-with-parent",
                "--",
                true_command(),
            ],
            check=False,
            capture_output=True,
            env=dict(environment or build_shell_environment()),
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            supported = True
        elif is_proc_mount_failure(result.stderr):
            supported = False
        else:
            raise OSError("Bubblewrap could not start command protection.")
        self.cache[key] = supported
        return supported


class SeccompFilter:
    def __init__(self, denied_syscalls: list[str] | None = None) -> None:
        self.denied_syscalls = denied_syscalls or [
            "ptrace",
            "io_uring_setup",
            "io_uring_enter",
            "io_uring_register",
        ]

    def export_bpf(self) -> BinaryIO | None:
        try:
            library = ctypes.CDLL("libseccomp.so.2")
        except OSError:
            return None
        library.seccomp_init.argtypes = [ctypes.c_uint32]
        library.seccomp_init.restype = ctypes.c_void_p
        library.seccomp_rule_add.argtypes = [
            ctypes.c_void_p,
            ctypes.c_uint32,
            ctypes.c_int,
            ctypes.c_uint,
        ]
        library.seccomp_rule_add.restype = ctypes.c_int
        library.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
        library.seccomp_syscall_resolve_name.restype = ctypes.c_int
        library.seccomp_export_bpf.argtypes = [ctypes.c_void_p, ctypes.c_int]
        library.seccomp_export_bpf.restype = ctypes.c_int
        library.seccomp_release.argtypes = [ctypes.c_void_p]
        library.seccomp_release.restype = None
        context = library.seccomp_init(SCMP_ACT_ALLOW)
        if not context:
            return None
        try:
            with tempfile.TemporaryFile() as output:
                for syscall in self.denied_syscalls:
                    number = library.seccomp_syscall_resolve_name(syscall.encode())
                    if number < 0:
                        continue
                    action = SCMP_ACT_ERRNO | errno.EPERM
                    if library.seccomp_rule_add(context, action, number, 0) != 0:
                        return None
                if library.seccomp_export_bpf(context, output.fileno()) != 0:
                    return None
                output.seek(0)
                return io.FileIO(os.dup(output.fileno()), mode="r+")
        finally:
            library.seccomp_release(context)


def is_policy_denied_output(stderr: str) -> bool:
    normalized = stderr.lower()
    return any(
        marker in normalized
        for marker in (
            "operation not permitted",
            "permission denied",
            "read-only file system",
            "seccomp",
        )
    )


class LinuxSandboxBackend(SandboxBackend):
    name = "linux"

    def __init__(
        self,
        *,
        resolver: ExecutableResolver | ResolvedExecutableProvider | None = None,
        proc_mount_probe: ProcMountSupport | None = None,
        seccomp_exporter: SeccompExporter | None = None,
        environment_builder: EnvironmentBuilder = build_shell_environment,
    ) -> None:
        self.resolver = resolver or default_bwrap_resolver()
        self.proc_mount_probe = proc_mount_probe
        self.seccomp_exporter = seccomp_exporter or SeccompFilter().export_bpf
        self.environment_builder = environment_builder
        self._default_proc_probe = ProcMountProbe(SANDBOX_PROC_MOUNT_SUPPORT)

    def _resolve_candidates(self) -> tuple[ResolvedExecutable, ...]:
        if isinstance(self.resolver, ExecutableResolver):
            return self.resolver.resolve_candidates()
        resolved = self.resolver()
        if resolved is None:
            return ()
        if isinstance(resolved, tuple):
            return resolved
        return (resolved,)

    def status(self) -> SandboxStatus:
        try:
            candidates = self._resolve_candidates()
        except ResourceResolutionError:
            failure = SandboxFailure(
                kind=SandboxFailureKind.BACKEND_UNAVAILABLE,
                message=f"Sandbox is not available. {SANDBOX_INSTALL_HINT}",
                backend=self.name,
                details=(("reason", "bundled_resource_invalid"),),
            )
            return SandboxStatus(
                backend=self.name,
                state=SandboxState.UNAVAILABLE,
                failure=failure,
            )
        if not candidates:
            failure = SandboxFailure(
                kind=SandboxFailureKind.BACKEND_UNAVAILABLE,
                message=f"Sandbox is not available. {SANDBOX_INSTALL_HINT}",
                backend=self.name,
                details=(("reason", "executable_missing"),),
            )
            return SandboxStatus(
                backend=self.name,
                state=SandboxState.UNAVAILABLE,
                failure=failure,
            )
        for executable in candidates:
            try:
                supports_proc = self._supports_proc_mount(executable.path)
            except (OSError, subprocess.SubprocessError):
                continue
            capabilities = {"filesystem", "network_policy", "process_tree"}
            if supports_proc:
                capabilities.add("proc_mount")
            return SandboxStatus(
                backend=self.name,
                state=SandboxState.AVAILABLE,
                executable=executable.path,
                source=executable.source.value,
                capabilities=frozenset(capabilities),
            )
        failure = SandboxFailure(
            kind=SandboxFailureKind.BACKEND_UNAVAILABLE,
            message="Command protection cannot start on this system.",
            backend=self.name,
            details=(("reason", "capability_probe_failed"),),
        )
        return SandboxStatus(
            backend=self.name,
            state=SandboxState.UNAVAILABLE,
            failure=failure,
        )

    def _supports_proc_mount(self, executable: Path) -> bool:
        if self.proc_mount_probe is not None:
            return self.proc_mount_probe(executable)
        return self._default_proc_probe.supports(
            executable,
            self.environment_builder(None),
        )

    def prepare(
        self,
        command: list[str],
        policy: SandboxPolicy,
        *,
        include_seccomp: bool = True,
    ) -> SandboxCommand:
        status = self.status()
        if not status.available or status.executable is None:
            raise SandboxError(failure=status.failure)
        executable = status.executable
        args = [
            str(executable),
            "--ro-bind",
            "/",
            "/",
            "--dev",
            "/dev",
            "--bind",
            str(policy.cwd),
            str(policy.cwd),
        ]
        supports_proc = "proc_mount" in status.capabilities
        if supports_proc:
            args[6:6] = ["--proc", "/proc"]
        for root in policy.writable_roots:
            if root == policy.cwd or not root.exists():
                continue
            args.extend(["--bind", str(root), str(root)])
        args.extend(["--unshare-user", "--unshare-pid"])
        if not policy.allow_network:
            args.append("--unshare-net")
        args.extend(
            [
                "--new-session",
                "--die-with-parent",
                "--chdir",
                str(policy.cwd),
            ]
        )
        seccomp_file = self.seccomp_exporter() if include_seccomp else None
        capabilities = set(status.capabilities)
        if supports_proc:
            capabilities.add("proc_mount")
        if seccomp_file is not None:
            try:
                capabilities.add("seccomp")
                args.extend(["--seccomp", str(seccomp_file.fileno())])
                args.extend(["--", *command])
                prepared_status = replace(
                    status,
                    capabilities=frozenset(capabilities),
                )
                return SandboxCommand(
                    args,
                    seccomp_available=True,
                    seccomp_file=seccomp_file,
                    capabilities=capabilities,
                    status=prepared_status,
                    launch_options=ProcessLaunchOptions(start_new_session=True),
                )
            except BaseException:
                seccomp_file.close()
                raise
        args.extend(["--", *command])
        prepared_status = replace(status, capabilities=frozenset(capabilities))
        return SandboxCommand(
            args,
            seccomp_available=False,
            capabilities=capabilities,
            status=prepared_status,
            launch_options=ProcessLaunchOptions(start_new_session=True),
        )

    def classify_result(
        self,
        exit_code: int,
        stderr: str,
    ) -> SandboxFailure | None:
        if exit_code == 0:
            return None
        if stderr.lstrip().startswith("bwrap:"):
            kind = SandboxFailureKind.BACKEND_LAUNCH_FAILED
            message = "Command protection could not start the command."
        elif is_policy_denied_output(stderr):
            kind = SandboxFailureKind.POLICY_DENIED
            message = "Command protection denied this operation."
        else:
            kind = SandboxFailureKind.COMMAND_FAILED
            message = "Command failed."
        return SandboxFailure(
            kind=kind,
            message=message,
            backend=self.name,
            details=(("exit_code", str(exit_code)),),
        )


def resolved_system_executable(path: str) -> ResolvedExecutable:
    return ResolvedExecutable(
        path=Path(path).expanduser().resolve(strict=False),
        source=ResourceSource.SYSTEM,
    )
