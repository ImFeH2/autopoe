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

DISTRO = "Debian"


def test_wsl_directories_accept_posix_paths_windows_would_reject() -> None:
    assert normalize_wsl_directories(["/project/huddol", "/mnt/f/Project/huddol"]) == (
        "/project/huddol",
        "/mnt/f/Project/huddol",
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
        ("/mnt/f/Project/huddol", "F:\\Project\\huddol"),
        ("/mnt/c/Users/Someone", "C:\\Users\\Someone"),
        ("/project/huddol", "\\\\wsl.localhost\\Debian\\project\\huddol"),
        ("/home/me/notes.md", "\\\\wsl.localhost\\Debian\\home\\me\\notes.md"),
    ],
)
def test_posix_paths_map_onto_windows(posix: str, windows: str) -> None:
    assert to_windows_path(posix, DISTRO) == windows


@pytest.mark.parametrize(
    ("windows", "posix"),
    [
        ("F:\\Project\\huddol", "/mnt/f/Project/huddol"),
        ("\\\\wsl.localhost\\Debian\\project\\huddol", "/project/huddol"),
    ],
)
def test_windows_paths_map_back_onto_posix(windows: str, posix: str) -> None:
    assert to_posix_path(windows) == posix


def test_drive_mapping_round_trips() -> None:
    original = "/mnt/f/Project/huddol"
    assert to_posix_path(to_windows_path(original, DISTRO)) == original


def test_untranslatable_paths_are_rejected() -> None:
    with pytest.raises(DomainError):
        to_posix_path("relative\\path")
    with pytest.raises(DomainError):
        to_windows_path("relative/path", DISTRO)


def test_wsl_command_runs_bubblewrap_inside_the_distribution() -> None:
    command = wsl_command(
        ["ls"], "/project/huddol", ["/project/huddol/deep", "/project"], DISTRO
    )
    assert command[:4] == ["wsl.exe", "-d", DISTRO, "--"]
    assert "/usr/bin/bwrap" in command
    for flag in ("--new-session", "--die-with-parent", "--unshare-user"):
        assert flag in command
    assert command[-3:] == ["--cap-drop", "ALL", "--"] or command[-1] == "ls"
    assert command.index("/project") < command.index("/project/huddol/deep")


def test_wsl_sandbox_describes_the_distribution_and_mounts() -> None:
    sandbox = WslSandbox("/project/huddol", ["/project/huddol"], WslProbe(DISTRO))
    description = sandbox.describe_environment()
    assert DISTRO in description
    assert "/mnt/<drive-letter>" in description
    assert "/project/huddol" in description


def test_wsl_sandbox_refuses_edits_outside_the_writable_roots() -> None:
    sandbox = WslSandbox("/project/huddol", ["/project/huddol"], WslProbe(DISTRO))
    with pytest.raises(DomainError) as error:
        sandbox.edit("/etc/passwd", "root", "hacked")
    assert error.value.code == "not_writable"


def test_wsl_sandbox_tolerates_unusable_configuration() -> None:
    sandbox = WslSandbox(
        "/project/huddol",
        ["/project/huddol", "not-absolute"],
        WslProbe(DISTRO),
        tolerant=True,
    )
    assert sandbox.write_directories == ("/project/huddol",)
    assert sandbox.skipped == (("not-absolute", "invalid_directory"),)


def test_probe_returns_none_when_wsl_is_unavailable() -> None:
    assert probe_wsl(lambda: "") is None

    def explode() -> str:
        raise OSError("wsl.exe missing")

    assert probe_wsl(explode) is None


def test_probe_reports_the_first_distribution() -> None:
    found = probe_wsl(lambda: "Debian")
    assert found is not None
    assert found.distribution == "Debian"


def test_backend_selection_falls_back_when_wsl_is_missing(tmp_path) -> None:
    from huddol.__main__ import _build_sandbox
    from huddol.adapters.sqlite.agent import SqliteAgentStore
    from huddol.adapters.sqlite.store import SqliteStore

    store = SqliteStore(tmp_path / "huddol.sqlite3")
    agent_store = SqliteAgentStore(store._db)
    agent_store.set_settings("execution", {"backend": "wsl"})
    agent_store.set_write_directories(["/project/huddol"])

    sandbox = _build_sandbox(agent_store)
    assert type(sandbox).__name__ in {"WslSandbox", "NativeSandbox"}
    if type(sandbox).__name__ == "NativeSandbox":
        assert sandbox.write_directories == () or sandbox.skipped
    store.close()


def test_native_backend_is_chosen_by_default(tmp_path) -> None:
    from huddol.__main__ import _build_sandbox
    from huddol.adapters.sqlite.agent import SqliteAgentStore
    from huddol.adapters.sqlite.store import SqliteStore

    store = SqliteStore(tmp_path / "huddol.sqlite3")
    agent_store = SqliteAgentStore(store._db)
    sandbox = _build_sandbox(agent_store)
    assert type(sandbox).__name__ == "NativeSandbox"
    store.close()
