from __future__ import annotations

import json
import socket
import subprocess
import tempfile
from collections.abc import Callable
from pathlib import Path

from flowent.runtime_commands import python_runner_command
from flowent.sandboxing.core import (
    PreparedProcess,
    ProcessLaunchOptions,
    SandboxBackend,
    SandboxError,
    SandboxFailure,
    SandboxFailureKind,
    SandboxPolicy,
    SandboxState,
    SandboxStatus,
)
from flowent.sandboxing.environment import build_shell_environment

SEATBELT_EXECUTABLE = Path("/usr/bin/sandbox-exec")
SEATBELT_CAPABILITY_CACHE: dict[str, bool] = {}
SEATBELT_UNAVAILABLE_MESSAGE = "Command protection is unavailable on this macOS system."
SEATBELT_BASE_PROFILE = """(version 1)
(deny default)
(allow process-exec)
(allow process-fork)
(allow signal (target same-sandbox))
(allow process-info* (target same-sandbox))
(allow file-write-data
  (require-all
    (path "/dev/null")
    (vnode-type CHARACTER-DEVICE)))
(allow sysctl-read
  (sysctl-name "hw.activecpu")
  (sysctl-name "hw.busfrequency_compat")
  (sysctl-name "hw.byteorder")
  (sysctl-name "hw.cacheconfig")
  (sysctl-name "hw.cachelinesize_compat")
  (sysctl-name "hw.cpufamily")
  (sysctl-name "hw.cpufrequency_compat")
  (sysctl-name "hw.cputype")
  (sysctl-name "hw.l1dcachesize_compat")
  (sysctl-name "hw.l1icachesize_compat")
  (sysctl-name "hw.l2cachesize_compat")
  (sysctl-name "hw.l3cachesize_compat")
  (sysctl-name "hw.logicalcpu_max")
  (sysctl-name "hw.machine")
  (sysctl-name "hw.model")
  (sysctl-name "hw.memsize")
  (sysctl-name "hw.ncpu")
  (sysctl-name "hw.nperflevels")
  (sysctl-name-prefix "hw.optional.arm.")
  (sysctl-name-prefix "hw.optional.armv8_")
  (sysctl-name "hw.packages")
  (sysctl-name "hw.pagesize_compat")
  (sysctl-name "hw.pagesize")
  (sysctl-name "hw.physicalcpu")
  (sysctl-name "hw.physicalcpu_max")
  (sysctl-name "hw.logicalcpu")
  (sysctl-name "hw.cpufrequency")
  (sysctl-name "hw.tbfrequency_compat")
  (sysctl-name "hw.vectorunit")
  (sysctl-name "machdep.cpu.brand_string")
  (sysctl-name "kern.argmax")
  (sysctl-name "kern.hostname")
  (sysctl-name "kern.maxfilesperproc")
  (sysctl-name "kern.maxproc")
  (sysctl-name "kern.osproductversion")
  (sysctl-name "kern.osrelease")
  (sysctl-name "kern.ostype")
  (sysctl-name "kern.osvariant_status")
  (sysctl-name "kern.osversion")
  (sysctl-name "kern.secure_kernel")
  (sysctl-name "kern.usrstack64")
  (sysctl-name "kern.version")
  (sysctl-name "sysctl.proc_cputype")
  (sysctl-name "vm.loadavg")
  (sysctl-name-prefix "hw.perflevel")
  (sysctl-name-prefix "kern.proc.pgrp.")
  (sysctl-name-prefix "kern.proc.pid.")
  (sysctl-name-prefix "net.routetable."))
(allow sysctl-write
  (sysctl-name "kern.grade_cputype"))
(allow iokit-open
  (iokit-registry-entry-class "RootDomainUserClient"))
(allow mach-lookup
  (global-name "com.apple.system.opendirectoryd.libinfo"))
(allow ipc-posix-sem)
(allow mach-lookup
  (global-name "com.apple.PowerManagement.control"))
(allow pseudo-tty)
(allow file-read* file-write* file-ioctl (literal "/dev/ptmx"))
(allow file-read* file-write*
  (require-all
    (regex #"^/dev/ttys[0-9]+")
    (extension "com.apple.sandbox.pty")))
(allow file-ioctl (regex #"^/dev/ttys[0-9]+"))
(allow file-read*)"""
SEATBELT_NETWORK_PROFILE = """(allow network*)
(allow system-socket
  (require-all
    (socket-domain AF_SYSTEM)
    (socket-protocol 2)))
(allow mach-lookup
  (global-name "com.apple.bsd.dirhelper")
  (global-name "com.apple.system.opendirectoryd.membership")
  (global-name "com.apple.SecurityServer")
  (global-name "com.apple.networkd")
  (global-name "com.apple.ocspd")
  (global-name "com.apple.trustd.agent")
  (global-name "com.apple.SystemConfiguration.DNSConfiguration")
  (global-name "com.apple.SystemConfiguration.configd"))
(allow sysctl-read
  (sysctl-name-regex #"^net.routetable"))"""

