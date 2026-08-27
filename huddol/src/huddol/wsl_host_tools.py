from __future__ import annotations

import hashlib
import json
import os
import platform
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from threading import Event, Lock, Thread
from typing import Any, BinaryIO, Protocol
from uuid import uuid4

from huddol.diagnostics import log_event
from huddol.host_tools import AgentHostTools, HostToolError, HostTools

HOST_BACKEND_ENV = "HUDDOL_HOST_BACKEND"
HOST_BINARY_ENV = "HUDDOL_WSL_HOST_BINARY"
WORKING_DIRECTORY_ENV = "HUDDOL_WORKING_DIRECTORY"


@dataclass(frozen=True)
class WslProbe:
    distribution: str
    home: str
    architecture: str


class HostBridge(Protocol):
    def call(
        self,
        method: str,
        params: dict[str, Any] | None = None,
        timeout: float = 30,
    ) -> dict[str, Any]: ...

    def close(self) -> None: ...


@dataclass
class _PendingResponse:
    event: Event
    response: dict[str, Any] | None = None


class _WslBridge:
    def __init__(self, process: subprocess.Popen[bytes]) -> None:
        if process.stdin is None or process.stdout is None:
            raise HostToolError("WSL host bridge pipes are unavailable")
        self._process = process
        self._stdin: BinaryIO = process.stdin
        self._stdout: BinaryIO = process.stdout
        self._write_lock = Lock()
        self._pending_lock = Lock()
        self._close_lock = Lock()
        self._pending: dict[int, _PendingResponse] = {}
        self._next_id = 1
        self._closed = False
        self._reader = Thread(target=self._read_responses, daemon=True)
        self._reader.start()

    def call(
        self,
        method: str,
        params: dict[str, Any] | None = None,
        timeout: float = 30,
    ) -> dict[str, Any]:
        with self._pending_lock:
            if self._closed:
                raise HostToolError("Host tools are stopped")
            request_id = self._next_id
            self._next_id += 1
            pending = _PendingResponse(Event())
            self._pending[request_id] = pending
        try:
            encoded = (
                json.dumps(
                    {"id": request_id, "method": method, "params": params or {}},
                    ensure_ascii=False,
                    separators=(",", ":"),
                ).encode("utf-8")
                + b"\n"
            )
            with self._write_lock:
                self._stdin.write(encoded)
                self._stdin.flush()
        except (OSError, UnicodeEncodeError) as error:
            self._fail_pending(request_id)
            raise HostToolError("Cannot write to WSL host bridge") from error
        if not pending.event.wait(timeout):
            self._fail_pending(request_id)
            raise HostToolError("WSL host bridge did not respond")
        response = pending.response
        if response is None:
            raise HostToolError("WSL host bridge stopped")
        if error := response.get("error"):
            message = error.get("message") if isinstance(error, dict) else None
            raise HostToolError(message or "WSL host operation failed")
        result = response.get("result")
        if not isinstance(result, dict):
            raise HostToolError("WSL host bridge returned an invalid result")
        return result

    def close(self) -> None:
        with self._close_lock:
            with self._pending_lock:
                running = not self._closed
            if running:
                try:
                    self.call("shutdown", timeout=12)
                except HostToolError:
                    pass
            with self._pending_lock:
                self._closed = True
            try:
                if not self._stdin.closed:
                    self._stdin.close()
            except OSError:
                pass
            try:
                self._process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._process.kill()
                self._process.wait(timeout=5)
            self._reader.join(timeout=5)
            self._fail_all()

    def _read_responses(self) -> None:
        try:
            while line := self._stdout.readline():
                try:
                    response = json.loads(line.decode("utf-8", errors="strict"))
                    request_id = response.get("id")
                except (UnicodeDecodeError, json.JSONDecodeError, AttributeError):
                    break
                if not isinstance(request_id, int):
                    break
                with self._pending_lock:
                    pending = self._pending.pop(request_id, None)
                if pending is not None:
                    pending.response = response
                    pending.event.set()
        finally:
            with self._pending_lock:
                self._closed = True
            self._fail_all()

    def _fail_pending(self, request_id: int) -> None:
        with self._pending_lock:
            pending = self._pending.pop(request_id, None)
        if pending is not None:
            pending.event.set()

    def _fail_all(self) -> None:
        with self._pending_lock:
            pending = list(self._pending.values())
            self._pending.clear()
        for response in pending:
            response.event.set()


