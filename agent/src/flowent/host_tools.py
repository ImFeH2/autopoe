from __future__ import annotations

import codecs
import os
import signal
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from threading import Lock, Thread
from typing import Any, BinaryIO, Protocol
from uuid import uuid4

import psutil

EXECUTION_ENV = "FLOWENT_EXECUTION_ID"
OWNER_ENV = "FLOWENT_PROCESS_OWNER"
PROTECTED_PATCH_ENV = "FLOWENT_PROTECTED_PATCH"


class HostToolError(Exception):
    pass


def marked_processes(
    key: str,
    value: str,
    *,
    protected: bool | None = None,
) -> list[psutil.Process]:
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
        is_protected = environment.get(PROTECTED_PATCH_ENV) == "1"
        if protected is None or protected == is_protected:
            matches.append(process)
    return matches


def terminate_marked_processes(
    key: str,
    value: str,
    *,
    protected: bool | None = None,
) -> None:
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        processes = marked_processes(key, value, protected=protected)
        if not processes:
            return
        for process in processes:
            try:
                process.terminate()
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
        _, alive = psutil.wait_procs(processes, timeout=0.2)
        for process in alive:
            try:
                process.kill()
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
        psutil.wait_procs(alive, timeout=0.2)


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
    terminate_marked_processes(OWNER_ENV, owner, protected=False)
    while marked_processes(OWNER_ENV, owner, protected=True):
        time.sleep(0.05)
    terminate_marked_processes(OWNER_ENV, owner, protected=False)


class ProcessTree(Protocol):
    def terminate(self) -> None: ...

    def close(self) -> None: ...


