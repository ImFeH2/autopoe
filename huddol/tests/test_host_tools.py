from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
from pathlib import Path
from threading import Event, Thread

import psutil
import pytest

import huddol.host_tools as host_tools_module
from huddol.host_tools import (
    OWNER_ENV,
    HostToolError,
    ProcessWatcher,
    UnixProcessGroup,
)
from huddol.host_tools import (
    HostTools as BaseHostTools,
)
from huddol.write_access import macos_write_sandbox_command


class HostTools(BaseHostTools):
    def __init__(
        self,
        root: Path,
        output_limit: int = 65_536,
        process_owner: str | None = None,
        write_directories: list[str] | None = None,
    ) -> None:
        super().__init__(
            root,
            output_limit,
            process_owner,
            write_directories=(
                [str(root)] if write_directories is None else write_directories
            ),
        )


def wait_for_path(path: Path) -> None:
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        if path.exists():
            return
        time.sleep(0.01)
    raise AssertionError(f"Timed out waiting for {path}")


def process_exists(pid: int) -> bool:
    try:
        process = psutil.Process(pid)
        return process.status() != psutil.STATUS_ZOMBIE
    except psutil.NoSuchProcess:
        return False


def wait_for_process_exit(pid: int) -> None:
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline and process_exists(pid):
        time.sleep(0.01)
    assert not process_exists(pid)


@pytest.mark.skipif(os.name == "nt", reason="Unix process groups")
def test_unix_process_group_tolerates_permission_error_during_cleanup(
    monkeypatch,
) -> None:
    signals: list[int] = []
    cleaned: list[tuple[str, str]] = []

    def kill_process_group(process_group_id: int, sent_signal: int) -> None:
        assert process_group_id == 123
        signals.append(sent_signal)
        if sent_signal == 0:
            raise PermissionError(1, "Operation not permitted")

    monkeypatch.setattr(os, "killpg", kill_process_group)
    monkeypatch.setattr(
        host_tools_module,
        "terminate_marked_processes",
        lambda key, value: cleaned.append((key, value)),
    )

    UnixProcessGroup(123, "execution-id").terminate()

    assert signals == [signal.SIGTERM, 0, signal.SIGKILL]
    assert cleaned == [(host_tools_module.EXECUTION_ENV, "execution-id")]


def test_run_uses_launch_root_relative_cwd_without_shell(tmp_path: Path) -> None:
    nested = tmp_path / "nested"
    nested.mkdir()
    tools = HostTools(tmp_path)

    result = tools.run(
        [
            sys.executable,
            "-c",
            "import os,sys; print(os.getcwd()); print(sys.argv[1])",
            "$(echo not-a-shell)",
        ],
        cwd="nested",
    )

    assert result["exit_code"] == 0
    assert result["cwd"] == "nested"
    assert result["stdout"].splitlines() == [
        str(nested),
        "$(echo not-a-shell)",
    ]
    assert tools.execution_backend == "native"
    assert tools.working_directory == str(tmp_path)
    assert str(tmp_path) in tools.environment_context


