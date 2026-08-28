from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any

import pytest

from huddol import wsl_host_tools
from huddol.host_tools import HostToolError
from huddol.wsl_host_tools import ExecutionSettings, WslHostTools, WslProbe


class FakeLauncher:
    def __init__(self) -> None:
        self.process_owner = "owner"
        self.run_calls: list[tuple[list[str], str | None, int]] = []
        self.edit_calls: list[tuple[str, str, str, bool]] = []
        self.closed = False

    @property
    def working_directory(self) -> str:
        return r"F:\Project\flowent"

    @property
    def execution_backend(self) -> str:
        return "native"

    @property
    def environment_context(self) -> str:
        return "native"

    def run(
        self,
        argv: list[str],
        cwd: str | None = None,
        timeout_seconds: int = 60,
    ) -> dict[str, Any]:
        self.run_calls.append((argv, cwd, timeout_seconds))
        return {
            "argv": argv,
            "cwd": ".",
            "exit_code": 0,
            "timed_out": False,
            "duration_ms": 1,
            "stdout": "Linux\n",
            "stderr": "",
            "stdout_truncated": False,
            "stderr_truncated": False,
        }

    def edit(
        self,
        path: str,
        old_text: str,
        new_text: str,
        replace_all: bool = False,
    ) -> dict[str, Any]:
        self.edit_calls.append((path, old_text, new_text, replace_all))
        return {"edited": True, "path": path, "replacement_count": 1}

    def close(self) -> None:
        self.closed = True


def test_wsl_host_tools_run_directly_through_wsl_exe() -> None:
    launcher = FakeLauncher()
    tools = WslHostTools(
        launcher,
        WslProbe("Debian", "/home/ada", "x86_64"),
        "/mnt/f/Project/flowent",
    )

    result = tools.run(["printf", "%s", "$(not-a-shell)"], timeout_seconds=7)

    assert result["argv"] == ["printf", "%s", "$(not-a-shell)"]
    assert result["cwd"] == "."
    assert result["stdout"] == "Linux\n"
    assert launcher.run_calls == [
        (
            [
                "wsl.exe",
                "--distribution",
                "Debian",
                "--cd",
                "/mnt/f/Project/flowent",
                "--exec",
                "printf",
                "%s",
                "$(not-a-shell)",
            ],
            None,
            7,
        )
    ]
    assert tools.execution_backend == "wsl"
    assert tools.working_directory == "/mnt/f/Project/flowent"
    assert "WSL Debian" in tools.environment_context
    tools.close()
    assert launcher.closed is True


def test_wsl_host_tools_edit_reuses_native_atomic_edit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    launcher = FakeLauncher()
    tools = WslHostTools(
        launcher,
        WslProbe("Debian", "/home/ada", "x86_64"),
        "/mnt/f/Project/flowent",
    )
    calls: list[list[str]] = []

    def run_wsl(argv: list[str], *, timeout: int) -> subprocess.CompletedProcess[str]:
        calls.append(argv)
        stdout = (
            "/mnt/f/Project/flowent/project/file.txt\n"
            if "readlink" in argv
            else "F:\\Project\\flowent\\project\\file.txt\n"
        )
        return subprocess.CompletedProcess(argv, 0, stdout=stdout, stderr="")

    monkeypatch.setattr(wsl_host_tools, "_run_wsl", run_wsl)

    result = tools.edit("project/file.txt", "before", "after")

    assert result == {
        "edited": True,
        "path": "project/file.txt",
        "replacement_count": 1,
    }
    assert launcher.edit_calls == [
        (r"F:\Project\flowent\project\file.txt", "before", "after", False)
    ]
    assert calls[0][-2:] == ["--", "/mnt/f/Project/flowent/project/file.txt"]
    assert calls[1][-2:] == ["--", "/mnt/f/Project/flowent/project/file.txt"]


def test_wsl_host_tools_reject_invalid_inputs_before_launch() -> None:
    launcher = FakeLauncher()
    tools = WslHostTools(
        launcher,
        WslProbe("Debian", "/home/ada", "x86_64"),
        "/mnt/f/Project/flowent",
    )

    with pytest.raises(HostToolError, match="argv"):
        tools.run([])
    with pytest.raises(HostToolError, match="path is required"):
        tools.edit("", "before", "after")
    with pytest.raises(HostToolError, match="must differ"):
        tools.edit("file.txt", "same", "same")

    assert launcher.run_calls == []
    assert launcher.edit_calls == []