@dataclass(frozen=True)
class ManagedProcess:
    process: subprocess.Popen[bytes]
    tree: ProcessTree | None = None
    protected: bool = False


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
            except ProcessLookupError:
                pass
            else:
                deadline = time.monotonic() + 0.25
                while time.monotonic() < deadline:
                    try:
                        os.killpg(self._process_group_id, 0)
                    except ProcessLookupError:
                        break
                    time.sleep(0.01)
                try:
                    os.killpg(self._process_group_id, signal.SIGKILL)
                except ProcessLookupError:
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
        def __init__(
            self,
            process: subprocess.Popen[bytes],
            *,
            kill_on_close: bool,
        ) -> None:
            self._lock = Lock()
            handle = _create_job_object(None, None)
            if not handle:
                raise ctypes.WinError(ctypes.get_last_error())
            self._handle: int | None = handle
            information = _JobObjectExtendedLimitInformation()
            information.BasicLimitInformation.LimitFlags = (
                0x00002000 if kill_on_close else 0
            )
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
        self._patch_lock = Lock()
        self._processes: dict[int, ManagedProcess] = {}
        self._closed = False

    def exec(
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
            "cwd": str(working_directory.relative_to(self.root)),
            "exit_code": process.returncode,
            "timed_out": timed_out,
            "duration_ms": round((time.monotonic() - started) * 1000),
            "stdout": stdout_text,
            "stderr": stderr_text,
            "stdout_truncated": stdout_truncated,
            "stderr_truncated": stderr_truncated,
        }

    def patch(self, diff: str) -> dict[str, Any]:
        if not isinstance(diff, str):
            raise HostToolError("diff must be a string")
        try:
            encoded = diff.encode("utf-8")
        except UnicodeEncodeError as error:
            raise HostToolError("diff must be valid UTF-8") from error
        if not encoded.strip():
            raise HostToolError("diff is required")
        if len(encoded) > 262_144:
            raise HostToolError("diff exceeds 262144 bytes")
        if "\0" in diff:
            raise HostToolError("Binary patches are not supported")
        if self._has_special_file_mode(diff):
            raise HostToolError("Symlink and submodule patches are not supported")

        with self._patch_lock:
            self._require_open()
            forward = self._git_apply(["--numstat", "-z"], encoded)
            if forward.returncode != 0:
                raise HostToolError(self._patch_error("Invalid patch", forward))
            reverse = self._git_apply(["--numstat", "-z", "--reverse"], encoded)
            if reverse.returncode != 0:
                raise HostToolError(self._patch_error("Invalid patch", reverse))
            paths = list(
                dict.fromkeys(
                    [
                        *self._parse_numstat_paths(forward.stdout),
                        *self._parse_numstat_paths(reverse.stdout),
                    ]
                )
            )
            if not paths:
                raise HostToolError("diff does not contain file changes")
            for path in paths:
                self._validate_patch_path(path)
                self._validate_text_file(path)
            self._reject_submodule_paths(paths)
            check = self._git_apply(["--check"], encoded)
            if check.returncode != 0:
                raise HostToolError(self._patch_error("Patch does not apply", check))
            applied = self._git_apply([], encoded, protected=True, timeout=None)
            if applied.returncode != 0:
                raise HostToolError(self._patch_error("Patch failed", applied))
            return {"applied": True, "paths": paths, "diff": diff}

    def close(self) -> None:
        with self._lock:
            if self._closed:
                return
            self._closed = True
            processes = [
                managed for managed in self._processes.values() if not managed.protected
            ]
        cleanup_threads = [
            Thread(target=self._terminate, args=(managed,), daemon=True)
            for managed in processes
        ]
        for cleanup in cleanup_threads:
            cleanup.start()
        cleanup_deadline = time.monotonic() + 6
        for cleanup in cleanup_threads:
            cleanup.join(timeout=max(0, cleanup_deadline - time.monotonic()))
        with self._patch_lock:
            pass
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            with self._lock:
                if not self._processes:
                    return
            time.sleep(0.01)

    def _resolve_directory(self, cwd: str | None) -> Path:
        relative = Path(cwd or ".")
        if relative.is_absolute() or ".." in relative.parts:
            raise HostToolError("cwd must stay within the launch directory")
        resolved = (self.root / relative).resolve()
        if not resolved.is_relative_to(self.root):
            raise HostToolError("cwd must stay within the launch directory")
        if not resolved.is_dir():
            raise HostToolError("cwd must identify an existing directory")
        return resolved

    def _validate_patch_path(self, path: str) -> None:
        relative = Path(path)
        if relative.is_absolute() or ".." in relative.parts:
            raise HostToolError("Patch paths must stay within the launch directory")
        normalized_parts = [part.casefold() for part in relative.parts]
        if ".git" in normalized_parts:
            raise HostToolError("Patches cannot modify Git metadata")
        if any(part == ".env" or part.startswith(".env.") for part in normalized_parts):
            raise HostToolError("Patches cannot modify environment files")
        candidate = self.root
        for part in relative.parts:
            candidate /= part
            if candidate.is_symlink():
                raise HostToolError("Symlink patches are not supported")
        resolved = (self.root / relative).resolve()
        if not resolved.is_relative_to(self.root):
            raise HostToolError("Patch paths must stay within the launch directory")

    def _validate_text_file(self, path: str) -> None:
        candidate = self.root / path
        if not candidate.is_file():
            return
        decoder = codecs.getincrementaldecoder("utf-8")()
        try:
            with candidate.open("rb") as file:
                while chunk := file.read(65_536):
                    if b"\0" in chunk:
                        raise HostToolError("Binary files are not supported")
                    decoder.decode(chunk)
                decoder.decode(b"", final=True)
        except UnicodeDecodeError as error:
            raise HostToolError("Binary files are not supported") from error
        except OSError as error:
            raise HostToolError(f"Cannot inspect patch path: {error}") from error

    def _reject_submodule_paths(self, paths: list[str]) -> None:
        repository = self._git_command(["git", "rev-parse", "--show-toplevel"])
        if repository.returncode != 0:
            return
        repository_root = Path(os.fsdecode(repository.stdout.rstrip(b"\r\n"))).resolve()
        try:
            launch_prefix = self.root.relative_to(repository_root)
        except ValueError:
            return
        ancestors = list(
            dict.fromkeys(
                ancestor
                for path in paths
                for ancestor in self._path_ancestors(Path(path))
            )
        )
        if not ancestors:
            return
        repository_ancestors = {
            launch_prefix / ancestor if launch_prefix.parts else ancestor
            for ancestor in ancestors
        }
        result = self._git_command(
            [
                "git",
                "--literal-pathspecs",
                "ls-files",
                "--stage",
                "-z",
                "--",
                *(str(ancestor) for ancestor in repository_ancestors),
            ],
            cwd=repository_root,
        )
        if result.returncode != 0:
            raise HostToolError(self._patch_error("Cannot inspect Git index", result))
        for record in result.stdout.split(b"\0"):
            header, separator, raw_path = record.partition(b"\t")
            if (
                separator
                and header.startswith(b"160000 ")
                and Path(os.fsdecode(raw_path)) in repository_ancestors
            ):
                raise HostToolError("Submodule patches are not supported")

    @staticmethod
    def _path_ancestors(path: Path) -> list[Path]:
        parts = path.parts
        return [Path(*parts[:index]) for index in range(1, len(parts) + 1)]

    def _parse_numstat_paths(self, output: bytes) -> list[str]:
        records = output.split(b"\0")
        paths: list[str] = []
        index = 0
        while index < len(records):
            record = records[index]
            if not record:
                index += 1
                continue
            fields = record.split(b"\t", 2)
            if len(fields) != 3:
                raise HostToolError("Cannot parse patch paths")
            if fields[0] == b"-" or fields[1] == b"-":
                raise HostToolError("Binary patches are not supported")
            if fields[2]:
                paths.append(os.fsdecode(fields[2]))
                index += 1
                continue
            if (
                index + 2 >= len(records)
                or not records[index + 1]
                or not records[index + 2]
            ):
                raise HostToolError("Cannot parse patch paths")
            paths.extend(
                [
                    os.fsdecode(records[index + 1]),
                    os.fsdecode(records[index + 2]),
                ]
            )
            index += 3
        return paths

    def _git_command(
        self,
        argv: list[str],
        *,
        input: bytes | None = None,
        protected: bool = False,
        timeout: float | None = 30,
        cwd: Path | None = None,
        repository_ceiling: Path | None = None,
    ) -> subprocess.CompletedProcess[bytes]:
        environment = os.environ.copy()
        for key in (
            "GIT_DIR",
            "GIT_WORK_TREE",
            "GIT_INDEX_FILE",
            "GIT_CEILING_DIRECTORIES",
        ):
            environment.pop(key, None)
        if repository_ceiling is not None:
            environment["GIT_CEILING_DIRECTORIES"] = str(repository_ceiling)
        managed = self._start_process(
            argv,
            cwd=cwd or self.root,
            env=environment,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            error_prefix=f"Cannot run {argv[0]}",
            protected=protected,
        )
        process = managed.process
        try:
            stdout, stderr = process.communicate(input=input, timeout=timeout)
        except subprocess.TimeoutExpired as error:
            self._terminate(managed)
            process.communicate()
            raise HostToolError(f"Cannot run {argv[0]}: TimeoutExpired") from error
        finally:
            self._close_tree(managed)
            stopped = self._unregister(managed)
        if stopped and not protected:
            raise HostToolError("Host tools are stopped")
        return subprocess.CompletedProcess(
            process.args,
            process.returncode,
            stdout,
            stderr,
        )

    def _git_apply(
        self,
        arguments: list[str],
        diff: bytes,
        *,
        protected: bool = False,
        timeout: float | None = 30,
    ) -> subprocess.CompletedProcess[bytes]:
        return self._git_command(
            ["git", "apply", *arguments, "-"],
            input=diff,
            protected=protected,
            timeout=timeout,
            repository_ceiling=self.root.parent,
        )

    def _patch_error(
        self,
        prefix: str,
        result: subprocess.CompletedProcess[bytes],
    ) -> str:
        detail = result.stderr.decode("utf-8", errors="replace").strip()
        if len(detail) > 4096:
            detail = f"{detail[:4096]}..."
        return f"{prefix}: {detail}" if detail else prefix

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

    @staticmethod
    def _has_special_file_mode(diff: str) -> bool:
        metadata_prefixes = (
            "new file mode ",
            "deleted file mode ",
            "old mode ",
            "new mode ",
            "index ",
        )
        return any(
            line.startswith(metadata_prefixes)
            and line.rsplit(" ", 1)[-1] in {"120000", "160000"}
            for line in diff.splitlines()
        )

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
        protected: bool = False,
    ) -> ManagedProcess:
        with self._lock:
            if self._closed:
                raise HostToolError("Host tools are stopped")
            execution_id = uuid4().hex
            environment = (env or os.environ).copy()
            environment[EXECUTION_ENV] = execution_id
            environment[OWNER_ENV] = self.process_owner
            if protected:
                environment[PROTECTED_PATCH_ENV] = "1"
            else:
                environment.pop(PROTECTED_PATCH_ENV, None)
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
                    WindowsJob(process, kill_on_close=not protected)
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
                tree=tree,
                protected=protected,
            )
            self._processes[process.pid] = managed
            return managed

    def _terminate(self, managed: ManagedProcess) -> None:
        process = managed.process
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