def test_native_windows_environment_context_discloses_acl_exception(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tools = BaseHostTools(tmp_path, enforce_write_policy=False)
    monkeypatch.setattr(host_tools_module.os, "name", "nt")

    assert "writable by Everyone" in tools.environment_context


def test_run_timeout_terminates_the_process_tree(tmp_path: Path) -> None:
    child_pid = tmp_path / "child.pid"
    tools = HostTools(tmp_path)
    script = (
        "import pathlib,subprocess,sys,time; "
        "child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(60)']); "
        f"pathlib.Path({str(child_pid)!r}).write_text(str(child.pid)); "
        "time.sleep(60)"
    )

    result = tools.run([sys.executable, "-c", script], timeout_seconds=1)

    assert result["timed_out"] is True
    assert result["exit_code"] is not None
    wait_for_process_exit(int(child_pid.read_text()))


def test_close_terminates_running_commands_and_descendants(tmp_path: Path) -> None:
    parent_pid = tmp_path / "parent.pid"
    child_pid = tmp_path / "child.pid"
    tools = HostTools(tmp_path)
    started = Event()
    errors: list[BaseException] = []
    script = (
        "import os,pathlib,subprocess,sys,time; "
        f"pathlib.Path({str(parent_pid)!r}).write_text(str(os.getpid())); "
        "child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(60)']); "
        f"pathlib.Path({str(child_pid)!r}).write_text(str(child.pid)); "
        "time.sleep(60)"
    )

    def run() -> None:
        started.set()
        try:
            tools.run([sys.executable, "-c", script], timeout_seconds=60)
        except HostToolError as error:
            errors.append(error)

    thread = Thread(target=run)
    thread.start()
    assert started.wait(timeout=1)
    wait_for_path(parent_pid)
    wait_for_path(child_pid)

    tools.close()
    thread.join(timeout=5)

    assert not thread.is_alive()
    assert len(errors) == 1
    assert str(errors[0]) == "Host tools are stopped"
    wait_for_process_exit(int(parent_pid.read_text()))
    wait_for_process_exit(int(child_pid.read_text()))


def test_run_cleans_background_descendants_after_parent_exits(tmp_path: Path) -> None:
    child_pid = tmp_path / "background.pid"
    tools = HostTools(tmp_path)
    script = (
        "import os,pathlib,subprocess,sys; "
        "child=subprocess.Popen([sys.executable,'-c',"
        "'import signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(60)'],"
        "start_new_session=(os.name!='nt'),stdout=subprocess.DEVNULL,"
        "stderr=subprocess.DEVNULL); "
        f"pathlib.Path({str(child_pid)!r}).write_text(str(child.pid))"
    )

    result = tools.run([sys.executable, "-c", script])

    assert result["exit_code"] == 0
    wait_for_process_exit(int(child_pid.read_text()))


@pytest.mark.skipif(os.name == "nt", reason="Unix fallback watcher")
def test_process_watcher_cleans_detached_owner_process_on_eof(tmp_path: Path) -> None:
    tools = HostTools(tmp_path)
    watcher = ProcessWatcher(tools.process_owner)
    pid_path = tmp_path / "detached.pid"
    environment = os.environ.copy()
    environment[OWNER_ENV] = tools.process_owner
    detached = subprocess.Popen(
        [
            sys.executable,
            "-c",
            (
                "import os,pathlib,time; "
                f"pathlib.Path({str(pid_path)!r}).write_text(str(os.getpid())); "
                "time.sleep(60)"
            ),
        ],
        env=environment,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    wait_for_path(pid_path)

    watcher.close()

    detached.wait(timeout=5)
    wait_for_process_exit(detached.pid)


def test_run_bounds_stdout_and_stderr(tmp_path: Path) -> None:
    tools = HostTools(tmp_path, output_limit=64)

    result = tools.run(
        [
            sys.executable,
            "-c",
            "import sys; print('A'*100); print('B'*100, file=sys.stderr)",
        ]
    )

    assert result["stdout_truncated"] is True
    assert result["stderr_truncated"] is True
    assert "bytes omitted" in result["stdout"]
    assert "bytes omitted" in result["stderr"]


def test_run_rejects_invalid_direct_call_types(tmp_path: Path) -> None:
    tools = HostTools(tmp_path)

    with pytest.raises(HostToolError, match="argv"):
        tools.run("echo")  # type: ignore[arg-type]
    with pytest.raises(HostToolError, match="timeout_seconds"):
        tools.run(["echo"], timeout_seconds=True)
    with pytest.raises(HostToolError, match="cwd"):
        tools.run(["echo"], cwd=1)  # type: ignore[arg-type]


@pytest.mark.parametrize("code_point", [0xD800, 0xDCFF])
def test_run_rejects_non_utf8_argv_and_cwd(
    tmp_path: Path,
    code_point: int,
) -> None:
    tools = HostTools(tmp_path)
    value = chr(code_point)

    with pytest.raises(HostToolError, match="argv items must be valid UTF-8"):
        tools.run([value])
    with pytest.raises(HostToolError, match="argv items must be valid UTF-8"):
        tools.run([sys.executable, value])
    with pytest.raises(HostToolError, match="cwd must be valid UTF-8"):
        tools.run([sys.executable, "-c", "pass"], cwd=value)


@pytest.mark.parametrize("absolute", [False, True])
def test_run_accepts_cwd_outside_launch_root(
    tmp_path: Path,
    absolute: bool,
) -> None:
    outside = tmp_path.parent / f"{tmp_path.name}-outside-cwd"
    outside.mkdir()
    cwd = str(outside) if absolute else f"../{outside.name}"

    result = HostTools(tmp_path).run(
        [sys.executable, "-c", "import os; print(os.getcwd())"],
        cwd=cwd,
    )

    assert result["cwd"] == str(outside)
    assert result["stdout"].strip() == str(outside)


def test_edit_replaces_one_exact_match_and_preserves_mode(tmp_path: Path) -> None:
    target = tmp_path / "source.py"
    target.write_bytes(b"first\r\nold value\r\nlast\r\n")
    target.chmod(0o744)

    result = HostTools(tmp_path).edit(
        "source.py",
        "old value\r\n",
        "new value\r\n",
    )

    assert result == {
        "edited": True,
        "path": "source.py",
        "replacement_count": 1,
    }
    assert target.read_bytes() == b"first\r\nnew value\r\nlast\r\n"
    if os.name != "nt":
        assert target.stat().st_mode & 0o777 == 0o744


def test_edit_requires_a_unique_match_by_default(tmp_path: Path) -> None:
    target = tmp_path / "repeated.txt"
    target.write_text("same\nsame\n")

    with pytest.raises(HostToolError, match="found 2 matches"):
        HostTools(tmp_path).edit("repeated.txt", "same", "changed")

    assert target.read_text() == "same\nsame\n"


def test_edit_replace_all_changes_every_exact_match(tmp_path: Path) -> None:
    target = tmp_path / "repeated.txt"
    target.write_text("same\nsame\n")

    result = HostTools(tmp_path).edit(
        "repeated.txt",
        "same",
        "changed",
        replace_all=True,
    )

    assert result["replacement_count"] == 2
    assert target.read_text() == "changed\nchanged\n"


def test_edit_no_match_or_no_change_is_atomic(tmp_path: Path) -> None:
    target = tmp_path / "source.txt"
    target.write_text("current\n")

    with pytest.raises(HostToolError, match="not found"):
        HostTools(tmp_path).edit("source.txt", "missing", "changed")
    with pytest.raises(HostToolError, match="must differ"):
        HostTools(tmp_path).edit("source.txt", "current", "current")

    assert target.read_text() == "current\n"
    assert not list(tmp_path.glob(".*.huddol-*"))


def test_edit_write_failure_preserves_original_and_removes_temporary_file(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    target = tmp_path / "source.txt"
    target.write_text("before\n")

    def reject_replace(_source: Path, _target: Path) -> None:
        raise PermissionError("blocked")

    monkeypatch.setattr(os, "replace", reject_replace)

    with pytest.raises(HostToolError, match="Cannot write edit file"):
        HostTools(tmp_path).edit("source.txt", "before", "after")

    assert target.read_text() == "before\n"
    assert not list(tmp_path.glob(".*.huddol-*"))


def test_edit_rejects_invalid_inputs(tmp_path: Path) -> None:
    target = tmp_path / "source.txt"
    target.write_text("before\n")
    tools = HostTools(tmp_path)

    with pytest.raises(HostToolError, match="path must be a string"):
        tools.edit(None, "before", "after")  # type: ignore[arg-type]
    with pytest.raises(HostToolError, match="old_text must be a string"):
        tools.edit("source.txt", None, "after")  # type: ignore[arg-type]
    with pytest.raises(HostToolError, match="new_text must be a string"):
        tools.edit("source.txt", "before", None)  # type: ignore[arg-type]
    with pytest.raises(HostToolError, match="old_text is required"):
        tools.edit("source.txt", "", "after")
    with pytest.raises(HostToolError, match="replace_all must be a boolean"):
        tools.edit("source.txt", "before", "after", replace_all=1)  # type: ignore[arg-type]
    with pytest.raises(HostToolError, match="valid UTF-8"):
        tools.edit("source.txt", "before", "\ud800")

    assert target.read_text() == "before\n"


def test_edit_accepts_nul_and_large_text(tmp_path: Path) -> None:
    target = tmp_path / "source.txt"
    target.write_bytes(b"before\0after")
    replacement = "x" * 262_145 + "\0done"

    result = HostTools(tmp_path).edit(
        "source.txt",
        "before\0after",
        replacement,
    )

    assert result["replacement_count"] == 1
    assert target.read_bytes() == replacement.encode()


@pytest.mark.parametrize(
    "path",
    [
        "../outside.txt",
        ".env",
        ".ENV.LOCAL",
        "nested/.env.production",
    ],
)
def test_edit_accepts_previously_protected_paths(tmp_path: Path, path: str) -> None:
    target = (tmp_path / path).resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("before\n")

    HostTools(
        tmp_path,
        write_directories=[str(target.parent)],
    ).edit(path, "before", "after")

    assert target.read_text() == "after\n"


def test_edit_accepts_absolute_paths_and_rejects_missing_or_directory_paths(
    tmp_path: Path,
) -> None:
    outside = tmp_path.parent / f"{tmp_path.name}-absolute.txt"
    outside.write_text("before\n")
    directory = tmp_path / "folder"
    directory.mkdir()

    result = HostTools(
        tmp_path,
        write_directories=[str(outside.parent)],
    ).edit(str(outside), "before", "after")

    assert result["path"] == str(outside)
    assert outside.read_text() == "after\n"
    with pytest.raises(HostToolError, match="existing file"):
        HostTools(tmp_path).edit("missing.txt", "before", "after")
    with pytest.raises(HostToolError, match="existing file"):
        HostTools(tmp_path).edit("folder", "before", "after")


def test_edit_rejects_non_utf8_files(tmp_path: Path) -> None:
    invalid_utf8 = tmp_path / "invalid.dat"
    invalid_utf8.write_bytes(b"before\xffafter")

    with pytest.raises(HostToolError, match="UTF-8 text file"):
        HostTools(tmp_path).edit("invalid.dat", "before", "after")


@pytest.mark.skipif(os.name == "nt", reason="Windows symlink privilege")
def test_edit_follows_symbolic_links_outside_launch_root(tmp_path: Path) -> None:
    outside = tmp_path.parent / f"{tmp_path.name}-outside"
    outside.mkdir()
    target = outside / "file.txt"
    target.write_text("before\n")
    link = tmp_path / "link"
    link.symlink_to(outside, target_is_directory=True)

    result = HostTools(
        tmp_path,
        write_directories=[str(outside)],
    ).edit("link/file.txt", "before", "after")

    assert result["path"] == str(target)
    assert link.is_symlink()
    assert target.read_text() == "after\n"


def test_edit_rejects_symbolic_link_outside_writable_directories(
    tmp_path: Path,
) -> None:
    outside = tmp_path.parent / f"{tmp_path.name}-denied"
    outside.mkdir()
    target = outside / "file.txt"
    target.write_text("before\n")
    (tmp_path / "link").symlink_to(outside, target_is_directory=True)

    with pytest.raises(HostToolError, match="configured writable directories"):
        HostTools(tmp_path).edit("link/file.txt", "before", "after")

    assert target.read_text() == "before\n"


def test_empty_write_directories_make_run_and_edit_read_only(tmp_path: Path) -> None:
    target = tmp_path / "source.txt"
    target.write_text("before\n")
    tools = HostTools(tmp_path, write_directories=[])

    result = tools.run(
        [
            sys.executable,
            "-c",
            "import pathlib; pathlib.Path('created.txt').write_text('blocked')",
        ]
    )

    assert result["exit_code"] != 0
    assert not (tmp_path / "created.txt").exists()
    with pytest.raises(HostToolError, match="configured writable directories"):
        tools.edit("source.txt", "before", "after")
    assert target.read_text() == "before\n"


def test_write_directory_updates_apply_to_each_run_and_edit(tmp_path: Path) -> None:
    writable = tmp_path / "writable"
    writable.mkdir()
    target = writable / "source.txt"
    target.write_text("before\n")
    tools = BaseHostTools(tmp_path, write_directories=[])
    command = [
        sys.executable,
        "-c",
        "import pathlib; pathlib.Path('created.txt').write_text('written')",
    ]

    tools.configure_write_directories((str(writable),))

    allowed = tools.run(command, cwd=str(writable))
    tools.edit(str(target), "before", "after")
    assert allowed["exit_code"] == 0
    assert (writable / "created.txt").read_text() == "written"
    assert target.read_text() == "after\n"

    tools.configure_write_directories(())

    denied = tools.run(command, cwd=str(writable))
    assert denied["exit_code"] != 0
    with pytest.raises(HostToolError, match="configured writable directories"):
        tools.edit(str(target), "after", "again")
    assert target.read_text() == "after\n"


@pytest.mark.skipif(
    not sys.platform.startswith("linux"),
    reason="Linux Bubblewrap",
)
def test_linux_run_writes_only_configured_directories(tmp_path: Path) -> None:
    allowed = tmp_path / "allowed"
    outside = tmp_path / "outside"
    allowed.mkdir()
    outside.mkdir()
    tools = BaseHostTools(tmp_path, write_directories=[str(allowed)])

    result = tools.run(
        [
            sys.executable,
            "-c",
            (
                "import pathlib,sys; "
                "pathlib.Path(sys.argv[1]).write_text('allowed'); "
                "\ntry: pathlib.Path(sys.argv[2]).write_text('outside')"
                "\nexcept OSError: raise SystemExit(0)"
                "\nraise SystemExit(1)"
            ),
            str(allowed / "created.txt"),
            str(outside / "created.txt"),
        ]
    )

    assert result["exit_code"] == 0
    assert (allowed / "created.txt").read_text() == "allowed"
    assert not (outside / "created.txt").exists()


@pytest.mark.skipif(os.name != "nt", reason="Windows restricted token")
def test_windows_run_writes_only_configured_directories(tmp_path: Path) -> None:
    allowed = tmp_path / "allowed"
    outside = tmp_path / "outside"
    allowed.mkdir()
    outside.mkdir()
    existing = allowed / "existing.txt"
    existing.write_text("before")
    tools = BaseHostTools(tmp_path, write_directories=[str(allowed)])
    sid = tools._write_access._windows.sid

    try:
        result = tools.run(
            [
                sys.executable,
                "-c",
                (
                    "import pathlib,sys; "
                    "pathlib.Path(sys.argv[1]).write_text('after'); "
                    "\ntry: pathlib.Path(sys.argv[2]).write_text('outside')"
                    "\nexcept OSError: raise SystemExit(0)"
                    "\nraise SystemExit(1)"
                ),
                str(existing),
                str(outside / "created.txt"),
            ]
        )
    finally:
        tools.close()

    assert result["exit_code"] == 0
    assert existing.read_text() == "after"
    assert not (outside / "created.txt").exists()
    acl = subprocess.run(
        ["icacls", str(allowed)],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    assert sid not in acl


@pytest.mark.skipif(sys.platform != "darwin", reason="macOS Seatbelt")
def test_macos_run_writes_only_configured_directories(tmp_path: Path) -> None:
    allowed = tmp_path / "allowed"
    outside = tmp_path / "outside"
    allowed.mkdir()
    outside.mkdir()
    tools = BaseHostTools(tmp_path, write_directories=[str(allowed)])

    result = tools.run(
        [
            sys.executable,
            "-c",
            (
                "import pathlib,sys; "
                "pathlib.Path(sys.argv[1]).write_text('allowed'); "
                "\ntry: pathlib.Path(sys.argv[2]).write_text('outside')"
                "\nexcept OSError: raise SystemExit(0)"
                "\nraise SystemExit(1)"
            ),
            str(allowed / "created.txt"),
            str(outside / "created.txt"),
        ]
    )

    assert result["exit_code"] == 0
    assert (allowed / "created.txt").read_text() == "allowed"
    assert not (outside / "created.txt").exists()


def test_macos_profile_denies_writes_outside_parameterized_roots(
    tmp_path: Path,
) -> None:
    allowed = tmp_path / 'quoted " directory'
    allowed.mkdir()

    command = macos_write_sandbox_command(
        ["printf", "%s", "literal"],
        [allowed],
    )

    assert command[:2] == ["/usr/bin/sandbox-exec", "-p"]
    assert "(allow default)" in command[2]
    assert "(deny file-write*" in command[2]
    assert '(require-not (subpath (param "WRITABLE_0")))' in command[2]
    assert f"-DWRITABLE_0={allowed}" in command
    assert command[-4:] == ["--", "printf", "%s", "literal"]


def test_close_waits_for_an_edit_already_writing(tmp_path: Path) -> None:
    target = tmp_path / "source.txt"
    target.write_text("before\n")
    writing = Event()
    release = Event()

    class ControlledEditTools(HostTools):
        def _write_edit(self, path: Path, content: bytes) -> None:
            writing.set()
            release.wait(timeout=2)
            super()._write_edit(path, content)

    tools = ControlledEditTools(tmp_path)
    errors: list[HostToolError] = []

    def edit() -> None:
        try:
            tools.edit("source.txt", "before", "after")
        except HostToolError as error:
            errors.append(error)

    edit_thread = Thread(target=edit)
    edit_thread.start()
    assert writing.wait(timeout=1)
    close_thread = Thread(target=tools.close)
    close_thread.start()
    time.sleep(0.1)
    assert close_thread.is_alive()
    release.set()
    edit_thread.join(timeout=2)
    close_thread.join(timeout=2)

    assert not edit_thread.is_alive()
    assert not close_thread.is_alive()
    assert errors == []
    assert target.read_text() == "after\n"
    with pytest.raises(HostToolError, match="stopped"):
        tools.edit("source.txt", "after", "again")
