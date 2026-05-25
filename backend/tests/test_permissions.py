from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from flowent.main import create_app
from flowent.permissions import WritablePathDecision, run_tool_with_path_permissions
from flowent.sandbox import CommandResult, SandboxRunner
from flowent.storage import StateStore
from flowent.tools import ToolContext


def test_app_state_persists_writable_paths_across_app_instances(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.chdir(tmp_path)
    client = TestClient(create_app(serve_frontend=False))

    response = client.post(
        "/api/permissions/writable-paths",
        json={"path": "cache"},
    )

    assert response.status_code == 200
    restarted_client = TestClient(create_app(serve_frontend=False))
    state_response = restarted_client.get("/api/state")

    assert state_response.status_code == 200
    assert state_response.json()["writable_paths"][0]["path"] == str(tmp_path / "cache")
    assert isinstance(state_response.json()["writable_paths"][0]["created_at"], int)


def test_delete_writable_path_removes_permission(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.chdir(tmp_path)
    client = TestClient(create_app(serve_frontend=False))
    client.post("/api/permissions/writable-paths", json={"path": "cache"})

    response = client.request(
        "DELETE",
        "/api/permissions/writable-paths",
        json={"path": str(tmp_path / "cache")},
    )

    assert response.status_code == 200
    assert response.json() == {"writable_paths": []}


def test_writable_paths_are_saved_as_normalized_absolute_paths(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.chdir(tmp_path)
    store = StateStore()

    store.save_writable_path(Path("cache") / ".." / "cache")
    store.save_writable_path(tmp_path / "cache")

    writable_paths = store.read_writable_paths()

    assert [path.path for path in writable_paths] == [str(tmp_path / "cache")]


@pytest.mark.anyio
async def test_allow_once_runs_tool_with_declared_write_path(
    tmp_path, monkeypatch
) -> None:
    cache_dir = tmp_path / "cache"
    calls: list[list[Path]] = []

    async def fake_run_async(self, command, **kwargs):
        calls.append(self.writable_roots)
        return CommandResult(
            command=" ".join(command),
            exit_code=0,
            stderr="",
            stdout="created",
        )

    async def approve(path: Path, reason: str) -> WritablePathDecision:
        assert path == cache_dir
        assert "shell command" in reason
        return WritablePathDecision(decision="allow_once", path=path)

    monkeypatch.setattr(SandboxRunner, "run_async", fake_run_async)

    result = await run_tool_with_path_permissions(
        "shell_command",
        {
            "additional_permissions": {"file_system": {"write": [str(cache_dir)]}},
            "command": f"echo created > {cache_dir / 'file.txt'}",
            "sandbox_permissions": "with_additional_permissions",
        },
        ToolContext(cwd=tmp_path / "work"),
        request_writable_path=approve,
        writable_paths=[],
    )

    assert result.ok
    assert result.content == "created"
    assert len(calls) == 1
    assert cache_dir in calls[0]


@pytest.mark.anyio
async def test_always_allow_runs_tool_and_persists_declared_path(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    store = StateStore()
    cache_dir = tmp_path / "cache"

    async def fake_run_async(self, command, **kwargs):
        assert cache_dir in self.writable_roots
        return CommandResult(
            command=" ".join(command),
            exit_code=0,
            stderr="",
            stdout="created",
        )

    async def approve(path: Path, reason: str) -> WritablePathDecision:
        saved = store.save_writable_path(path)
        return WritablePathDecision(decision="always_allow", path=Path(saved.path))

    monkeypatch.setattr(SandboxRunner, "run_async", fake_run_async)

    result = await run_tool_with_path_permissions(
        "shell_command",
        {
            "additional_permissions": {"file_system": {"write": [str(cache_dir)]}},
            "command": f"mkdir -p {cache_dir}",
            "sandbox_permissions": "with_additional_permissions",
        },
        ToolContext(cwd=tmp_path / "work"),
        request_writable_path=approve,
        writable_paths=[],
    )

    assert result.ok
    assert [path.path for path in store.read_writable_paths()] == [str(cache_dir)]


@pytest.mark.anyio
async def test_deny_returns_failed_tool_result_before_running_command(
    tmp_path, monkeypatch
) -> None:
    cache_dir = tmp_path / "cache"
    calls = 0

    async def fake_run_async(self, command, **kwargs):
        nonlocal calls
        calls += 1
        return CommandResult(
            command=" ".join(command),
            exit_code=0,
            stderr="",
            stdout="created",
        )

    async def deny(path: Path, reason: str) -> WritablePathDecision:
        return WritablePathDecision(decision="deny", path=path)

    monkeypatch.setattr(SandboxRunner, "run_async", fake_run_async)

    result = await run_tool_with_path_permissions(
        "shell_command",
        {
            "additional_permissions": {"file_system": {"write": [str(cache_dir)]}},
            "command": f"echo created > {cache_dir / 'file.txt'}",
            "sandbox_permissions": "with_additional_permissions",
        },
        ToolContext(cwd=tmp_path / "work"),
        request_writable_path=deny,
        writable_paths=[],
    )

    assert not result.ok
    assert "Permission denied for" in result.content
    assert calls == 0


@pytest.mark.anyio
async def test_existing_writable_path_covers_declared_permission_request(
    tmp_path, monkeypatch
) -> None:
    cache_dir = tmp_path / "cache"
    requests = 0

    async def fake_run_async(self, command, **kwargs):
        assert cache_dir in self.writable_roots
        return CommandResult(
            command=" ".join(command),
            exit_code=0,
            stderr="",
            stdout="created",
        )

    async def approve(path: Path, reason: str) -> WritablePathDecision:
        nonlocal requests
        requests += 1
        return WritablePathDecision(decision="allow_once", path=path)

    monkeypatch.setattr(SandboxRunner, "run_async", fake_run_async)

    result = await run_tool_with_path_permissions(
        "shell_command",
        {
            "additional_permissions": {"file_system": {"write": [str(cache_dir)]}},
            "command": f"echo created > {cache_dir / 'file.txt'}",
            "sandbox_permissions": "with_additional_permissions",
        },
        ToolContext(cwd=tmp_path / "work"),
        request_writable_path=approve,
        writable_paths=[cache_dir],
    )

    assert result.ok
    assert requests == 0


@pytest.mark.anyio
async def test_multiple_declared_write_paths_request_each_missing_path(
    tmp_path, monkeypatch
) -> None:
    first = tmp_path / "cache"
    second = tmp_path / "downloads"
    requested: list[Path] = []

    async def fake_run_async(self, command, **kwargs):
        assert first in self.writable_roots
        assert second in self.writable_roots
        return CommandResult(
            command=" ".join(command),
            exit_code=0,
            stderr="",
            stdout="created",
        )

    async def approve(path: Path, reason: str) -> WritablePathDecision:
        requested.append(path)
        return WritablePathDecision(decision="allow_once", path=path)

    monkeypatch.setattr(SandboxRunner, "run_async", fake_run_async)

    result = await run_tool_with_path_permissions(
        "shell_command",
        {
            "additional_permissions": {
                "file_system": {"write": [str(first), str(second)]}
            },
            "command": "touch done",
            "sandbox_permissions": "with_additional_permissions",
        },
        ToolContext(cwd=tmp_path / "work"),
        request_writable_path=approve,
        writable_paths=[],
    )

    assert result.ok
    assert requested == [first, second]


@pytest.mark.anyio
async def test_command_text_is_not_used_to_guess_permissions(
    tmp_path, monkeypatch
) -> None:
    outside = tmp_path / "outside"
    requests = 0

    async def fake_run_async(self, command, **kwargs):
        assert outside not in self.writable_roots
        return CommandResult(
            command=" ".join(command),
            exit_code=1,
            stderr=f"rm: cannot remove '{outside / 'file.txt'}': Read-only file system\n",
            stdout="",
        )

    async def approve(path: Path, reason: str) -> WritablePathDecision:
        nonlocal requests
        requests += 1
        return WritablePathDecision(decision="allow_once", path=path)

    monkeypatch.setattr(SandboxRunner, "run_async", fake_run_async)

    result = await run_tool_with_path_permissions(
        "shell_command",
        {"command": f"rm -f {outside / 'file.txt'}"},
        ToolContext(cwd=tmp_path / "work"),
        request_writable_path=approve,
        writable_paths=[],
    )

    assert not result.ok
    assert requests == 0


@pytest.mark.anyio
async def test_additional_permissions_require_matching_sandbox_permissions(
    tmp_path, monkeypatch
) -> None:
    cache_dir = tmp_path / "cache"
    calls = 0

    async def fake_run_async(self, command, **kwargs):
        nonlocal calls
        calls += 1
        return CommandResult(
            command=" ".join(command),
            exit_code=0,
            stderr="",
            stdout="created",
        )

    async def approve(path: Path, reason: str) -> WritablePathDecision:
        return WritablePathDecision(decision="allow_once", path=path)

    monkeypatch.setattr(SandboxRunner, "run_async", fake_run_async)

    result = await run_tool_with_path_permissions(
        "shell_command",
        {
            "additional_permissions": {"file_system": {"write": [str(cache_dir)]}},
            "command": f"touch {cache_dir / 'file.txt'}",
        },
        ToolContext(cwd=tmp_path / "work"),
        request_writable_path=approve,
        writable_paths=[],
    )

    assert not result.ok
    assert "with_additional_permissions" in result.content
    assert calls == 0


@pytest.mark.anyio
async def test_apply_patch_requests_permission_for_outside_workdir_file(
    tmp_path, monkeypatch
) -> None:
    work_dir = tmp_path / "work"
    work_dir.mkdir()
    outside_dir = tmp_path / "outside"
    outside_dir.mkdir()
    target = outside_dir / "notes.txt"
    target.write_text("alpha\n")
    requested: list[Path] = []

    async def approve(path: Path, reason: str) -> WritablePathDecision:
        requested.append(path)
        return WritablePathDecision(decision="allow_once", path=path)

    patch = f"""*** Begin Patch
*** Update File: {target}
@@
-alpha
+beta
*** End Patch
"""

    result = await run_tool_with_path_permissions(
        "apply_patch",
        {"patch": patch},
        ToolContext(cwd=work_dir),
        request_writable_path=approve,
        writable_paths=[],
    )

    assert result.ok
    assert requested == [outside_dir]
    assert target.read_text() == "beta\n"


@pytest.mark.anyio
async def test_apply_patch_uses_existing_writable_path_without_request(
    tmp_path, monkeypatch
) -> None:
    work_dir = tmp_path / "work"
    work_dir.mkdir()
    outside_dir = tmp_path / "outside"
    outside_dir.mkdir()
    target = outside_dir / "notes.txt"
    target.write_text("alpha\n")
    requests = 0

    async def approve(path: Path, reason: str) -> WritablePathDecision:
        nonlocal requests
        requests += 1
        return WritablePathDecision(decision="allow_once", path=path)

    patch = f"""*** Begin Patch
*** Update File: {target}
@@
-alpha
+beta
*** End Patch
"""

    result = await run_tool_with_path_permissions(
        "apply_patch",
        {"patch": patch},
        ToolContext(cwd=work_dir),
        request_writable_path=approve,
        writable_paths=[outside_dir],
    )

    assert result.ok
    assert requests == 0
    assert target.read_text() == "beta\n"


@pytest.mark.anyio
async def test_denied_apply_patch_does_not_modify_file(tmp_path) -> None:
    work_dir = tmp_path / "work"
    work_dir.mkdir()
    outside_dir = tmp_path / "outside"
    outside_dir.mkdir()
    target = outside_dir / "notes.txt"
    target.write_text("alpha\n")

    async def deny(path: Path, reason: str) -> WritablePathDecision:
        return WritablePathDecision(decision="deny", path=path)

    patch = f"""*** Begin Patch
*** Update File: {target}
@@
-alpha
+beta
*** End Patch
"""

    result = await run_tool_with_path_permissions(
        "apply_patch",
        {"patch": patch},
        ToolContext(cwd=work_dir),
        request_writable_path=deny,
        writable_paths=[],
    )

    assert not result.ok
    assert "Permission denied for" in result.content
    assert target.read_text() == "alpha\n"
