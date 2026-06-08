from __future__ import annotations

import asyncio
import ctypes
import errno
import os
import shutil
import signal
import subprocess
import tempfile
from collections.abc import Mapping
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO


@dataclass(frozen=True)
class CommandResult:
    command: str
    exit_code: int
    stderr: str
    stdout: str


@dataclass(frozen=True)
class SandboxCommand:
    args: list[str]
    seccomp_available: bool
    seccomp_file: BinaryIO | None = None


class SandboxError(RuntimeError):
    pass


SANDBOX_INSTALL_HINT = (
    "Install bubblewrap and try again. Debian/Ubuntu: "
    "sudo apt-get install bubblewrap. Fedora: sudo dnf install bubblewrap. "
    "Arch: sudo pacman -S bubblewrap."
)

DEFAULT_SHELL_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
CORE_SHELL_ENVIRONMENT_NAMES = {
    "HOME",
    "LOGNAME",
    "PATH",
    "SHELL",
    "USER",
    "USERNAME",
    "TMPDIR",
    "TEMP",
    "TMP",
    "LANG",
}
SANDBOX_PROC_MOUNT_SUPPORT: dict[str, bool] = {}

SCMP_ACT_ALLOW = 0x7FFF0000
SCMP_ACT_ERRNO = 0x00050000


def is_core_shell_environment_variable(name: str) -> bool:
    return name in CORE_SHELL_ENVIRONMENT_NAMES or name.startswith("LC_")


def build_shell_environment(
    overrides: Mapping[str, str] | None = None,
) -> dict[str, str]:
    environment = {
        name: value
        for name, value in os.environ.items()
        if is_core_shell_environment_variable(name)
    }
    if not environment.get("PATH"):
        environment["PATH"] = DEFAULT_SHELL_PATH
    if overrides is not None:
        environment.update(overrides)
    return environment


def sandbox_binary() -> str | None:
    return shutil.which("bwrap") or shutil.which("bubblewrap")


def ensure_sandbox_available() -> str:
    bwrap = sandbox_binary()
    if not bwrap:
        raise SandboxError(f"Sandbox is not available. {SANDBOX_INSTALL_HINT}")
    return bwrap


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
    for candidate in ["/usr/bin/true", "/bin/true"]:
        if Path(candidate).exists():
            return candidate
    return "true"


