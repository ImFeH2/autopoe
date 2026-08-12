from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path
from threading import Event, Thread

import psutil
import pytest

from flowent.host_tools import OWNER_ENV, HostToolError, HostTools, ProcessWatcher


def git(root: Path, *arguments: str) -> str:
    result = subprocess.run(
        ["git", *arguments],
        cwd=root,
        check=True,
        stdout=subprocess.PIPE,
        text=True,
    )
    return result.stdout


def initialize_repository(root: Path) -> None:
    git(root, "init", "-q")
    git(root, "config", "user.email", "test@example.invalid")
    git(root, "config", "user.name", "Test")


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


def test_exec_uses_launch_root_relative_cwd_without_shell(tmp_path: Path) -> None:
    nested = tmp_path / "nested"
    nested.mkdir()
    tools = HostTools(tmp_path)

    result = tools.exec(
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


def test_exec_timeout_terminates_the_process_tree(tmp_path: Path) -> None:
    child_pid = tmp_path / "child.pid"
    tools = HostTools(tmp_path)
    script = (
        "import pathlib,subprocess,sys,time; "
        "child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(60)']); "
        f"pathlib.Path({str(child_pid)!r}).write_text(str(child.pid)); "
        "time.sleep(60)"
    )

    result = tools.exec([sys.executable, "-c", script], timeout_seconds=1)

    assert result["timed_out"] is True
    assert result["exit_code"] is not None
    pid = int(child_pid.read_text())
    wait_for_process_exit(pid)


def test_close_terminates_running_commands_and_descendants(tmp_path: Path) -> None:
    parent_pid = tmp_path / "parent.pid"
    child_pid = tmp_path / "child.pid"
    tools = HostTools(tmp_path)
    started = Event()
    result: list[BaseException] = []
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
            tools.exec([sys.executable, "-c", script], timeout_seconds=60)
        except HostToolError as error:
            result.append(error)

    thread = Thread(target=run)
    thread.start()
    assert started.wait(timeout=1)
    wait_for_path(parent_pid)
    wait_for_path(child_pid)

    tools.close()
    thread.join(timeout=5)

    assert not thread.is_alive()
    assert len(result) == 1
    assert isinstance(result[0], HostToolError)
    assert str(result[0]) == "Host tools are stopped"
    wait_for_process_exit(int(parent_pid.read_text()))
    wait_for_process_exit(int(child_pid.read_text()))


def test_exec_cleans_background_descendants_after_parent_exits(tmp_path: Path) -> None:
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

    result = tools.exec([sys.executable, "-c", script])

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


def test_protected_process_survives_owner_death(tmp_path: Path) -> None:
    started = tmp_path / "protected.pid"
    completed = tmp_path / "protected.completed"
    child_script = (
        "import pathlib,time; "
        "time.sleep(0.75); "
        f"pathlib.Path({str(completed)!r}).write_text('done')"
    )
    owner_script = (
        "import pathlib,subprocess,sys,time; "
        "from flowent.host_tools import HostTools; "
        "root=pathlib.Path.cwd(); "
        "tools=HostTools(root); "
        "managed=tools._start_process("
        "[sys.executable,'-c',"
        f"{child_script!r}],"
        "cwd=root,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,"
        "stderr=subprocess.DEVNULL,error_prefix='Cannot start protected process',"
        "protected=True); "
        f"pathlib.Path({str(started)!r}).write_text(str(managed.process.pid)); "
        "time.sleep(60)"
    )
    owner = subprocess.Popen(
        [sys.executable, "-c", owner_script],
        cwd=tmp_path,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    child_pid: int | None = None

    try:
        wait_for_path(started)
        child_pid = int(started.read_text())
        owner.kill()
        owner.wait(timeout=5)

        wait_for_path(completed)
        wait_for_process_exit(child_pid)
    finally:
        if owner.poll() is None:
            owner.kill()
            owner.wait(timeout=5)
        if child_pid is not None and process_exists(child_pid):
            psutil.Process(child_pid).kill()


def test_exec_bounds_stdout_and_stderr(tmp_path: Path) -> None:
    tools = HostTools(tmp_path, output_limit=64)

    result = tools.exec(
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


def test_exec_rejects_invalid_direct_call_types(tmp_path: Path) -> None:
    tools = HostTools(tmp_path)

    with pytest.raises(HostToolError, match="argv"):
        tools.exec("echo")  # type: ignore[arg-type]
    with pytest.raises(HostToolError, match="timeout_seconds"):
        tools.exec(["echo"], timeout_seconds=True)
    with pytest.raises(HostToolError, match="cwd"):
        tools.exec(["echo"], cwd=1)  # type: ignore[arg-type]
    with pytest.raises(HostToolError, match="diff"):
        tools.patch(None)  # type: ignore[arg-type]
    with pytest.raises(HostToolError, match="valid UTF-8"):
        tools.patch("\ud800")


@pytest.mark.parametrize("code_point", [0xD800, 0xDCFF])
def test_exec_rejects_non_utf8_argv_and_cwd(
    tmp_path: Path,
    code_point: int,
) -> None:
    tools = HostTools(tmp_path)
    value = chr(code_point)

    with pytest.raises(HostToolError, match="argv items must be valid UTF-8"):
        tools.exec([value])
    with pytest.raises(HostToolError, match="argv items must be valid UTF-8"):
        tools.exec([sys.executable, value])
    with pytest.raises(HostToolError, match="cwd must be valid UTF-8"):
        tools.exec([sys.executable, "-c", "pass"], cwd=value)


def test_exec_rejects_cwd_outside_launch_root(tmp_path: Path) -> None:
    tools = HostTools(tmp_path)

    with pytest.raises(HostToolError, match="stay within"):
        tools.exec([sys.executable, "-c", "pass"], cwd="../outside")


@pytest.mark.skipif(os.name == "nt", reason="Unix executable and process assertion")
def test_close_terminates_running_patch_process(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    initialize_repository(tmp_path)
    binary_directory = tmp_path / "bin"
    binary_directory.mkdir()
    pid_path = tmp_path / "git.pid"
    fake_git = binary_directory / "git"
    fake_git.write_text(f"#!/bin/sh\nprintf '%s' \"$$\" > {pid_path}\nsleep 60\n")
    fake_git.chmod(0o755)
    monkeypatch.setenv("PATH", f"{binary_directory}{os.pathsep}{os.environ['PATH']}")
    tools = HostTools(tmp_path)
    errors: list[HostToolError] = []
    diff = """diff --git a/file.txt b/file.txt
new file mode 100644
--- /dev/null
+++ b/file.txt
@@ -0,0 +1 @@
+content
"""

    def apply() -> None:
        try:
            tools.patch(diff)
        except HostToolError as error:
            errors.append(error)

    thread = Thread(target=apply)
    thread.start()
    wait_for_path(pid_path)
    pid = int(pid_path.read_text())

    tools.close()
    thread.join(timeout=5)

    assert not thread.is_alive()
    assert errors and str(errors[0]) == "Host tools are stopped"
    wait_for_process_exit(pid)
    assert not (tmp_path / "file.txt").exists()


def test_numstat_parser_supports_standard_rename_encoding(tmp_path: Path) -> None:
    tools = HostTools(tmp_path)

    assert tools._parse_numstat_paths(b"0\t0\t\0old name.txt\0new name.txt\0") == [
        "old name.txt",
        "new name.txt",
    ]


def test_patch_creates_modifies_deletes_and_renames_files(tmp_path: Path) -> None:
    initialize_repository(tmp_path)
    (tmp_path / "modify.txt").write_text("before\n")
    (tmp_path / "delete.txt").write_text("delete\n")
    (tmp_path / "rename.txt").write_text("rename\n")
    git(tmp_path, "add", ".")
    git(tmp_path, "commit", "-qm", "initial")

    work = tmp_path / "work"
    subprocess.run(
        ["git", "clone", "-q", str(tmp_path), str(work)],
        check=True,
    )
    (work / "modify.txt").write_text("after\n")
    (work / "delete.txt").unlink()
    (work / "created.txt").write_text("created\n")
    git(work, "mv", "rename.txt", "renamed.txt")
    git(work, "add", "-A")
    diff = git(work, "diff", "--cached", "-M", "--binary")

    result = HostTools(tmp_path).patch(diff)

    assert result["applied"] is True
    assert set(result["paths"]) == {
        "created.txt",
        "delete.txt",
        "modify.txt",
        "rename.txt",
        "renamed.txt",
    }
    assert (tmp_path / "created.txt").read_text() == "created\n"
    assert (tmp_path / "modify.txt").read_text() == "after\n"
    assert not (tmp_path / "delete.txt").exists()
    assert not (tmp_path / "rename.txt").exists()
    assert (tmp_path / "renamed.txt").read_text() == "rename\n"


@pytest.mark.parametrize("mode", ["120000", "160000"])
def test_patch_rejects_symlink_and_submodule_modes(tmp_path: Path, mode: str) -> None:
    initialize_repository(tmp_path)
    diff = f"""diff --git a/special b/special
new file mode {mode}
index 0000000..1111111
--- /dev/null
+++ b/special
@@ -0,0 +1 @@
+target
"""

    with pytest.raises(HostToolError, match="Symlink and submodule"):
        HostTools(tmp_path).patch(diff)

    assert not (tmp_path / "special").exists()


def test_close_waits_for_final_patch_mutation(tmp_path: Path) -> None:
    first = tmp_path / "first.txt"
    second = tmp_path / "second.txt"
    first.write_text("before\n")
    second.write_text("before\n")
    mutation_started = tmp_path / "mutation-started"

    class ControlledPatchTools(HostTools):
        def _reject_submodule_paths(self, paths: list[str]) -> None:
            del paths

        def _git_apply(
            self,
            arguments: list[str],
            diff: bytes,
            *,
            protected: bool = False,
            timeout: float | None = 30,
        ) -> subprocess.CompletedProcess[bytes]:
            del diff
            if "--numstat" in arguments:
                return subprocess.CompletedProcess(
                    arguments,
                    0,
                    b"1\t1\tfirst.txt\x001\t1\tsecond.txt\x00",
                    b"",
                )
            if "--check" in arguments:
                return subprocess.CompletedProcess(arguments, 0, b"", b"")
            script = (
                "import pathlib,time; "
                f"pathlib.Path({str(first)!r}).write_text('after\\n'); "
                f"pathlib.Path({str(mutation_started)!r}).touch(); "
                "time.sleep(0.5); "
                f"pathlib.Path({str(second)!r}).write_text('after\\n')"
            )
            return self._git_command(
                [sys.executable, "-c", script],
                protected=protected,
                timeout=timeout,
            )

    tools = ControlledPatchTools(tmp_path)
    errors: list[HostToolError] = []
    diff = """diff --git a/first.txt b/first.txt
--- a/first.txt
+++ b/first.txt
@@ -1 +1 @@
-before
+after
diff --git a/second.txt b/second.txt
--- a/second.txt
+++ b/second.txt
@@ -1 +1 @@
-before
+after
"""

    def apply_patch() -> None:
        try:
            tools.patch(diff)
        except HostToolError as error:
            errors.append(error)

    patch_thread = Thread(target=apply_patch)
    patch_thread.start()
    wait_for_path(mutation_started)
    close_thread = Thread(target=tools.close)
    close_thread.start()
    time.sleep(0.1)
    assert close_thread.is_alive()
    patch_thread.join(timeout=5)
    close_thread.join(timeout=5)

    assert not patch_thread.is_alive()
    assert not close_thread.is_alive()
    assert errors == []
    assert first.read_text() == "after\n"
    assert second.read_text() == "after\n"


@pytest.mark.parametrize("existing", [False, True])
def test_patch_rejects_nul_content(tmp_path: Path, existing: bool) -> None:
    target = tmp_path / "binary.txt"
    if existing:
        target.write_text("before\n")
        header = "--- a/binary.txt\n+++ b/binary.txt\n@@ -1 +1 @@\n-before\n"
    else:
        header = (
            "new file mode 100644\n--- /dev/null\n+++ b/binary.txt\n@@ -0,0 +1 @@\n"
        )
    diff = f"diff --git a/binary.txt b/binary.txt\n{header}+abc\0def\n"

    with pytest.raises(HostToolError, match="Binary patches are not supported"):
        HostTools(tmp_path).patch(diff)

    if existing:
        assert target.read_text() == "before\n"
    else:
        assert not target.exists()


@pytest.mark.parametrize(
    "content",
    ["GIT binary patch", "Binary files source and target differ"],
)
def test_patch_allows_binary_marker_phrases_as_text(
    tmp_path: Path,
    content: str,
) -> None:
    diff = f"""diff --git a/notes.txt b/notes.txt
new file mode 100644
--- /dev/null
+++ b/notes.txt
@@ -0,0 +1 @@
+{content}
"""

    HostTools(tmp_path).patch(diff)

    assert (tmp_path / "notes.txt").read_text() == f"{content}\n"


def test_patch_rejects_real_binary_create(tmp_path: Path) -> None:
    initialize_repository(tmp_path)
    (tmp_path / "tracked.txt").write_text("tracked\n")
    git(tmp_path, "add", ".")
    git(tmp_path, "commit", "-qm", "initial")
    target = tmp_path / "binary.dat"
    target.write_bytes(bytes(range(256)) * 2)
    git(tmp_path, "add", "binary.dat")
    diff = git(tmp_path, "diff", "--cached", "--binary")
    git(tmp_path, "reset", "--hard", "-q", "HEAD")

    with pytest.raises(HostToolError, match="Binary patches are not supported"):
        HostTools(tmp_path).patch(diff)

    assert not target.exists()


def test_patch_conflict_is_atomic(tmp_path: Path) -> None:
    initialize_repository(tmp_path)
    target = tmp_path / "target.txt"
    target.write_text("current\n")
    diff = """diff --git a/target.txt b/target.txt
--- a/target.txt
+++ b/target.txt
@@ -1 +1 @@
-expected
+changed
"""

    with pytest.raises(HostToolError, match="does not apply"):
        HostTools(tmp_path).patch(diff)

    assert target.read_text() == "current\n"
    assert not list(tmp_path.glob("*.rej"))


@pytest.mark.parametrize("environment_file", [".env", ".ENV.LOCAL"])
def test_patch_rejects_environment_file_rename(
    tmp_path: Path,
    environment_file: str,
) -> None:
    initialize_repository(tmp_path)
    (tmp_path / environment_file).write_text("secret=local\n")
    git(tmp_path, "add", environment_file)
    git(tmp_path, "commit", "-qm", "initial")
    git(tmp_path, "mv", environment_file, "safe.txt")
    diff = git(tmp_path, "diff", "--cached", "-M", "--binary")
    git(tmp_path, "reset", "--hard", "-q", "HEAD")

    with pytest.raises(HostToolError, match="environment files"):
        HostTools(tmp_path).patch(diff)

    assert (tmp_path / environment_file).read_text() == "secret=local\n"
    assert not (tmp_path / "safe.txt").exists()


def test_patch_rejects_existing_submodule_worktree(tmp_path: Path) -> None:
    initialize_repository(tmp_path)
    child = tmp_path.parent / f"{tmp_path.name}-child"
    child.mkdir()
    initialize_repository(child)
    (child / "file.txt").write_text("before\n")
    git(child, "add", ".")
    git(child, "commit", "-qm", "child")
    subprocess.run(
        [
            "git",
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "add",
            "-q",
            str(child),
            "vendor/module",
        ],
        cwd=tmp_path,
        check=True,
    )
    readme = tmp_path / "vendor" / "readme.txt"
    readme.write_text("before\n")
    git(tmp_path, "add", "vendor/readme.txt")
    git(tmp_path, "commit", "-qm", "submodule")
    sibling_diff = """diff --git a/vendor/readme.txt b/vendor/readme.txt
--- a/vendor/readme.txt
+++ b/vendor/readme.txt
@@ -1 +1 @@
-before
+after
"""
    submodule_diff = """diff --git a/vendor/module/file.txt b/vendor/module/file.txt
--- a/vendor/module/file.txt
+++ b/vendor/module/file.txt
@@ -1 +1 @@
-before
+after
"""

    HostTools(tmp_path).patch(sibling_diff)
    with pytest.raises(HostToolError, match="Submodule patches are not supported"):
        HostTools(tmp_path).patch(submodule_diff)

    assert readme.read_text() == "after\n"
    assert (tmp_path / "vendor" / "module" / "file.txt").read_text() == "before\n"


@pytest.mark.skipif(os.name == "nt", reason="Colon is not a Windows filename")
def test_patch_rejects_pathspec_magic_submodule_name(tmp_path: Path) -> None:
    initialize_repository(tmp_path)
    child = tmp_path.parent / f"{tmp_path.name}-magic-child"
    child.mkdir()
    initialize_repository(child)
    (child / "file.txt").write_text("before\n")
    git(child, "add", ".")
    git(child, "commit", "-qm", "child")
    submodule = tmp_path / ":(literal)module"
    subprocess.run(
        ["git", "clone", "-q", str(child), str(submodule)],
        check=True,
    )
    commit = git(child, "rev-parse", "HEAD").strip()
    git(
        tmp_path,
        "update-index",
        "--add",
        "--cacheinfo",
        f"160000,{commit},:(literal)module",
    )
    git(tmp_path, "commit", "-qm", "magic submodule")
    diff = """diff --git a/:(literal)module/file.txt b/:(literal)module/file.txt
--- a/:(literal)module/file.txt
+++ b/:(literal)module/file.txt
@@ -1 +1 @@
-before
+after
"""

    with pytest.raises(HostToolError, match="Submodule patches are not supported"):
        HostTools(tmp_path).patch(diff)

    assert (submodule / "file.txt").read_text() == "before\n"


def test_patch_uses_launch_root_paths_inside_parent_repository(tmp_path: Path) -> None:
    initialize_repository(tmp_path)
    launch = tmp_path / "launch"
    launch.mkdir()
    binary = launch / "binary.dat"
    binary.write_bytes(b"before\0binary\n")
    git(tmp_path, "add", ".")
    git(tmp_path, "commit", "-qm", "binary")
    git(tmp_path, "mv", "launch/binary.dat", "launch/renamed.dat")
    parent_diff = git(tmp_path, "diff", "--cached", "-M", "--binary")
    git(tmp_path, "reset", "--hard", "-q", "HEAD")
    launch_diff = """diff --git a/readme.txt b/readme.txt
new file mode 100644
--- /dev/null
+++ b/readme.txt
@@ -0,0 +1 @@
+launch root
"""

    with pytest.raises(HostToolError, match="Patch does not apply"):
        HostTools(launch).patch(parent_diff)
    result = HostTools(launch).patch(launch_diff)

    assert binary.read_bytes() == b"before\0binary\n"
    assert not (launch / "renamed.dat").exists()
    assert result["paths"] == ["readme.txt"]
    assert (launch / "readme.txt").read_text() == "launch root\n"


def test_patch_rejects_parent_repository_submodule_inside_launch_root(
    tmp_path: Path,
) -> None:
    initialize_repository(tmp_path)
    launch = tmp_path / "launch"
    launch.mkdir()
    child = tmp_path.parent / f"{tmp_path.name}-nested-child"
    child.mkdir()
    initialize_repository(child)
    (child / "file.txt").write_text("before\n")
    git(child, "add", ".")
    git(child, "commit", "-qm", "child")
    subprocess.run(
        [
            "git",
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "add",
            "-q",
            str(child),
            "launch/vendor/module",
        ],
        cwd=tmp_path,
        check=True,
    )
    git(tmp_path, "commit", "-qam", "nested submodule")
    diff = """diff --git a/vendor/module/file.txt b/vendor/module/file.txt
--- a/vendor/module/file.txt
+++ b/vendor/module/file.txt
@@ -1 +1 @@
-before
+after
"""

    with pytest.raises(HostToolError, match="Submodule patches are not supported"):
        HostTools(launch).patch(diff)

    assert (launch / "vendor" / "module" / "file.txt").read_text() == "before\n"


def test_patch_rejects_binary_rename(tmp_path: Path) -> None:
    initialize_repository(tmp_path)
    original = tmp_path / "binary.dat"
    original.write_bytes(b"before\0binary\n")
    git(tmp_path, "add", ".")
    git(tmp_path, "commit", "-qm", "binary")
    git(tmp_path, "mv", "binary.dat", "renamed.dat")
    diff = git(tmp_path, "diff", "--cached", "-M", "--binary")
    git(tmp_path, "reset", "--hard", "-q", "HEAD")

    with pytest.raises(HostToolError, match="Binary files are not supported"):
        HostTools(tmp_path).patch(diff)

    assert original.read_bytes() == b"before\0binary\n"
    assert not (tmp_path / "renamed.dat").exists()


@pytest.mark.skipif(os.name == "nt", reason="Windows symlink privilege")
def test_patch_rejects_symbolic_link_escape(tmp_path: Path) -> None:
    initialize_repository(tmp_path)
    outside = tmp_path.parent / f"{tmp_path.name}-outside"
    outside.mkdir()
    (outside / "file.txt").write_text("outside\n")
    (tmp_path / "link").symlink_to(outside, target_is_directory=True)
    diff = """diff --git a/link/file.txt b/link/file.txt
--- a/link/file.txt
+++ b/link/file.txt
@@ -1 +1 @@
-outside
+changed
"""

    with pytest.raises(HostToolError, match="Symlink patches are not supported"):
        HostTools(tmp_path).patch(diff)

    assert (outside / "file.txt").read_text() == "outside\n"
