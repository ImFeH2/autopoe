from __future__ import annotations

import os
import platform
import posixpath
import subprocess
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from threading import Lock
from typing import Any, Literal

from huddol.diagnostics import log_event
from huddol.host_tools import AgentHostTools, HostToolError, HostTools

WORKING_DIRECTORY_ENV = "HUDDOL_WORKING_DIRECTORY"
ExecutionBackend = Literal["native", "wsl"]


@dataclass(frozen=True)
class WslProbe:
    distribution: str
    home: str
    architecture: str


class ExecutionSettings:
    def __init__(
        self,
        selected_backend: ExecutionBackend,
        active_backend: ExecutionBackend,
        wsl_probe: WslProbe | None,
        on_configure: Callable[[ExecutionBackend], None] | None = None,
    ) -> None:
        self._selected_backend = selected_backend
        self._active_backend = active_backend
        self._wsl_probe = wsl_probe
        self._on_configure = on_configure
        self._lock = Lock()

    def settings(self) -> dict[str, Any]:
        with self._lock:
            selected = self._selected_backend
            active = self._active_backend
            probe = self._wsl_probe
        return {
            "platform": platform.system().lower(),
            "selected_backend": selected,
            "active_backend": active,
            "wsl_available": probe is not None,
            "wsl_distribution": probe.distribution if probe is not None else None,
            "restart_required": selected != active,
        }

    def configure(self, backend: str) -> dict[str, Any]:
        if backend not in ("native", "wsl"):
            raise ValueError("backend must be native or wsl")
        with self._lock:
            if backend == "wsl" and self._wsl_probe is None:
                raise ValueError("WSL is unavailable")
            if self._on_configure is not None:
                self._on_configure(backend)
            self._selected_backend = backend
        log_event("execution.config.updated", backend=backend)
        return self.settings()


class WslHostTools:
    def __init__(
        self,
        launcher: AgentHostTools,
        probe: WslProbe,
        working_directory: str,
    ) -> None:
        self._launcher = launcher
        self._probe = probe
        self._working_directory = working_directory
        self.process_owner = launcher.process_owner

    @classmethod
    def start(
        cls,
        root: Path,
        probe: WslProbe | None = None,
        *,
        output_limit: int = 65_536,
    ) -> WslHostTools:
        active_probe = probe or probe_wsl()
        working_directory = translate_working_directory(active_probe, root)
        return cls(
            HostTools(root, output_limit=output_limit),
            active_probe,
            working_directory,
        )

    @property
    def working_directory(self) -> str:
        return self._working_directory

    @property
    def execution_backend(self) -> str:
        return "wsl"

    @property
    def environment_context(self) -> str:
        return (
            "<host_environment>\n"
            f"Your command and file environment is WSL {self._probe.distribution}.\n"
            f"The default working directory is {self._working_directory}.\n"
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
        working_directory = self._resolve_directory(cwd)
        result = self._launcher.run(
            [
                "wsl.exe",
                "--distribution",
                self._probe.distribution,
                "--cd",
                working_directory,
                "--exec",
                *argv,
            ],
            timeout_seconds=timeout_seconds,
        )
        return {
            **result,
            "argv": argv,
            "cwd": self._display_path(working_directory),
        }

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
        linux_path = self._resolve_path(path)
        resolved_path = _run_wsl(
            [
                "wsl.exe",
                "--distribution",
                self._probe.distribution,
                "--cd",
                self._working_directory,
                "--exec",
                "readlink",
                "-f",
                "--",
                linux_path,
            ],
            timeout=30,
        ).stdout.strip()
        if not resolved_path:
            raise HostToolError("Edit path must identify an existing file")
        windows_path = _run_wsl(
            [
                "wsl.exe",
                "--distribution",
                self._probe.distribution,
                "--exec",
                "wslpath",
                "-w",
                "--",
                resolved_path,
            ],
            timeout=30,
        ).stdout.strip()
        if not windows_path:
            raise HostToolError("Cannot translate the WSL edit path")
        result = self._launcher.edit(
            windows_path,
            old_text,
            new_text,
            replace_all,
        )
        return {
            **result,
            "path": self._display_path(resolved_path),
        }

    def close(self) -> None:
        self._launcher.close()

    def _resolve_directory(self, cwd: str | None) -> str:
        if cwd is None:
            return self._working_directory
        return self._resolve_path(cwd)

    def _resolve_path(self, path: str) -> str:
        if PurePosixPath(path).is_absolute():
            return posixpath.normpath(path)
        return posixpath.normpath(posixpath.join(self._working_directory, path))

    def _display_path(self, path: str) -> str:
        try:
            relative = PurePosixPath(path).relative_to(self._working_directory)
        except ValueError:
            return path
        rendered = str(relative)
        return rendered if rendered != "." else "."

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


def create_host_tools(
    selected_backend: str,
    on_configure: Callable[[ExecutionBackend], None] | None = None,
) -> tuple[AgentHostTools, ExecutionSettings]:
    if selected_backend not in ("native", "wsl"):
        raise RuntimeError("Persisted execution backend is invalid")
    root = Path(os.environ.get(WORKING_DIRECTORY_ENV) or Path.cwd()).expanduser()
    probe: WslProbe | None = None
    if os.name == "nt":
        try:
            probe = probe_wsl()
        except (HostToolError, OSError, ValueError) as error:
            log_event("execution.wsl.unavailable", reason=type(error).__name__)
    effective_backend: ExecutionBackend = selected_backend
    if selected_backend == "wsl" and probe is None:
        effective_backend = "native"
        if on_configure is not None:
            on_configure(effective_backend)
        log_event("execution.config.fallback", requested="wsl", active="native")
    tools: AgentHostTools
    if effective_backend == "wsl" and probe is not None:
        try:
            tools = WslHostTools.start(root, probe)
        except (HostToolError, OSError, ValueError) as error:
            probe = None
            effective_backend = "native"
            if on_configure is not None:
                on_configure(effective_backend)
            log_event(
                "execution.config.fallback",
                requested="wsl",
                active="native",
                reason=type(error).__name__,
            )
            tools = HostTools(root)
    else:
        tools = HostTools(root)
    _log_selected(tools)
    return (
        tools,
        ExecutionSettings(
            effective_backend,
            tools.execution_backend,
            probe,
            on_configure,
        ),
    )


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


def translate_working_directory(probe: WslProbe, root: Path) -> str:
    path = _run_wsl(
        [
            "wsl.exe",
            "--distribution",
            probe.distribution,
            "--exec",
            "wslpath",
            "-u",
            "--",
            str(root.resolve()),
        ],
        timeout=15,
    ).stdout.strip()
    if not path.startswith("/"):
        raise HostToolError("Cannot translate the WSL working directory")
    return path


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
        raise HostToolError("Cannot execute WSL command") from error
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
