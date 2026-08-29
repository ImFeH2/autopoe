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
        return r"C:\workspace\repository"

    @property
    def execution_backend(self) -> str:
        return "native"

    @property
    def environment_context(self) -> str:
        return "native"

    @property
    def write_directories(self) -> tuple[str, ...]:
        return ()

    def configure_write_directories(
        self,
        _write_directories: list[str] | tuple[str, ...],
    ) -> None:
        pass

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
        "/mnt/c/workspace/repository",
        ("/mnt/c/workspace/repository",),
        (r"C:\workspace\repository",),
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
                "/mnt/c/workspace/repository",
                "--exec",
                "bwrap",
                "--new-session",
                "--die-with-parent",
                "--ro-bind",
                "/",
                "/",
                "--dev",
                "/dev",
                "--unshare-user",
                "--bind",
                "/mnt/c/workspace/repository",
                "/mnt/c/workspace/repository",
                "--chdir",
                "/mnt/c/workspace/repository",
                "--cap-drop",
                "ALL",
                "--",
                "printf",
                "%s",
                "$(not-a-shell)",
            ],
            None,
            7,
        )
    ]
    assert tools.execution_backend == "wsl"
    assert tools.working_directory == "/mnt/c/workspace/repository"
    assert "WSL Debian" in tools.environment_context
    tools.close()
    assert launcher.closed is True


def test_wsl_write_directory_updates_apply_to_each_run() -> None:
    launcher = FakeLauncher()
    tools = WslHostTools(
        launcher,
        WslProbe("Debian", "/home/ada", "x86_64"),
        "/home/ada",
    )

    tools.run(["true"])
    tools.configure_write_directories(("/workspace/repository",))
    tools.run(["true"])
    tools.configure_write_directories(())
    tools.run(["true"])

    commands = [call[0] for call in launcher.run_calls]
    assert "--bind" not in commands[0]
    assert commands[1][commands[1].index("--bind") + 1 :][:2] == [
        "/workspace/repository",
        "/workspace/repository",
    ]
    assert "--bind" not in commands[2]


