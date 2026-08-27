from __future__ import annotations

import os
import signal
import stat
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from threading import Lock, Thread
from typing import Any, BinaryIO, Protocol
from uuid import uuid4

import psutil

EXECUTION_ENV = "FLOWENT_EXECUTION_ID"
OWNER_ENV = "FLOWENT_PROCESS_OWNER"


class HostToolError(Exception):
    pass


def marked_processes(key: str, value: str) -> list[psutil.Process]:
    matches: list[psutil.Process] = []
    for process in psutil.process_iter(["pid"]):
        if process.pid == os.getpid():
            continue
        try:
            environment = process.environ()
        except (
            psutil.NoSuchProcess,
            psutil.AccessDenied,
            psutil.ZombieProcess,
            OSError,
        ):
            continue
        if environment.get(key) != value:
            continue
        matches.append(process)
    return matches


def terminate_processes(
    processes: list[psutil.Process],
    timeout: float = 0.4,
) -> None:
    unique = list({process.pid: process for process in processes}.values())
    for process in unique:
        try:
            process.terminate()
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    _, alive = psutil.wait_procs(unique, timeout=timeout / 2)
    for process in alive:
        try:
            process.kill()
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    psutil.wait_procs(alive, timeout=timeout / 2)


def terminate_marked_processes(key: str, value: str) -> None:
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        processes = marked_processes(key, value)
        if not processes:
            return
        terminate_processes(processes)


class ProcessWatcher:
    def __init__(self, owner: str) -> None:
        self._process: subprocess.Popen[bytes] | None = None
        if os.name == "nt":
            return
        if getattr(sys, "frozen", False):
            argv = [sys.executable, "--process-watch", owner]
        else:
            argv = [sys.executable, "-m", "flowent", "--process-watch", owner]
        environment = os.environ.copy()
        environment.pop(EXECUTION_ENV, None)
        environment.pop(OWNER_ENV, None)
        self._process = subprocess.Popen(
            argv,
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            env=environment,
            start_new_session=True,
        )

    def close(self) -> None:
        process = self._process
        if process is None:
            return
        if process.stdin is not None and not process.stdin.closed:
            process.stdin.close()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
        self._process = None


def watch_processes(owner: str, input_stream: BinaryIO) -> None:
    input_stream.read()
    terminate_marked_processes(OWNER_ENV, owner)


class ProcessTree(Protocol):
    def terminate(self) -> None: ...

    def close(self) -> None: ...


class AgentHostTools(Protocol):
    process_owner: str

    @property
    def working_directory(self) -> str: ...

    @property
    def execution_backend(self) -> str: ...

    @property
    def environment_context(self) -> str: ...

    def run(
        self,
        argv: list[str],
        cwd: str | None = None,
        timeout_seconds: int = 60,
    ) -> dict[str, Any]: ...

    def edit(
        self,
        path: str,
        old_text: str,
        new_text: str,
        replace_all: bool = False,
    ) -> dict[str, Any]: ...

    def close(self) -> None: ...


@dataclass(frozen=True)
class ManagedProcess:
    process: subprocess.Popen[bytes]
    execution_id: str
    tree: ProcessTree | None = None


class UnixProcessGroup:
    def __init__(self, process_group_id: int, execution_id: str) -> None:
        self._process_group_id = process_group_id
        self._execution_id = execution_id
        self._lock = Lock()
        self._closed = False

    def terminate(self) -> None:
        with self._lock:
            if self._closed:
                return
            try:
                os.killpg(self._process_group_id, signal.SIGTERM)
            except (ProcessLookupError, PermissionError):
                pass
            else:
                deadline = time.monotonic() + 0.25
                while time.monotonic() < deadline:
                    try:
                        os.killpg(self._process_group_id, 0)
                    except (ProcessLookupError, PermissionError):
                        break
                    time.sleep(0.01)
                try:
                    os.killpg(self._process_group_id, signal.SIGKILL)
                except (ProcessLookupError, PermissionError):
                    pass
            terminate_marked_processes(EXECUTION_ENV, self._execution_id)

    def close(self) -> None:
        self.terminate()
        with self._lock:
            self._closed = True