class WslHostTools:
    def __init__(
        self,
        bridge: HostBridge,
        probe: WslProbe,
        *,
        output_limit: int = 65_536,
    ) -> None:
        if output_limit < 2:
            raise ValueError("output_limit must be at least 2")
        self._bridge = bridge
        self._probe = probe
        self._output_limit = output_limit
        self._closed = False
        self._lock = Lock()
        self.process_owner = uuid4().hex

    @classmethod
    def start(cls, binary_path: Path | None = None) -> WslHostTools:
        probe = probe_wsl()
        source = (binary_path or resolve_host_binary()).resolve()
        installed = install_host_binary(probe, source)
        creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) | getattr(
            subprocess, "CREATE_NEW_PROCESS_GROUP", 0
        )
        try:
            process = subprocess.Popen(
                [
                    "wsl.exe",
                    "--distribution",
                    probe.distribution,
                    "--cd",
                    probe.home,
                    "--exec",
                    installed,
                ],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                creationflags=creation_flags,
            )
        except OSError as error:
            raise HostToolError("Cannot start WSL host bridge") from error
        bridge = _WslBridge(process)
        try:
            hello = bridge.call("hello", timeout=15)
            if (
                hello.get("backend") != "wsl"
                or hello.get("home") != probe.home
                or hello.get("distribution") != probe.distribution
            ):
                raise HostToolError("WSL host bridge identity does not match the probe")
        except BaseException:
            bridge.close()
            raise
        return cls(bridge, probe)

    @property
    def working_directory(self) -> str:
        return self._probe.home

    @property
    def execution_backend(self) -> str:
        return "wsl"

    @property
    def environment_context(self) -> str:
        return (
            "<host_environment>\n"
            f"Your command and file environment is WSL {self._probe.distribution}.\n"
            f"The default working directory is {self._probe.home}.\n"
            "Use Linux commands and Linux paths. Windows drives are usually available under "
            "/mnt/<drive-letter>. Huddol service tools such as discussion, memory, todo, "
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
        self._require_open()
        return self._bridge.call(
            "run",
            {
                "argv": argv,
                "cwd": cwd,
                "timeout_seconds": timeout_seconds,
                "output_limit": self._output_limit,
            },
            timeout=timeout_seconds + 15,
        )

    def edit(
        self,
        path: str,
        old_text: str,
        new_text: str,
        replace_all: bool = False,
    ) -> dict[str, Any]:
        if not isinstance(path, str):
            raise HostToolError("path must be a string")
        if not isinstance(old_text, str):
            raise HostToolError("old_text must be a string")
        if not isinstance(new_text, str):
            raise HostToolError("new_text must be a string")
        if type(replace_all) is not bool:
            raise HostToolError("replace_all must be a boolean")
        self._require_utf8(path, "path")
        self._require_utf8(old_text, "old_text")
        self._require_utf8(new_text, "new_text")
        if not path:
            raise HostToolError("path is required")
        if not old_text:
            raise HostToolError("old_text is required")
        if old_text == new_text:
            raise HostToolError("old_text and new_text must differ")
        self._require_open()
        return self._bridge.call(
            "edit",
            {
                "path": path,
                "old_text": old_text,
                "new_text": new_text,
                "replace_all": replace_all,
            },
            timeout=30,
        )

    def close(self) -> None:
        with self._lock:
            if self._closed:
                return
            self._closed = True
        self._bridge.close()

    def _require_open(self) -> None:
        with self._lock:
            if self._closed:
                raise HostToolError("Host tools are stopped")

    @staticmethod
    def _validate_argv(argv: list[str]) -> None:
        if not isinstance(argv, list) or not argv or len(argv) > 128:
            raise HostToolError("argv must contain between 1 and 128 items")
        if any(not isinstance(item, str) or not item or "\0" in item for item in argv):
            raise HostToolError("argv items must be non-empty strings")
        for item in argv:
            WslHostTools._require_utf8(item, "argv items")

    @staticmethod
    def _require_utf8(value: str, field: str) -> None:
        try:
            value.encode("utf-8")
        except UnicodeEncodeError as error:
            raise HostToolError(f"{field} must be valid UTF-8") from error


def create_host_tools() -> AgentHostTools:
    working_directory = os.environ.get(WORKING_DIRECTORY_ENV)
    preference = os.environ.get(HOST_BACKEND_ENV, "auto").strip().lower()
    if preference not in ("auto", "native", "wsl"):
        raise RuntimeError("HUDDOL_HOST_BACKEND must be auto, native, or wsl")
    if working_directory:
        tools = HostTools(Path(working_directory).expanduser())
        _log_selected(tools)
        return tools
    if os.name == "nt" and preference != "native":
        try:
            tools = WslHostTools.start()
        except (HostToolError, OSError, ValueError) as error:
            if preference == "wsl":
                raise RuntimeError("WSL host backend is unavailable") from error
            log_event(
                "host.backend.fallback", requested="wsl", reason=type(error).__name__
            )
        else:
            _log_selected(tools)
            return tools
    elif preference == "wsl":
        raise RuntimeError("WSL host backend is only available on Windows")
    tools = HostTools(Path.home())
    _log_selected(tools)
    return tools


def probe_wsl() -> WslProbe:
    result = _run_wsl(
        [
            "wsl.exe",
            "--exec",
            "sh",
            "-c",
            'printf "%s\\n%s\\n%s\\n" "${WSL_DISTRO_NAME:-}" "$HOME" "$(uname -m)"',
        ],
        timeout=15,
    )
    lines = result.stdout.splitlines()
    if len(lines) != 3 or not all(lines):
        raise HostToolError("WSL probe returned an invalid response")
    distribution, home, architecture = lines
    if distribution.lower().startswith("docker-desktop"):
        raise HostToolError("The default WSL distribution is not a user distribution")
    if not home.startswith("/"):
        raise HostToolError("WSL HOME is invalid")
    if architecture not in ("x86_64", "amd64"):
        raise HostToolError("The default WSL distribution architecture is unsupported")
    return WslProbe(distribution, home, architecture)


def resolve_host_binary() -> Path:
    if override := os.environ.get(HOST_BINARY_ENV):
        candidate = Path(override)
    elif bundle_root := getattr(sys, "_MEIPASS", None):
        candidate = Path(bundle_root) / "huddol-host"
    else:
        candidate = (
            Path(__file__).resolve().parents[3]
            / "app"
            / "src-tauri"
            / "binaries"
            / "huddol-host"
        )
    if not candidate.is_file():
        raise HostToolError("WSL host bridge binary is unavailable")
    return candidate


def install_host_binary(probe: WslProbe, source: Path) -> str:
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    source_path = _run_wsl(
        [
            "wsl.exe",
            "--distribution",
            probe.distribution,
            "--exec",
            "wslpath",
            "-u",
            str(source),
        ],
        timeout=15,
    ).stdout.strip()
    if not source_path.startswith("/"):
        raise HostToolError("Cannot translate the WSL host bridge path")
    directory = f"{probe.home}/.cache/huddol/host/{digest}"
    destination = f"{directory}/huddol-host"
    _run_wsl(
        [
            "wsl.exe",
            "--distribution",
            probe.distribution,
            "--exec",
            "sh",
            "-c",
            'set -eu; mkdir -p "$1"; tmp="$3.tmp.$$"; trap \'rm -f "$tmp"\' EXIT; cp "$2" "$tmp"; chmod 700 "$tmp"; mv -f "$tmp" "$3"; trap - EXIT',
            "huddol-host-install",
            directory,
            source_path,
            destination,
        ],
        timeout=30,
    )
    return destination


def _run_wsl(argv: list[str], *, timeout: int) -> subprocess.CompletedProcess[str]:
    creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    try:
        result = subprocess.run(
            argv,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="strict",
            timeout=timeout,
            creationflags=creation_flags,
            check=False,
        )
    except (OSError, subprocess.SubprocessError, UnicodeError) as error:
        raise HostToolError("Cannot execute WSL probe") from error
    if result.returncode != 0:
        raise HostToolError("WSL command failed")
    return result


def _log_selected(tools: AgentHostTools) -> None:
    log_event(
        "host.backend.selected",
        backend=tools.execution_backend,
        working_directory=tools.working_directory,
        platform=platform.system().lower(),
    )