def test_execution_settings_persist_selection_and_require_restart(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    saved: list[str] = []
    probe = WslProbe("Debian", "/home/ada", "x86_64")
    monkeypatch.setattr(wsl_host_tools.platform, "system", lambda: "Windows")
    settings = ExecutionSettings("native", "native", probe, saved.append)

    updated = settings.configure("wsl")

    assert saved == ["wsl"]
    assert updated == {
        "platform": "windows",
        "selected_backend": "wsl",
        "active_backend": "native",
        "wsl_available": True,
        "wsl_distribution": "Debian",
        "restart_required": True,
    }


def test_execution_settings_reject_unavailable_wsl() -> None:
    settings = ExecutionSettings("native", "native", None)

    with pytest.raises(ValueError, match="WSL is unavailable"):
        settings.configure("wsl")


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


def test_create_host_tools_uses_selected_wsl_on_windows(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    probe = WslProbe("Debian", "/home/ada", "x86_64")
    expected = WslHostTools(FakeLauncher(), probe, "/mnt/f/project")
    monkeypatch.setenv(wsl_host_tools.WORKING_DIRECTORY_ENV, str(tmp_path))
    monkeypatch.setattr(wsl_host_tools.os, "name", "nt")
    monkeypatch.setattr(wsl_host_tools, "probe_wsl", lambda: probe)
    monkeypatch.setattr(
        WslHostTools,
        "start",
        classmethod(lambda cls, root, active_probe: expected),
    )
    monkeypatch.setattr(wsl_host_tools, "_log_selected", lambda tools: None)

    tools, settings = wsl_host_tools.create_host_tools("wsl")

    assert tools is expected
    assert settings.settings()["selected_backend"] == "wsl"
    assert settings.settings()["wsl_distribution"] == "Debian"


def test_create_host_tools_falls_back_when_wsl_start_fails(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    saved: list[str] = []
    probe = WslProbe("Debian", "/home/ada", "x86_64")
    launcher = FakeLauncher()
    monkeypatch.setenv(wsl_host_tools.WORKING_DIRECTORY_ENV, str(tmp_path))
    monkeypatch.setattr(wsl_host_tools.os, "name", "nt")
    monkeypatch.setattr(wsl_host_tools, "probe_wsl", lambda: probe)
    monkeypatch.setattr(
        WslHostTools,
        "start",
        classmethod(
            lambda cls, root, active_probe: (_ for _ in ()).throw(
                HostToolError("cannot map root")
            )
        ),
    )
    monkeypatch.setattr(wsl_host_tools, "HostTools", lambda root: launcher)
    monkeypatch.setattr(wsl_host_tools, "_log_selected", lambda tools: None)

    tools, settings = wsl_host_tools.create_host_tools("wsl", saved.append)

    assert tools is launcher
    assert saved == ["native"]
    assert settings.settings()["selected_backend"] == "native"
    assert settings.settings()["wsl_available"] is False


def test_create_host_tools_falls_back_to_native_when_wsl_is_unavailable(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    saved: list[str] = []
    monkeypatch.setenv(wsl_host_tools.WORKING_DIRECTORY_ENV, str(tmp_path))
    monkeypatch.setattr(wsl_host_tools.os, "name", "nt")
    monkeypatch.setattr(
        wsl_host_tools,
        "probe_wsl",
        lambda: (_ for _ in ()).throw(HostToolError("unavailable")),
    )
    launcher = FakeLauncher()
    monkeypatch.setattr(wsl_host_tools, "HostTools", lambda root: launcher)
    monkeypatch.setattr(wsl_host_tools, "_log_selected", lambda tools: None)

    tools, settings = wsl_host_tools.create_host_tools("wsl", saved.append)

    assert tools is launcher
    assert tools.execution_backend == "native"
    assert tools.working_directory == r"F:\Project\flowent"
    assert saved == ["native"]
    assert settings.settings()["selected_backend"] == "native"
    assert settings.settings()["wsl_available"] is False


def test_create_host_tools_uses_startup_directory_for_native_backend(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv(wsl_host_tools.WORKING_DIRECTORY_ENV, str(tmp_path))
    monkeypatch.setattr(wsl_host_tools, "_log_selected", lambda tools: None)

    tools, settings = wsl_host_tools.create_host_tools("native")

    assert tools.execution_backend == "native"
    assert tools.working_directory == str(tmp_path)
    assert settings.settings()["active_backend"] == "native"