if os.name == "nt":
    import ctypes
    from ctypes import wintypes

    class _JobObjectBasicLimitInformation(ctypes.Structure):
        _fields_ = [
            ("PerProcessUserTimeLimit", ctypes.c_longlong),
            ("PerJobUserTimeLimit", ctypes.c_longlong),
            ("LimitFlags", wintypes.DWORD),
            ("MinimumWorkingSetSize", ctypes.c_size_t),
            ("MaximumWorkingSetSize", ctypes.c_size_t),
            ("ActiveProcessLimit", wintypes.DWORD),
            ("Affinity", ctypes.c_size_t),
            ("PriorityClass", wintypes.DWORD),
            ("SchedulingClass", wintypes.DWORD),
        ]

    class _IoCounters(ctypes.Structure):
        _fields_ = [
            ("ReadOperationCount", ctypes.c_ulonglong),
            ("WriteOperationCount", ctypes.c_ulonglong),
            ("OtherOperationCount", ctypes.c_ulonglong),
            ("ReadTransferCount", ctypes.c_ulonglong),
            ("WriteTransferCount", ctypes.c_ulonglong),
            ("OtherTransferCount", ctypes.c_ulonglong),
        ]

    class _JobObjectExtendedLimitInformation(ctypes.Structure):
        _fields_ = [
            ("BasicLimitInformation", _JobObjectBasicLimitInformation),
            ("IoInfo", _IoCounters),
            ("ProcessMemoryLimit", ctypes.c_size_t),
            ("JobMemoryLimit", ctypes.c_size_t),
            ("PeakProcessMemoryUsed", ctypes.c_size_t),
            ("PeakJobMemoryUsed", ctypes.c_size_t),
        ]

    _kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    _ntdll = ctypes.WinDLL("ntdll")
    _create_job_object = _kernel32.CreateJobObjectW
    _create_job_object.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
    _create_job_object.restype = wintypes.HANDLE
    _set_job_information = _kernel32.SetInformationJobObject
    _set_job_information.argtypes = [
        wintypes.HANDLE,
        ctypes.c_int,
        ctypes.c_void_p,
        wintypes.DWORD,
    ]
    _set_job_information.restype = wintypes.BOOL
    _assign_process_to_job = _kernel32.AssignProcessToJobObject
    _assign_process_to_job.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    _assign_process_to_job.restype = wintypes.BOOL
    _terminate_job = _kernel32.TerminateJobObject
    _terminate_job.argtypes = [wintypes.HANDLE, wintypes.UINT]
    _terminate_job.restype = wintypes.BOOL
    _close_handle = _kernel32.CloseHandle
    _close_handle.argtypes = [wintypes.HANDLE]
    _close_handle.restype = wintypes.BOOL
    _resume_process = _ntdll.NtResumeProcess
    _resume_process.argtypes = [wintypes.HANDLE]
    _resume_process.restype = ctypes.c_long

    class WindowsJob:
        def __init__(self, process: subprocess.Popen[bytes]) -> None:
            self._lock = Lock()
            handle = _create_job_object(None, None)
            if not handle:
                raise ctypes.WinError(ctypes.get_last_error())
            self._handle: int | None = handle
            information = _JobObjectExtendedLimitInformation()
            information.BasicLimitInformation.LimitFlags = 0x00002000
            if not _set_job_information(
                handle,
                9,
                ctypes.byref(information),
                ctypes.sizeof(information),
            ):
                error = ctypes.WinError(ctypes.get_last_error())
                self.close()
                raise error
            process_handle = wintypes.HANDLE(int(process._handle))
            if not _assign_process_to_job(handle, process_handle):
                error = ctypes.WinError(ctypes.get_last_error())
                self.close()
                raise error
            status = _resume_process(process_handle)
            if status < 0:
                self.terminate()
                self.close()
                raise OSError(f"NtResumeProcess failed with status {status}")

        def terminate(self) -> None:
            with self._lock:
                if self._handle is not None:
                    _terminate_job(self._handle, 1)

        def close(self) -> None:
            with self._lock:
                if self._handle is not None:
                    _close_handle(self._handle)
                    self._handle = None


