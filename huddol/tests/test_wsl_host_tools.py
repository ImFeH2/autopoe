from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any

import pytest

from huddol import wsl_host_tools
from huddol.host_tools import HostToolError
from huddol.wsl_host_tools import WslHostTools, WslProbe


class FakeBridge:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any] | None, float]] = []
        self.closed = False

    def call(
        self,
        method: str,
        params: dict[str, Any] | None = None,
        timeout: float = 30,
    ) -> dict[str, Any]:
        self.calls.append((method, params, timeout))
        if method == "run":
            return {
                "argv": params["argv"],
                "cwd": ".",
                "exit_code": 0,
                "timed_out": False,
                "duration_ms": 1,
                "stdout": "Linux\n",
                "stderr": "",
                "stdout_truncated": False,
                "stderr_truncated": False,
            }
        if method == "edit":
            return {"edited": True, "path": params["path"], "replacement_count": 1}
        return {"stopped": True}

    def close(self) -> None:
        self.closed = True


def test_wsl_host_tools_delegate_linux_run_and_edit() -> None:
    bridge = FakeBridge()
    tools = WslHostTools(bridge, WslProbe("Debian", "/home/ada", "x86_64"))

    run = tools.run(["uname", "-s"], timeout_seconds=7)
    edit = tools.edit("project/file.txt", "before", "after")

    assert tools.execution_backend == "wsl"
    assert tools.working_directory == "/home/ada"
    assert "WSL Debian" in tools.environment_context
    assert "Linux\n" == run["stdout"]
    assert edit == {"edited": True, "path": "project/file.txt", "replacement_count": 1}
    assert bridge.calls == [
        (
            "run",
            {
                "argv": ["uname", "-s"],
                "cwd": None,
                "timeout_seconds": 7,
                "output_limit": 65_536,
            },
            22,
        ),
        (
            "edit",
            {
                "path": "project/file.txt",
                "old_text": "before",
                "new_text": "after",
                "replace_all": False,
            },
            30,
        ),
    ]

    tools.close()
    assert bridge.closed is True


def test_wsl_host_tools_reject_invalid_inputs_before_bridge() -> None:
    bridge = FakeBridge()
    tools = WslHostTools(bridge, WslProbe("Debian", "/home/ada", "x86_64"))

    with pytest.raises(HostToolError, match="argv"):
        tools.run([])
    with pytest.raises(HostToolError, match="path is required"):
        tools.edit("", "before", "after")
    with pytest.raises(HostToolError, match="must differ"):
        tools.edit("file.txt", "same", "same")

    assert bridge.calls == []


def test_probe_wsl_reads_default_user_distribution(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    completed = subprocess.CompletedProcess(
        ["wsl.exe"],
        0,
        stdout="Debian\n/home/ada\nx86_64\n",
        stderr="",
    )
    monkeypatch.setattr(wsl_host_tools, "_run_wsl", lambda argv, timeout: completed)

    assert wsl_host_tools.probe_wsl() == WslProbe("Debian", "/home/ada", "x86_64")


def test_probe_wsl_rejects_docker_default(monkeypatch: pytest.MonkeyPatch) -> None:
    completed = subprocess.CompletedProcess(
        ["wsl.exe"],
        0,
        stdout="docker-desktop\n/root\nx86_64\n",
        stderr="",
    )
    monkeypatch.setattr(wsl_host_tools, "_run_wsl", lambda argv, timeout: completed)

    with pytest.raises(HostToolError, match="not a user distribution"):
        wsl_host_tools.probe_wsl()


def test_create_host_tools_prefers_wsl_on_windows(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bridge = FakeBridge()
    expected = WslHostTools(bridge, WslProbe("Debian", "/home/ada", "x86_64"))
    monkeypatch.delenv(wsl_host_tools.WORKING_DIRECTORY_ENV, raising=False)
    monkeypatch.delenv(wsl_host_tools.HOST_BACKEND_ENV, raising=False)
    monkeypatch.setattr(wsl_host_tools.os, "name", "nt")
    monkeypatch.setattr(WslHostTools, "start", classmethod(lambda cls: expected))
    monkeypatch.setattr(wsl_host_tools, "_log_selected", lambda tools: None)

    assert wsl_host_tools.create_host_tools() is expected


def test_create_host_tools_falls_back_to_native_home_when_wsl_is_unavailable(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.delenv(wsl_host_tools.WORKING_DIRECTORY_ENV, raising=False)
    monkeypatch.delenv(wsl_host_tools.HOST_BACKEND_ENV, raising=False)
    monkeypatch.setattr(wsl_host_tools.os, "name", "nt")
    monkeypatch.setattr(wsl_host_tools.Path, "home", classmethod(lambda cls: tmp_path))

    def unavailable(cls: type[WslHostTools]) -> WslHostTools:
        raise HostToolError("unavailable")

    monkeypatch.setattr(WslHostTools, "start", classmethod(unavailable))
    monkeypatch.setattr(wsl_host_tools, "_log_selected", lambda tools: None)
    monkeypatch.setattr(wsl_host_tools, "log_event", lambda event, **fields: None)

    tools = wsl_host_tools.create_host_tools()

    assert tools.execution_backend == "native"
    assert tools.working_directory == str(tmp_path)


def test_create_host_tools_uses_home_for_native_backend(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.delenv(wsl_host_tools.WORKING_DIRECTORY_ENV, raising=False)
    monkeypatch.setenv(wsl_host_tools.HOST_BACKEND_ENV, "native")
    monkeypatch.setattr(wsl_host_tools.Path, "home", classmethod(lambda cls: tmp_path))
    monkeypatch.setattr(wsl_host_tools, "_log_selected", lambda tools: None)

    tools = wsl_host_tools.create_host_tools()

    assert tools.execution_backend == "native"
    assert tools.working_directory == str(tmp_path)