def test_wsl_host_tools_start_uses_backend_home(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    probe = WslProbe("Debian", "/home/ada", "x86_64")
    launcher = FakeLauncher()
    native_home = tmp_path / "native-home"
    native_home.mkdir()
    roots: list[Path] = []
    monkeypatch.setattr(
        wsl_host_tools,
        "HostTools",
        lambda root, **_kwargs: roots.append(root) or launcher,
    )
    monkeypatch.setattr(
        wsl_host_tools,
        "translate_working_directory",
        lambda _probe, _root: (_ for _ in ()).throw(AssertionError("unexpected")),
    )

    tools = WslHostTools.start(
        native_home,
        probe,
        write_directories=("/mnt/c/workspace/repository", "/workspace/repository"),
    )

    assert roots == [native_home]
    assert tools.working_directory == "/home/ada"
    assert tools.write_directories == (
        "/mnt/c/workspace/repository",
        "/workspace/repository",
    )


def test_wsl_host_tools_edit_reuses_native_atomic_edit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    launcher = FakeLauncher()
    tools = WslHostTools(
        launcher,
        WslProbe("Debian", "/home/ada", "x86_64"),
        "/mnt/c/workspace/repository",
        ("/mnt/c/workspace/repository",),
        (r"C:\workspace\repository",),
    )
    calls: list[list[str]] = []

    def run_wsl(argv: list[str], *, timeout: int) -> subprocess.CompletedProcess[str]:
        calls.append(argv)
        stdout = (
            "/mnt/c/workspace/repository/project/file.txt\n"
            if "readlink" in argv
            else "C:\\workspace\\repository\\project\\file.txt\n"
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
        (r"C:\workspace\repository\project\file.txt", "before", "after", False)
    ]
    assert calls[0][-2:] == ["--", "/mnt/c/workspace/repository/project/file.txt"]
    assert calls[1][-2:] == ["--", "/mnt/c/workspace/repository/project/file.txt"]


def test_wsl_host_tools_reject_invalid_inputs_before_launch() -> None:
    launcher = FakeLauncher()
    tools = WslHostTools(
        launcher,
        WslProbe("Debian", "/home/ada", "x86_64"),
        "/mnt/c/workspace/repository",
    )

    with pytest.raises(HostToolError, match="argv"):
        tools.run([])
    with pytest.raises(HostToolError, match="path is required"):
        tools.edit("", "before", "after")
    with pytest.raises(HostToolError, match="must differ"):
        tools.edit("file.txt", "same", "same")

    assert launcher.run_calls == []
    assert launcher.edit_calls == []


def test_execution_settings_save_wsl_absolute_directories_for_restart(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    saved: list[tuple[str, tuple[str, ...]]] = []
    probe = WslProbe("Debian", "/home/ada", "x86_64")
    directories = ("/mnt/c/workspace/repository", "/workspace/repository")
    monkeypatch.setattr(wsl_host_tools.platform, "system", lambda: "Windows")
    monkeypatch.setattr(
        wsl_host_tools,
        "_run_wsl",
        lambda argv, timeout: subprocess.CompletedProcess(
            argv,
            0,
            stdout=argv[-1],
            stderr="",
        ),
    )
    settings = ExecutionSettings(
        "native",
        "native",
        probe,
        on_configure=lambda backend, paths: saved.append((backend, paths)),
    )

    updated = settings.configure("wsl", list(directories))

    assert saved == [("wsl", directories)]
    assert updated == {
        "platform": "windows",
        "selected_backend": "wsl",
        "active_backend": "native",
        "wsl_available": True,
        "wsl_distribution": "Debian",
        "write_directories": list(directories),
        "restart_required": True,
    }


def test_execution_settings_reject_relative_or_missing_wsl_directories(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = ExecutionSettings(
        "native",
        "native",
        WslProbe("Debian", "/home/ada", "x86_64"),
    )

    with pytest.raises(ValueError, match="absolute paths"):
        settings.configure("wsl", ["project"])

    monkeypatch.setattr(
        wsl_host_tools,
        "_run_wsl",
        lambda _argv, timeout: (_ for _ in ()).throw(
            HostToolError("WSL command failed")
        ),
    )
    with pytest.raises(ValueError, match="existing directories"):
        settings.configure("wsl", ["/missing"])

    assert settings.settings()["selected_backend"] == "native"
    assert settings.settings()["write_directories"] == []


def test_write_directory_change_applies_without_restart(tmp_path: Path) -> None:
    writable = tmp_path / "writable"
    writable.mkdir()
    applied: list[tuple[str, ...]] = []
    settings = ExecutionSettings(
        "native",
        "native",
        None,
        on_apply=applied.append,
    )

    updated = settings.configure("native", [str(writable)])

    assert applied == [(str(writable),)]
    assert updated["active_backend"] == "native"
    assert updated["write_directories"] == [str(writable)]
    assert updated["restart_required"] is False


def test_execution_settings_remain_unchanged_when_save_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        wsl_host_tools,
        "_run_wsl",
        lambda argv, timeout: subprocess.CompletedProcess(
            argv,
            0,
            stdout="/workspace/repository",
            stderr="",
        ),
    )
    settings = ExecutionSettings(
        "native",
        "native",
        WslProbe("Debian", "/home/ada", "x86_64"),
        on_configure=lambda _backend, _paths: (_ for _ in ()).throw(
            OSError("cannot save")
        ),
    )

    with pytest.raises(OSError, match="cannot save"):
        settings.configure("wsl", ["/workspace/repository"])

    assert settings.settings()["selected_backend"] == "native"
    assert settings.settings()["write_directories"] == []
    assert settings.settings()["restart_required"] is False


def test_execution_settings_restore_saved_values_when_apply_fails(
    tmp_path: Path,
) -> None:
    saved: list[tuple[str, tuple[str, ...]]] = []
    settings = ExecutionSettings(
        "native",
        "native",
        None,
        on_configure=lambda backend, paths: saved.append((backend, paths)),
        on_apply=lambda _paths: (_ for _ in ()).throw(OSError("cannot apply")),
    )

    with pytest.raises(OSError, match="cannot apply"):
        settings.configure("native", [str(tmp_path)])

    assert saved == [("native", (str(tmp_path),)), ("native", ())]
    assert settings.settings()["write_directories"] == []
    assert settings.settings()["restart_required"] is False


def test_execution_settings_reject_unavailable_wsl() -> None:
    settings = ExecutionSettings("native", "native", None)

    with pytest.raises(ValueError, match="WSL is unavailable"):
        settings.configure("wsl", [])


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


def test_create_host_tools_uses_selected_wsl_home_on_windows(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    probe = WslProbe("Debian", "/home/ada", "x86_64")
    expected = WslHostTools(FakeLauncher(), probe, probe.home)
    native_home = tmp_path / "native-home"
    native_home.mkdir()
    starts: list[tuple[Path, WslProbe]] = []
    monkeypatch.setenv("HUDDOL_WORKING_DIRECTORY", str(tmp_path / "startup"))
    monkeypatch.setattr(wsl_host_tools.Path, "home", lambda: native_home)
    monkeypatch.setattr(wsl_host_tools.os, "name", "nt")
    monkeypatch.setattr(wsl_host_tools, "probe_wsl", lambda: probe)
    monkeypatch.setattr(
        WslHostTools,
        "start",
        classmethod(
            lambda cls, home, active_probe, **_kwargs: (
                starts.append((home, active_probe)) or expected
            )
        ),
    )
    monkeypatch.setattr(wsl_host_tools, "_log_selected", lambda tools: None)

    tools, settings = wsl_host_tools.create_host_tools("wsl")

    assert tools is expected
    assert tools.working_directory == probe.home
    assert starts == [(native_home, probe)]
    assert settings.settings()["selected_backend"] == "wsl"
    assert settings.settings()["wsl_distribution"] == "Debian"


def test_create_host_tools_falls_back_when_wsl_start_fails(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    saved: list[tuple[str, tuple[str, ...]]] = []
    probe = WslProbe("Debian", "/home/ada", "x86_64")
    launcher = FakeLauncher()
    native_home = tmp_path / "native-home"
    native_home.mkdir()
    roots: list[Path] = []
    monkeypatch.setattr(wsl_host_tools.Path, "home", lambda: native_home)
    monkeypatch.setattr(wsl_host_tools.os, "name", "nt")
    monkeypatch.setattr(wsl_host_tools, "probe_wsl", lambda: probe)
    monkeypatch.setattr(
        WslHostTools,
        "start",
        classmethod(
            lambda cls, home, active_probe, **_kwargs: (_ for _ in ()).throw(
                HostToolError("cannot use WSL home")
            )
        ),
    )
    monkeypatch.setattr(
        wsl_host_tools,
        "HostTools",
        lambda root, **_kwargs: roots.append(root) or launcher,
    )
    monkeypatch.setattr(wsl_host_tools, "_log_selected", lambda tools: None)

    tools, settings = wsl_host_tools.create_host_tools(
        "wsl",
        on_configure=lambda backend, paths: saved.append((backend, paths)),
    )

    assert tools is launcher
    assert roots == [native_home]
    assert saved == [("native", ())]
    assert settings.settings()["selected_backend"] == "native"
    assert settings.settings()["wsl_available"] is False


def test_create_host_tools_falls_back_to_native_home_when_wsl_is_unavailable(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    saved: list[tuple[str, tuple[str, ...]]] = []
    native_home = tmp_path / "native-home"
    native_home.mkdir()
    roots: list[Path] = []
    monkeypatch.setattr(wsl_host_tools.Path, "home", lambda: native_home)
    monkeypatch.setattr(wsl_host_tools.os, "name", "nt")
    monkeypatch.setattr(
        wsl_host_tools,
        "probe_wsl",
        lambda: (_ for _ in ()).throw(HostToolError("unavailable")),
    )
    launcher = FakeLauncher()
    monkeypatch.setattr(
        wsl_host_tools,
        "HostTools",
        lambda root, **_kwargs: roots.append(root) or launcher,
    )
    monkeypatch.setattr(wsl_host_tools, "_log_selected", lambda tools: None)

    tools, settings = wsl_host_tools.create_host_tools(
        "wsl",
        on_configure=lambda backend, paths: saved.append((backend, paths)),
    )

    assert tools is launcher
    assert roots == [native_home]
    assert tools.execution_backend == "native"
    assert saved == [("native", ())]
    assert settings.settings()["selected_backend"] == "native"
    assert settings.settings()["wsl_available"] is False


def test_create_host_tools_uses_user_home_for_native_backend(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    native_home = tmp_path / "native-home"
    native_home.mkdir()
    monkeypatch.setenv("HUDDOL_WORKING_DIRECTORY", str(tmp_path / "startup"))
    monkeypatch.setattr(wsl_host_tools.Path, "home", lambda: native_home)
    monkeypatch.setattr(wsl_host_tools, "_log_selected", lambda tools: None)

    tools, settings = wsl_host_tools.create_host_tools("native")
    writable = tmp_path / "writable"
    writable.mkdir()

    updated = settings.configure("native", [str(writable)])

    assert tools.execution_backend == "native"
    assert tools.working_directory == str(native_home)
    assert tools.write_directories == (str(writable),)
    assert updated["active_backend"] == "native"
    assert updated["restart_required"] is False