def sandbox_supports_proc_mount() -> bool:
    bwrap = ensure_sandbox_available()
    if bwrap in SANDBOX_PROC_MOUNT_SUPPORT:
        return SANDBOX_PROC_MOUNT_SUPPORT[bwrap]

    result = subprocess.run(
        [
            bwrap,
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
        env=build_shell_environment(),
        text=True,
        timeout=5,
    )
    supported = not is_proc_mount_failure(result.stderr)
    SANDBOX_PROC_MOUNT_SUPPORT[bwrap] = supported
    return supported


def path_is_within(path: Path, roots: list[Path]) -> bool:
    resolved_path = path.expanduser().resolve(strict=False)
    for root in roots:
        try:
            resolved_path.relative_to(root.expanduser().resolve(strict=False))
            return True
        except ValueError:
            continue
    return False


class SeccompFilter:
    def __init__(self, denied_syscalls: list[str] | None = None) -> None:
        self.denied_syscalls = denied_syscalls or [
            "ptrace",
            "io_uring_setup",
            "io_uring_enter",
            "io_uring_register",
        ]

    # ruff: noqa: SIM115
    def export_bpf(self) -> BinaryIO | None:
        try:
            lib = ctypes.CDLL("libseccomp.so.2")
        except OSError:
            return None

        lib.seccomp_init.argtypes = [ctypes.c_uint32]
        lib.seccomp_init.restype = ctypes.c_void_p
        lib.seccomp_rule_add.argtypes = [
            ctypes.c_void_p,
            ctypes.c_uint32,
            ctypes.c_int,
            ctypes.c_uint,
        ]
        lib.seccomp_rule_add.restype = ctypes.c_int
        lib.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
        lib.seccomp_syscall_resolve_name.restype = ctypes.c_int
        lib.seccomp_export_bpf.argtypes = [ctypes.c_void_p, ctypes.c_int]
        lib.seccomp_export_bpf.restype = ctypes.c_int
        lib.seccomp_release.argtypes = [ctypes.c_void_p]
        lib.seccomp_release.restype = None

        ctx = lib.seccomp_init(SCMP_ACT_ALLOW)
        if not ctx:
            return None

        output = tempfile.TemporaryFile()
        try:
            for syscall in self.denied_syscalls:
                number = lib.seccomp_syscall_resolve_name(syscall.encode())
                if number < 0:
                    continue
                action = SCMP_ACT_ERRNO | errno.EPERM
                if lib.seccomp_rule_add(ctx, action, number, 0) != 0:
                    return None
            if lib.seccomp_export_bpf(ctx, output.fileno()) != 0:
                return None
            output.seek(0)
            return output
        finally:
            lib.seccomp_release(ctx)


class SandboxRunner:
    def _text_output(self, value: bytes | str | None) -> str:
        if value is None:
            return ""
        if isinstance(value, bytes):
            return value.decode(errors="replace")
        return value

    def __init__(
        self,
        *,
        cwd: Path | None = None,
        timeout_seconds: float = 30,
        output_limit: int = 20000,
        writable_roots: list[Path] | None = None,
    ) -> None:
        self.cwd = (cwd or Path.cwd()).resolve(strict=False)
        self.timeout_seconds = timeout_seconds
        self.output_limit = output_limit
        self.extra_writable_roots = [
            root.expanduser().resolve(strict=False) for root in (writable_roots or [])
        ]

    @property
    def writable_roots(self) -> list[Path]:
        roots: list[Path] = [self.cwd, Path("/tmp")]
        for root in self.extra_writable_roots:
            if not any(root == existing for existing in roots):
                roots.append(root)
        return roots

    def ensure_writable_path(self, path: Path) -> None:
        if not path_is_within(path, self.writable_roots):
            raise SandboxError("Path is outside writable locations.")

    def build_command(
        self, command: list[str], *, include_seccomp: bool = True
    ) -> SandboxCommand:
        bwrap = ensure_sandbox_available()

        args = [
            bwrap,
            "--ro-bind",
            "/",
            "/",
            "--dev",
            "/dev",
            "--bind",
            str(self.cwd),
            str(self.cwd),
        ]
        if sandbox_supports_proc_mount():
            args[6:6] = ["--proc", "/proc"]
        for root in self.writable_roots:
            if root == self.cwd:
                continue
            if not root.exists():
                continue
            args.extend(["--bind", str(root), str(root)])
        args.extend(
            [
                "--unshare-user",
                "--unshare-pid",
                "--new-session",
                "--die-with-parent",
                "--chdir",
                str(self.cwd),
            ]
        )
        seccomp_file = SeccompFilter().export_bpf() if include_seccomp else None
        if seccomp_file is not None:
            args.extend(["--seccomp", str(seccomp_file.fileno())])
        args.extend(["--", *command])
        return SandboxCommand(
            args=args,
            seccomp_available=seccomp_file is not None,
            seccomp_file=seccomp_file,
        )

    def run(
        self,
        command: list[str],
        *,
        env: dict[str, str] | None = None,
        input_text: str | None = None,
        timeout_seconds: float | None = None,
    ) -> CommandResult:
        sandbox_command = self.build_command(command)
        pass_fds: tuple[int, ...] = ()
        if sandbox_command.seccomp_file is not None:
            pass_fds = (sandbox_command.seccomp_file.fileno(),)

        process_env = build_shell_environment(env)
        try:
            completed = subprocess.run(
                sandbox_command.args,
                check=False,
                cwd=self.cwd,
                env=process_env,
                input=input_text,
                pass_fds=pass_fds,
                capture_output=True,
                text=True,
                timeout=timeout_seconds or self.timeout_seconds,
            )
        except subprocess.TimeoutExpired as error:
            return CommandResult(
                command=" ".join(command),
                exit_code=124,
                stderr=str(error),
                stdout=self._text_output(error.stdout)[: self.output_limit],
            )
        finally:
            if sandbox_command.seccomp_file is not None:
                sandbox_command.seccomp_file.close()

        return CommandResult(
            command=" ".join(command),
            exit_code=completed.returncode,
            stderr=completed.stderr[: self.output_limit],
            stdout=completed.stdout[: self.output_limit],
        )

    async def run_unsandboxed_async(
        self,
        command: list[str],
        *,
        env: dict[str, str] | None = None,
        input_text: str | None = None,
        timeout_seconds: float | None = None,
    ) -> CommandResult:
        process_env = build_shell_environment(env)
        process = await asyncio.create_subprocess_exec(
            *command,
            cwd=self.cwd,
            env=process_env,
            start_new_session=True,
            stdin=asyncio.subprocess.PIPE if input_text is not None else None,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(
                process.communicate(
                    input_text.encode() if input_text is not None else None
                ),
                timeout=timeout_seconds or self.timeout_seconds,
            )
        except TimeoutError as error:
            with suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGKILL)
            stdout, stderr = await process.communicate()
            return CommandResult(
                command=" ".join(command),
                exit_code=124,
                stderr=str(error) or "Command timed out.",
                stdout=self._text_output(stdout)[: self.output_limit],
            )
        except asyncio.CancelledError:
            with suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGTERM)
            try:
                await asyncio.wait_for(process.wait(), timeout=1)
            except TimeoutError:
                with suppress(ProcessLookupError):
                    os.killpg(process.pid, signal.SIGKILL)
                await process.wait()
            raise

        return CommandResult(
            command=" ".join(command),
            exit_code=process.returncode or 0,
            stderr=self._text_output(stderr)[: self.output_limit],
            stdout=self._text_output(stdout)[: self.output_limit],
        )

    async def run_async(
        self,
        command: list[str],
        *,
        env: dict[str, str] | None = None,
        input_text: str | None = None,
        timeout_seconds: float | None = None,
    ) -> CommandResult:
        sandbox_command = self.build_command(command)
        pass_fds: tuple[int, ...] = ()
        if sandbox_command.seccomp_file is not None:
            pass_fds = (sandbox_command.seccomp_file.fileno(),)

        process_env = build_shell_environment(env)
        process = await asyncio.create_subprocess_exec(
            *sandbox_command.args,
            cwd=self.cwd,
            env=process_env,
            pass_fds=pass_fds,
            start_new_session=True,
            stdin=asyncio.subprocess.PIPE if input_text is not None else None,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(
                process.communicate(
                    input_text.encode() if input_text is not None else None
                ),
                timeout=timeout_seconds or self.timeout_seconds,
            )
        except TimeoutError as error:
            with suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGKILL)
            stdout, stderr = await process.communicate()
            return CommandResult(
                command=" ".join(command),
                exit_code=124,
                stderr=str(error) or "Command timed out.",
                stdout=self._text_output(stdout)[: self.output_limit],
            )
        except asyncio.CancelledError:
            with suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGTERM)
            try:
                await asyncio.wait_for(process.wait(), timeout=1)
            except TimeoutError:
                with suppress(ProcessLookupError):
                    os.killpg(process.pid, signal.SIGKILL)
                await process.wait()
            raise
        finally:
            if sandbox_command.seccomp_file is not None:
                sandbox_command.seccomp_file.close()

        return CommandResult(
            command=" ".join(command),
            exit_code=process.returncode or 0,
            stderr=self._text_output(stderr)[: self.output_limit],
            stdout=self._text_output(stdout)[: self.output_limit],
        )