class BoundedOutput:
    def __init__(self, limit: int) -> None:
        self._head_limit = limit // 2
        self._tail_limit = limit - self._head_limit
        self._head = bytearray()
        self._tail = bytearray()
        self._total = 0

    def add(self, chunk: bytes) -> None:
        self._total += len(chunk)
        head_remaining = self._head_limit - len(self._head)
        if head_remaining > 0:
            self._head.extend(chunk[:head_remaining])
            chunk = chunk[head_remaining:]
        if chunk:
            self._tail.extend(chunk)
            if len(self._tail) > self._tail_limit:
                del self._tail[: len(self._tail) - self._tail_limit]

    def render(self) -> tuple[str, bool]:
        truncated = self._total > self._head_limit + self._tail_limit
        if truncated:
            omitted = self._total - len(self._head) - len(self._tail)
            data = (
                self._head
                + f"\n... {omitted} bytes omitted ...\n".encode()
                + self._tail
            )
        else:
            data = self._head + self._tail
        return data.decode("utf-8", errors="replace"), truncated


class HostTools:
    def __init__(
        self,
        root: Path,
        output_limit: int = 65_536,
        process_owner: str | None = None,
    ) -> None:
        if output_limit < 2:
            raise ValueError("output_limit must be at least 2")
        self.root = root.resolve()
        self.process_owner = process_owner or uuid4().hex
        self._output_limit = output_limit
        self._lock = Lock()
        self._edit_lock = Lock()
        self._processes: dict[int, ManagedProcess] = {}
        self._closed = False

    @property
    def working_directory(self) -> str:
        return str(self.root)

    @property
    def execution_backend(self) -> str:
        return "native"

    @property
    def environment_context(self) -> str:
        system = "Windows" if os.name == "nt" else "Unix"
        return (
            "<host_environment>\n"
            f"Your command and file environment is native {system}.\n"
            f"The default working directory is {self.root}.\n"
            "Prefer absolute paths. Huddol service tools such as discussion, memory, todo, "
            "history, and web_search are not filesystem commands.\n"
            "</host_environment>"
        )

    def run(
        self,
        argv: list[str],
        cwd: str | None = None,
        timeout_seconds: int = 60,
    ) -> dict[str, Any]:
        self._validate_argv(argv)
        if type(timeout_seconds) is not int or not 1 <= timeout_seconds <= 300:
            raise HostToolError("timeout_seconds must be an integer between 1 and 300")
        if cwd is not None and not isinstance(cwd, str):
            raise HostToolError("cwd must be a string")
        if cwd is not None:
            self._require_utf8(cwd, "cwd")
        working_directory = self._resolve_directory(cwd)
        started = time.monotonic()

        managed = self._start_process(
            argv,
            cwd=working_directory,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            error_prefix="Cannot start command",
        )
        process = managed.process
        stdout = BoundedOutput(self._output_limit)
        stderr = BoundedOutput(self._output_limit)
        readers = [
            Thread(target=self._drain, args=(process.stdout, stdout), daemon=True),
            Thread(target=self._drain, args=(process.stderr, stderr), daemon=True),
        ]
        for reader in readers:
            reader.start()

        timed_out = False
        try:
            process.wait(timeout=timeout_seconds)
        except subprocess.TimeoutExpired:
            timed_out = True
            self._terminate(managed)
        finally:
            self._close_tree(managed)
            for reader in readers:
                reader.join(timeout=5)
            stopped = self._unregister(managed)

        if stopped:
            raise HostToolError("Host tools are stopped")
        stdout_text, stdout_truncated = stdout.render()
        stderr_text, stderr_truncated = stderr.render()
        return {
            "argv": argv,
            "cwd": self._display_path(working_directory),
            "exit_code": process.returncode,
            "timed_out": timed_out,
            "duration_ms": round((time.monotonic() - started) * 1000),
            "stdout": stdout_text,
            "stderr": stderr_text,
            "stdout_truncated": stdout_truncated,
            "stderr_truncated": stderr_truncated,
        }

    def edit(
        self,
        path: str,
        old_text: str,
        new_text: str,
        replace_all: bool = False,
    ) -> dict[str, Any]:
        if not isinstance(old_text, str):
            raise HostToolError("old_text must be a string")
        if not isinstance(new_text, str):
            raise HostToolError("new_text must be a string")
        if type(replace_all) is not bool:
            raise HostToolError("replace_all must be a boolean")
        self._require_utf8(old_text, "old_text")
        self._require_utf8(new_text, "new_text")
        if not old_text:
            raise HostToolError("old_text is required")
        if old_text == new_text:
            raise HostToolError("old_text and new_text must differ")

        with self._edit_lock:
            self._require_open()
            target = self._resolve_edit_path(path)
            original = self._read_edit(target)
            match_count = original.count(old_text)
            if match_count == 0:
                raise HostToolError("old_text was not found in the file")
            if match_count > 1 and not replace_all:
                raise HostToolError(
                    f"old_text must match exactly once; found {match_count} matches"
                )
            replacement_count = match_count if replace_all else 1
            updated = original.replace(
                old_text,
                new_text,
                -1 if replace_all else 1,
            )
            self._write_edit(target, updated.encode("utf-8"))
            return {
                "edited": True,
                "path": self._display_path(target),
                "replacement_count": replacement_count,
            }

    def close(self) -> None:
        with self._lock:
            if self._closed:
                return
            self._closed = True
            processes = list(self._processes.values())
        cleanup_threads = [
            Thread(target=self._terminate, args=(managed,), daemon=True)
            for managed in processes
        ]
        for cleanup in cleanup_threads:
            cleanup.start()
        cleanup_deadline = time.monotonic() + 6
        for cleanup in cleanup_threads:
            cleanup.join(timeout=max(0, cleanup_deadline - time.monotonic()))
        with self._edit_lock:
            pass
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            with self._lock:
                if not self._processes:
                    return
            time.sleep(0.01)

    def _resolve_directory(self, cwd: str | None) -> Path:
        candidate = Path(cwd or ".")
        if not candidate.is_absolute():
            candidate = self.root / candidate
        try:
            resolved = candidate.resolve()
        except (OSError, RuntimeError, ValueError) as error:
            raise HostToolError(f"Cannot resolve cwd: {error}") from error
        if not resolved.is_dir():
            raise HostToolError("cwd must identify an existing directory")
        return resolved

    def _resolve_edit_path(self, path: str) -> Path:
        if not isinstance(path, str):
            raise HostToolError("path must be a string")
        self._require_utf8(path, "path")
        if not path:
            raise HostToolError("path is required")
        candidate = Path(path)
        if not candidate.is_absolute():
            candidate = self.root / candidate
        try:
            resolved = candidate.resolve()
        except (OSError, RuntimeError, ValueError) as error:
            raise HostToolError(f"Cannot resolve edit path: {error}") from error
        if not resolved.is_file():
            raise HostToolError("Edit path must identify an existing file")
        return resolved

    def _display_path(self, path: Path) -> str:
        try:
            return str(path.relative_to(self.root))
        except ValueError:
            return str(path)

    @staticmethod
    def _read_edit(path: Path) -> str:
        try:
            content = path.read_bytes()
        except OSError as error:
            raise HostToolError(f"Cannot read edit file: {error}") from error
        try:
            return content.decode("utf-8")
        except UnicodeDecodeError as error:
            raise HostToolError("Edit path must identify a UTF-8 text file") from error

    @staticmethod
    def _write_edit(path: Path, content: bytes) -> None:
        descriptor: int | None = None
        temporary_path: Path | None = None
        try:
            mode = stat.S_IMODE(path.stat().st_mode)
            descriptor, temporary_name = tempfile.mkstemp(
                prefix=f".{path.name}.flowent-",
                dir=path.parent,
            )
            temporary_path = Path(temporary_name)
            file = os.fdopen(descriptor, "wb")
            descriptor = None
            with file:
                file.write(content)
                file.flush()
                os.fsync(file.fileno())
            temporary_path.chmod(mode)
            os.replace(temporary_path, path)
        except OSError as error:
            raise HostToolError(f"Cannot write edit file: {error}") from error
        finally:
            if descriptor is not None:
                os.close(descriptor)
            if temporary_path is not None:
                try:
                    temporary_path.unlink(missing_ok=True)
                except OSError:
                    pass

    def _validate_argv(self, argv: list[str]) -> None:
        if not isinstance(argv, list) or not argv or len(argv) > 128:
            raise HostToolError("argv must contain between 1 and 128 items")
        if any(not isinstance(item, str) or not item or "\0" in item for item in argv):
            raise HostToolError("argv items must be non-empty strings")
        for item in argv:
            self._require_utf8(item, "argv items")

    @staticmethod
    def _require_utf8(value: str, field: str) -> None:
        try:
            value.encode("utf-8")
        except UnicodeEncodeError as error:
            raise HostToolError(f"{field} must be valid UTF-8") from error

    def _require_open(self) -> None:
        with self._lock:
            if self._closed:
                raise HostToolError("Host tools are stopped")

    def _start_process(
        self,
        argv: list[str],
        *,
        cwd: Path,
        stdin: Any,
        stdout: Any,
        stderr: Any,
        error_prefix: str,
        env: dict[str, str] | None = None,
    ) -> ManagedProcess:
        with self._lock:
            if self._closed:
                raise HostToolError("Host tools are stopped")
            execution_id = uuid4().hex
            environment = (env or os.environ).copy()
            environment[EXECUTION_ENV] = execution_id
            environment[OWNER_ENV] = self.process_owner
            creationflags = 0x00000204 if os.name == "nt" else 0
            try:
                process = subprocess.Popen(
                    argv,
                    cwd=cwd,
                    env=environment,
                    stdin=stdin,
                    stdout=stdout,
                    stderr=stderr,
                    start_new_session=os.name != "nt",
                    creationflags=creationflags,
                )
                tree: ProcessTree = (
                    WindowsJob(process)
                    if os.name == "nt"
                    else UnixProcessGroup(process.pid, execution_id)
                )
            except (
                FileNotFoundError,
                NotADirectoryError,
                PermissionError,
                OSError,
            ) as error:
                if "process" in locals():
                    process.kill()
                    process.wait()
                    self._close_process_streams(process)
                raise HostToolError(f"{error_prefix}: {error}") from error
            managed = ManagedProcess(
                process=process,
                execution_id=execution_id,
                tree=tree,
            )
            self._processes[process.pid] = managed
            return managed

    def _terminate(self, managed: ManagedProcess) -> None:
        process = managed.process
        known_processes = marked_processes(EXECUTION_ENV, managed.execution_id)
        try:
            if managed.tree is not None:
                managed.tree.terminate()
            elif process.poll() is None:
                process.kill()
            try:
                process.wait(timeout=1)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        finally:
            terminate_processes(known_processes, timeout=2)
            terminate_marked_processes(EXECUTION_ENV, managed.execution_id)
            self._close_tree(managed)

    @staticmethod
    def _close_tree(managed: ManagedProcess) -> None:
        if managed.tree is not None:
            managed.tree.close()

    def _unregister(self, managed: ManagedProcess) -> bool:
        with self._lock:
            self._processes.pop(managed.process.pid, None)
            return self._closed

    @staticmethod
    def _close_process_streams(process: subprocess.Popen[bytes]) -> None:
        for stream in (process.stdin, process.stdout, process.stderr):
            if stream is not None:
                stream.close()

    @staticmethod
    def _drain(stream: BinaryIO | None, output: BoundedOutput) -> None:
        if stream is None:
            return
        with stream:
            while chunk := stream.read(8192):
                output.add(chunk)