CapabilityProbe = Callable[[Path], bool]
CapabilityCommandRunner = Callable[..., subprocess.CompletedProcess[str]]


def seatbelt_writable_roots(policy: SandboxPolicy) -> tuple[Path, ...]:
    roots = list(policy.writable_roots)
    slash_tmp = Path("/tmp").resolve(strict=False)
    if slash_tmp in policy.temporary_roots:
        darwin_temporary = (
            Path(tempfile.gettempdir()).expanduser().resolve(strict=False)
        )
        if darwin_temporary not in roots:
            roots.append(darwin_temporary)
    return tuple(roots)


def build_seatbelt_profile(
    policy: SandboxPolicy,
    writable_roots: tuple[Path, ...] | None = None,
) -> str:
    roots = (
        writable_roots
        if writable_roots is not None
        else seatbelt_writable_roots(policy)
    )
    rules = [SEATBELT_BASE_PROFILE]
    writable_filters = "\n  ".join(
        f'(subpath (param "WRITE_ROOT_{index}"))' for index in range(len(roots))
    )
    if writable_filters:
        rules.append(f"(allow file-write*\n  {writable_filters}\n)")
    if policy.allow_network:
        rules.append(SEATBELT_NETWORK_PROFILE)
    return "\n".join(rules)


def build_seatbelt_definition_args(
    policy: SandboxPolicy,
    writable_roots: tuple[Path, ...] | None = None,
) -> list[str]:
    roots = (
        writable_roots
        if writable_roots is not None
        else seatbelt_writable_roots(policy)
    )
    return [f"-DWRITE_ROOT_{index}={root}" for index, root in enumerate(roots)]


class SeatbeltCapabilityProbe:
    def __init__(
        self,
        cache: dict[str, bool] | None = None,
        runner: CapabilityCommandRunner | None = None,
    ) -> None:
        self.cache = cache if cache is not None else SEATBELT_CAPABILITY_CACHE
        self.runner = runner or subprocess.run

    def supports(self, executable: Path) -> bool:
        resolved_executable = executable.expanduser().resolve(strict=False)
        cache_key = str(resolved_executable)
        if cache_key in self.cache:
            return self.cache[cache_key]
        supported = self._run_probe(resolved_executable)
        self.cache[cache_key] = supported
        return supported

    def _run_probe(self, executable: Path) -> bool:
        with tempfile.TemporaryDirectory(prefix="flowent-seatbelt-probe-") as directory:
            probe_root = Path(directory)
            allowed_root = probe_root / "allowed"
            denied_root = probe_root / "denied"
            escape_root = allowed_root / "escape"
            allowed_root.mkdir()
            denied_root.mkdir()
            escape_root.symlink_to(denied_root, target_is_directory=True)
            allowed_file = allowed_root / "allowed.txt"
            denied_file = denied_root / "escaped.txt"
            escaped_file = escape_root / "escaped.txt"
            policy = SandboxPolicy(
                cwd=allowed_root,
                temporary_roots=(),
                allow_network=False,
            )
            script = (
                "import os\n"
                "import platform\n"
                "import socket\n"
                "allowed_path, escaped_path, raw_port, expected_network = inputs\n"
                "assert platform.machine()\n"
                "assert os.cpu_count()\n"
                "with open(os.devnull, 'w') as stream:\n"
                "    stream.write('probe')\n"
                "master, slave = os.openpty()\n"
                "os.close(master)\n"
                "os.close(slave)\n"
                "with open(allowed_path, 'w', encoding='utf-8') as stream:\n"
                "    stream.write('allowed')\n"
                "try:\n"
                "    with open(escaped_path, 'w', encoding='utf-8') as stream:\n"
                "        stream.write('escaped')\n"
                "except PermissionError:\n"
                "    pass\n"
                "else:\n"
                "    raise SystemExit(1)\n"
                "connected = False\n"
                "try:\n"
                "    connection = socket.create_connection(('127.0.0.1', int(raw_port)), timeout=1)\n"
                "except OSError:\n"
                "    pass\n"
                "else:\n"
                "    connection.close()\n"
                "    connected = True\n"
                "if connected != (expected_network == 'allow'):\n"
                "    raise SystemExit(1)\n"
            )
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
                listener.bind(("127.0.0.1", 0))
                listener.listen(1)
                port = listener.getsockname()[1]
                denied_result = self._run_probe_command(
                    executable,
                    policy,
                    script,
                    allowed_file,
                    escaped_file,
                    port,
                    allow_network=False,
                )
                allowed_result = self._run_probe_command(
                    executable,
                    policy,
                    script,
                    allowed_file,
                    escaped_file,
                    port,
                    allow_network=True,
                )
            return (
                denied_result.returncode == 0
                and allowed_result.returncode == 0
                and allowed_file.is_file()
                and allowed_file.read_text() == "allowed"
                and not denied_file.exists()
            )

    def _run_probe_command(
        self,
        executable: Path,
        policy: SandboxPolicy,
        script: str,
        allowed_file: Path,
        escaped_file: Path,
        port: int,
        *,
        allow_network: bool,
    ) -> subprocess.CompletedProcess[str]:
        selected_policy = SandboxPolicy(
            cwd=policy.cwd,
            temporary_roots=policy.temporary_roots,
            writable_roots=policy.writable_roots,
            allow_network=allow_network,
        )
        writable_roots = seatbelt_writable_roots(selected_policy)
        args = [
            str(executable),
            "-p",
            build_seatbelt_profile(selected_policy, writable_roots),
            *build_seatbelt_definition_args(selected_policy, writable_roots),
            "--",
            *python_runner_command(),
        ]
        payload = json.dumps(
            {
                "code": script,
                "inputs": [
                    str(allowed_file),
                    str(escaped_file),
                    str(port),
                    "allow" if allow_network else "deny",
                ],
            }
        )
        return self.runner(
            args,
            check=False,
            capture_output=True,
            cwd=policy.cwd,
            env=build_shell_environment(),
            input=payload,
            text=True,
            timeout=5,
        )


