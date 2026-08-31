from __future__ import annotations

import pytest

from huddol.adapters.sandbox.wsl import (
    WslProbe,
    normalize_wsl_directories,
    probe_wsl,
    to_posix_path,
    to_windows_path,
    wsl_command,
)
from huddol.adapters.sandbox.wsl_sandbox import WslSandbox
from huddol.core.errors import DomainError

DISTRO = "TestDistro"


def test_wsl_directories_accept_posix_paths_windows_would_reject() -> None:
    assert normalize_wsl_directories(["/workspace/app", "/mnt/d/work/project"]) == (
        "/workspace/app",
        "/mnt/d/work/project",
    )


def test_wsl_directories_reject_relative_and_traversing_paths() -> None:
    for value in ("relative/path", "/project/../etc", "   "):
        with pytest.raises(DomainError):
            normalize_wsl_directories([value])


def test_wsl_directories_deduplicate() -> None:
    assert normalize_wsl_directories(["/a", "/a", "/b"]) == ("/a", "/b")


@pytest.mark.parametrize(
    ("posix", "windows"),
    [
        ("/mnt/d/work/project", "D:\\work\\project"),
        ("/mnt/c/Users/Someone", "C:\\Users\\Someone"),
        ("/workspace/app", "\\\\wsl.localhost\\TestDistro\\workspace\\app"),
        ("/home/me/notes.md", "\\\\wsl.localhost\\TestDistro\\home\\me\\notes.md"),
    ],
)
def test_posix_paths_map_onto_windows(posix: str, windows: str) -> None:
    assert to_windows_path(posix, DISTRO) == windows


@pytest.mark.parametrize(
    ("windows", "posix"),
    [
        ("D:\\work\\project", "/mnt/d/work/project"),
        ("\\\\wsl.localhost\\TestDistro\\workspace\\app", "/workspace/app"),
    ],
)
def test_windows_paths_map_back_onto_posix(windows: str, posix: str) -> None:
    assert to_posix_path(windows) == posix


def test_drive_mapping_round_trips() -> None:
    original = "/mnt/d/work/project"
    assert to_posix_path(to_windows_path(original, DISTRO)) == original


def test_untranslatable_paths_are_rejected() -> None:
    with pytest.raises(DomainError):
        to_posix_path("relative\\path")
    with pytest.raises(DomainError):
        to_windows_path("relative/path", DISTRO)


def test_wsl_command_runs_bubblewrap_inside_the_distribution() -> None:
    command = wsl_command(
        ["ls"], "/workspace/app", ["/workspace/app/deep", "/project"], DISTRO
    )
    assert command[:4] == ["wsl.exe", "-d", DISTRO, "--"]
    assert "/usr/bin/bwrap" in command
    for flag in ("--new-session", "--die-with-parent", "--unshare-user"):
        assert flag in command
    assert command[-3:] == ["--cap-drop", "ALL", "--"] or command[-1] == "ls"
    assert command.index("/project") < command.index("/workspace/app/deep")


def test_wsl_sandbox_describes_the_distribution_and_mounts() -> None:
    sandbox = WslSandbox("/workspace/app", ["/workspace/app"], WslProbe(DISTRO))
    description = sandbox.describe_environment()
    assert DISTRO in description
    assert "/mnt/<drive-letter>" in description
    assert "/workspace/app" in description


def test_wsl_sandbox_refuses_edits_outside_the_writable_roots() -> None:
    sandbox = WslSandbox("/workspace/app", ["/workspace/app"], WslProbe(DISTRO))
    with pytest.raises(DomainError) as error:
        sandbox.edit("/etc/passwd", "root", "hacked")
    assert error.value.code == "not_writable"


def test_wsl_sandbox_tolerates_unusable_configuration() -> None:
    sandbox = WslSandbox(
        "/workspace/app",
        ["/workspace/app", "not-absolute"],
        WslProbe(DISTRO),
        tolerant=True,
    )
    assert sandbox.write_directories == ("/workspace/app",)
    assert sandbox.skipped == (("not-absolute", "invalid_directory"),)


def test_probe_returns_none_when_wsl_is_unavailable() -> None:
    assert probe_wsl(lambda: "") is None

    def explode() -> str:
        raise OSError("wsl.exe missing")

    assert probe_wsl(explode) is None


def test_probe_reports_the_first_distribution() -> None:
    found = probe_wsl(lambda: "TestDistro")
    assert found is not None
    assert found.distribution == "TestDistro"


def _stores(tmp_path):
    from huddol.adapters.sqlite.agent import SqliteAgentStore
    from huddol.adapters.sqlite.store import SqliteStore

    store = SqliteStore(tmp_path / "huddol.sqlite3")
    return store, SqliteAgentStore(store._db)


def test_wsl_backend_is_used_when_a_distribution_is_available(tmp_path) -> None:
    from huddol.__main__ import _build_sandbox

    store, agent_store = _stores(tmp_path)
    agent_store.set_settings("execution", {"backend": "wsl"})
    agent_store.set_write_directories(["/workspace/app"])

    sandbox = _build_sandbox(agent_store, probe=WslProbe(DISTRO))
    assert type(sandbox).__name__ == "WslSandbox"
    assert sandbox.write_directories == ("/workspace/app",)
    store.close()


def test_backend_falls_back_to_native_when_wsl_is_missing(tmp_path) -> None:
    from huddol.__main__ import _build_sandbox

    store, agent_store = _stores(tmp_path)
    agent_store.set_settings("execution", {"backend": "wsl"})
    agent_store.set_write_directories(["/workspace/app"])

    sandbox = _build_sandbox(agent_store, probe=None)
    assert type(sandbox).__name__ == "NativeSandbox"
    store.close()


def test_native_backend_is_chosen_by_default(tmp_path) -> None:
    from huddol.__main__ import _build_sandbox

    store, agent_store = _stores(tmp_path)
    sandbox = _build_sandbox(agent_store, probe=WslProbe(DISTRO))
    assert type(sandbox).__name__ == "NativeSandbox"
    store.close()
