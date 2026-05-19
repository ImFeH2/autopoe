from __future__ import annotations

import ctypes
import errno
import os
import shutil
import subprocess
import tempfile
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


SCMP_ACT_ALLOW = 0x7FFF0000
SCMP_ACT_ERRNO = 0x00050000


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
        timeout_seconds: int = 30,
        output_limit: int = 20000,
    ) -> None:
        self.cwd = (cwd or Path.cwd()).resolve(strict=False)
        self.timeout_seconds = timeout_seconds
        self.output_limit = output_limit

    @property
    def writable_roots(self) -> list[Path]:
        return [self.cwd, Path("/tmp")]

    def ensure_writable_path(self, path: Path) -> None:
        if not path_is_within(path, self.writable_roots):
            raise SandboxError("Path is outside writable locations.")

    def build_command(
        self, command: list[str], *, include_seccomp: bool = True
    ) -> SandboxCommand:
        bwrap = shutil.which("bwrap") or shutil.which("bubblewrap")
        if not bwrap:
            raise SandboxError("Sandbox is not available.")

        args = [
            bwrap,
            "--ro-bind",
            "/",
            "/",
            "--dev",
            "/dev",
            "--proc",
            "/proc",
            "--bind",
            str(self.cwd),
            str(self.cwd),
            "--bind",
            "/tmp",
            "/tmp",
        ]
        for protected in [".git", ".codex", ".agents"]:
            path = self.cwd / protected
            if path.exists():
                args.extend(["--ro-bind", str(path), str(path)])
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
        timeout_seconds: int | None = None,
    ) -> CommandResult:
        sandbox_command = self.build_command(command)
        pass_fds: tuple[int, ...] = ()
        if sandbox_command.seccomp_file is not None:
            pass_fds = (sandbox_command.seccomp_file.fileno(),)

        process_env = os.environ.copy()
        if env is not None:
            process_env.update(env)
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