def is_policy_denied_output(stderr: str) -> bool:
    normalized = stderr.lower()
    return any(
        marker in normalized
        for marker in (
            "operation not permitted",
            "permission denied",
            "sandbox violation",
        )
    )


class MacOSSandboxBackend(SandboxBackend):
    name = "macos"

    def __init__(
        self,
        *,
        executable: str | Path = SEATBELT_EXECUTABLE,
        capability_probe: CapabilityProbe | None = None,
    ) -> None:
        self.executable = Path(executable).expanduser().resolve(strict=False)
        self.capability_probe = capability_probe or SeatbeltCapabilityProbe().supports

    def _unavailable_status(
        self,
        reason: str,
        error: Exception | None = None,
    ) -> SandboxStatus:
        details = [("reason", reason)]
        if error is not None:
            details.append(("error", type(error).__name__))
        failure = SandboxFailure(
            kind=SandboxFailureKind.BACKEND_UNAVAILABLE,
            message=SEATBELT_UNAVAILABLE_MESSAGE,
            backend=self.name,
            details=tuple(details),
        )
        return SandboxStatus(
            backend=self.name,
            state=SandboxState.UNAVAILABLE,
            executable=self.executable,
            source="system",
            failure=failure,
        )

    def status(self) -> SandboxStatus:
        try:
            supported = self.capability_probe(self.executable)
        except Exception as error:
            return self._unavailable_status("capability_probe_error", error)
        if not supported:
            return self._unavailable_status("capability_probe_failed")
        return SandboxStatus(
            backend=self.name,
            state=SandboxState.AVAILABLE,
            executable=self.executable,
            source="system",
            capabilities=frozenset({"filesystem", "network_policy", "process_tree"}),
        )

    def prepare(
        self,
        command: list[str],
        policy: SandboxPolicy,
        *,
        include_seccomp: bool = True,
    ) -> PreparedProcess:
        status = self.status()
        if not status.available or status.executable is None:
            raise SandboxError(failure=status.failure)
        if not command:
            failure = SandboxFailure(
                kind=SandboxFailureKind.PREPARATION_FAILED,
                message="Command protection requires a command.",
                backend=self.name,
                details=(("reason", "empty_command"),),
            )
            raise SandboxError(failure=failure)
        try:
            writable_roots = seatbelt_writable_roots(policy)
            profile = build_seatbelt_profile(policy, writable_roots)
            definition_args = build_seatbelt_definition_args(
                policy,
                writable_roots,
            )
        except Exception as error:
            failure = SandboxFailure(
                kind=SandboxFailureKind.PREPARATION_FAILED,
                message="Command protection could not prepare the command.",
                backend=self.name,
                details=(
                    ("reason", "profile_generation_failed"),
                    ("error", type(error).__name__),
                ),
            )
            raise SandboxError(failure=failure) from error
        args = [
            str(status.executable),
            "-p",
            profile,
            *definition_args,
            "--",
            *command,
        ]
        return PreparedProcess(
            args,
            launch_options=ProcessLaunchOptions(start_new_session=True),
            capabilities=status.capabilities,
            status=status,
        )

    def classify_result(
        self,
        exit_code: int,
        stderr: str,
    ) -> SandboxFailure | None:
        if exit_code == 0:
            return None
        if stderr.lstrip().startswith("sandbox-exec:"):
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
