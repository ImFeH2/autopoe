import shlex
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from flowent.approval import ApprovalReviewDecision, ApprovalReviewRequest
from flowent.main import create_app
from flowent.permissions import run_tool_with_path_permissions
from flowent.sandbox import CommandResult, SandboxRunner
from flowent.sandboxing import SandboxFailure, SandboxFailureKind
from flowent.storage import StateStore
from flowent.tool_protocol import ToolContext, tool_result_model_content


def policy_denied_failure() -> SandboxFailure:
    return SandboxFailure(
        kind=SandboxFailureKind.POLICY_DENIED,
        message="Command protection denied this operation.",
        backend="test",
    )


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
async def test_approved_declared_write_path_runs_command_with_extra_permission(
    tmp_path, monkeypatch
) -> None:
    cache_dir = tmp_path / "cache"
    calls: list[list[Path]] = []
    reviews: list[ApprovalReviewRequest] = []

    async def fake_run_async(self, command, **kwargs):
        calls.append(self.writable_roots)
        return CommandResult(
            command=" ".join(command),
            exit_code=0,
            stderr="",
            stdout="created",
        )

    async def approve(request: ApprovalReviewRequest) -> ApprovalReviewDecision:
        reviews.append(request)
        return ApprovalReviewDecision(
            decision="approved", reason="Needed for cache writes."
        )

    monkeypatch.setattr(SandboxRunner, "run_async", fake_run_async)

    result = await run_tool_with_path_permissions(
        "shell_command",
        {
            "additional_permissions": {"file_system": {"write": [str(cache_dir)]}},
            "command": f"echo created > {cache_dir / 'file.txt'}",
            "sandbox_permissions": "with_additional_permissions",
        },
        ToolContext(cwd=tmp_path / "work"),
        review_approval=approve,
        writable_paths=[],
    )

    assert result.ok
    assert result.result["output"] == "created"
    assert len(calls) == 1
    assert cache_dir in calls[0]
    assert reviews[0].tool_name == "shell_command"
    assert reviews[0].action == "additional_permissions"
    assert reviews[0].write_paths == [cache_dir]
    assert result.result["approval"] == {
        "action": "additional_permissions",
        "decision": "approved",
        "reason": "Needed for cache writes.",
        "tool_name": "shell_command",
        "tool_result": "",
        "write_paths": [str(cache_dir)],
    }


@pytest.mark.anyio
async def test_approved_declared_write_path_does_not_persist_runtime_permission(
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

    async def approve(request: ApprovalReviewRequest) -> ApprovalReviewDecision:
        return ApprovalReviewDecision(
            decision="approved", reason="Needed for cache writes."
        )

    monkeypatch.setattr(SandboxRunner, "run_async", fake_run_async)

    result = await run_tool_with_path_permissions(
        "shell_command",
        {
            "additional_permissions": {"file_system": {"write": [str(cache_dir)]}},
            "command": f"mkdir -p {cache_dir}",
            "sandbox_permissions": "with_additional_permissions",
        },
        ToolContext(cwd=tmp_path / "work"),
        review_approval=approve,
        writable_paths=[],
    )

    assert result.ok
    assert store.read_writable_paths() == []


@pytest.mark.anyio
async def test_denied_declared_write_path_returns_failed_result_before_running_command(
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

    async def deny(request: ApprovalReviewRequest) -> ApprovalReviewDecision:
        return ApprovalReviewDecision(
            decision="denied",
            evidence=[
                {
                    "message": "User asked only to inspect files.",
                    "why": "The command writes outside that task.",
                }
            ],
            reason="Outside the task scope.",
            reviewer_output='{"risk_level":"high","risk_score":92}',
            risk_level="high",
            risk_score=92,
        )

    monkeypatch.setattr(SandboxRunner, "run_async", fake_run_async)

    result = await run_tool_with_path_permissions(
        "shell_command",
        {
            "additional_permissions": {"file_system": {"write": [str(cache_dir)]}},
            "command": f"echo created > {cache_dir / 'file.txt'}",
            "sandbox_permissions": "with_additional_permissions",
        },
        ToolContext(cwd=tmp_path / "work"),
        review_approval=deny,
        writable_paths=[],
    )

    assert not result.ok
    result_content = tool_result_model_content(result)
    assert "Automatic approval review denied this action" in result_content
    assert "Outside the task scope." in result_content
    assert "Risk: high (92/100)" in result_content
    assert "User asked only to inspect files." in result_content
    assert "The command writes outside that task." in result_content
    assert str(cache_dir) in result_content
    assert '{"risk_level":"high","risk_score":92}' in result_content
    assert result_content.count("Risk: high (92/100)") == 1
    assert result_content.count("Reviewer output:") == 1
    assert "must not work around" in result_content
    assert result.result["approval"]["decision"] == "denied"
    assert result.result["approval"]["reason"] == "Outside the task scope."
    assert result.result["approval"]["reviewer_output"] == (
        '{"risk_level":"high","risk_score":92}'
    )
    assert calls == 0


@pytest.mark.anyio
async def test_existing_writable_path_covers_declared_review(
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

    async def approve(request: ApprovalReviewRequest) -> ApprovalReviewDecision:
        nonlocal requests
        requests += 1
        return ApprovalReviewDecision(decision="approved", reason="Already allowed.")

    monkeypatch.setattr(SandboxRunner, "run_async", fake_run_async)

    result = await run_tool_with_path_permissions(
        "shell_command",
        {
            "additional_permissions": {"file_system": {"write": [str(cache_dir)]}},
            "command": f"echo created > {cache_dir / 'file.txt'}",
            "sandbox_permissions": "with_additional_permissions",
        },
        ToolContext(cwd=tmp_path / "work"),
        review_approval=approve,
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
    reviews: list[ApprovalReviewRequest] = []

    async def fake_run_async(self, command, **kwargs):
        assert first in self.writable_roots
        assert second in self.writable_roots
        return CommandResult(
            command=" ".join(command),
            exit_code=0,
            stderr="",
            stdout="created",
        )

    async def approve(request: ApprovalReviewRequest) -> ApprovalReviewDecision:
        reviews.append(request)
        return ApprovalReviewDecision(
            decision="approved", reason="Needed for generated files."
        )

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
        review_approval=approve,
        writable_paths=[],
    )

    assert result.ok
    assert len(reviews) == 1
    assert reviews[0].write_paths == [first, second]


@pytest.mark.anyio
async def test_declared_missing_write_path_is_not_precreated_by_sandbox(
    tmp_path, monkeypatch
) -> None:
    work_dir = tmp_path / "work"
    work_dir.mkdir()
    missing_path = tmp_path / "external" / "note.txt"
    bwrap = tmp_path / "bwrap"
    bwrap.write_text(
        "#!/bin/sh\n"
        'echo "cannot create requested path: Read-only file system" >&2\n'
        "exit 1\n"
    )
    bwrap.chmod(0o700)
    reviews: list[ApprovalReviewRequest] = []

    async def approve_declared_path_only(
        request: ApprovalReviewRequest,
    ) -> ApprovalReviewDecision:
        reviews.append(request)
        if request.action == "additional_permissions":
            return ApprovalReviewDecision(
                decision="approved", reason="Allow the declared path only."
            )
        return ApprovalReviewDecision(decision="denied", reason="Needs user choice.")

    monkeypatch.setattr("flowent.sandbox.sandbox_binary", lambda: str(bwrap))
    monkeypatch.setattr("flowent.sandbox.sandbox_supports_proc_mount", lambda: False)

    result = await run_tool_with_path_permissions(
        "shell_command",
        {
            "additional_permissions": {"file_system": {"write": [str(missing_path)]}},
            "command": f"printf note > {shlex.quote(str(missing_path))}",
            "sandbox_permissions": "with_additional_permissions",
        },
        ToolContext(cwd=work_dir),
        review_approval=approve_declared_path_only,
        writable_paths=[],
    )

    assert not result.ok
    assert not missing_path.exists()
    assert not missing_path.parent.exists()
    assert [request.action for request in reviews] == ["additional_permissions"]
    assert result.result["approval"]["decision"] == "approved"


@pytest.mark.anyio
async def test_policy_denied_shell_command_stays_protected(
    tmp_path, monkeypatch
) -> None:
    calls: list[str] = []
    reviews: list[ApprovalReviewRequest] = []

    async def fake_run_async(self, command, **kwargs):
        calls.append("sandbox")
        return CommandResult(
            command=" ".join(command),
            exit_code=1,
            stderr="failed to write file: Read-only file system\n",
            stdout="",
            failure=policy_denied_failure(),
        )

    async def approve(request: ApprovalReviewRequest) -> ApprovalReviewDecision:
        reviews.append(request)
        return ApprovalReviewDecision(decision="approved", reason="Allowed.")

    monkeypatch.setattr(SandboxRunner, "run_async", fake_run_async)

    result = await run_tool_with_path_permissions(
        "shell_command",
        {"command": "touch output.txt"},
        ToolContext(cwd=tmp_path / "work"),
        review_approval=approve,
        writable_paths=[],
    )

    assert not result.ok
    assert calls == ["sandbox"]
    assert reviews == []
    assert result.sandbox_failure_kind == SandboxFailureKind.POLICY_DENIED
    assert "Read-only file system" in tool_result_model_content(result)


@pytest.mark.anyio
async def test_command_text_is_not_used_to_guess_write_paths(
    tmp_path, monkeypatch
) -> None:
    outside = tmp_path / "outside"
    reviews: list[ApprovalReviewRequest] = []

    async def fake_run_async(self, command, **kwargs):
        assert outside not in self.writable_roots
        return CommandResult(
            command=" ".join(command),
            exit_code=1,
            stderr=f"rm: cannot remove '{outside / 'file.txt'}': Read-only file system\n",
            stdout="",
            failure=policy_denied_failure(),
        )

    async def deny(request: ApprovalReviewRequest) -> ApprovalReviewDecision:
        reviews.append(request)
        return ApprovalReviewDecision(
            decision="denied", reason="No extra write paths were declared."
        )

    monkeypatch.setattr(SandboxRunner, "run_async", fake_run_async)

    result = await run_tool_with_path_permissions(
        "shell_command",
        {"command": f"rm -f {outside / 'file.txt'}"},
        ToolContext(cwd=tmp_path / "work"),
        review_approval=deny,
        writable_paths=[],
    )

    assert not result.ok
    assert reviews == []


@pytest.mark.anyio
async def test_backend_failure_is_not_reviewed_or_retried(
    tmp_path, monkeypatch
) -> None:
    calls: list[str] = []
    reviews: list[ApprovalReviewRequest] = []

    async def fake_run_async(self, command, **kwargs):
        calls.append("protected")
        return CommandResult(
            command=" ".join(command),
            exit_code=1,
            stderr="helper: Permission denied\n",
            stdout="",
            failure=SandboxFailure(
                kind=SandboxFailureKind.BACKEND_LAUNCH_FAILED,
                message="Command protection could not start the command.",
                backend="test",
            ),
        )

    async def approve(request: ApprovalReviewRequest) -> ApprovalReviewDecision:
        reviews.append(request)
        return ApprovalReviewDecision(decision="approved", reason="Allowed.")

    monkeypatch.setattr(SandboxRunner, "run_async", fake_run_async)

    result = await run_tool_with_path_permissions(
        "shell_command",
        {"command": "touch output.txt"},
        ToolContext(cwd=tmp_path / "work"),
        review_approval=approve,
        writable_paths=[],
    )

    assert not result.ok
    assert calls == ["protected"]
    assert reviews == []
    assert result.sandbox_failure_kind == SandboxFailureKind.BACKEND_LAUNCH_FAILED
    assert "Permission denied" in tool_result_model_content(result)


@pytest.mark.anyio
async def test_unclassified_error_text_is_not_treated_as_policy_denial(
    tmp_path, monkeypatch
) -> None:
    reviews: list[ApprovalReviewRequest] = []

    async def fake_run_async(self, command, **kwargs):
        return CommandResult(
            command=" ".join(command),
            exit_code=1,
            stderr="Permission denied\n",
            stdout="",
        )

    async def review(request: ApprovalReviewRequest) -> ApprovalReviewDecision:
        reviews.append(request)
        return ApprovalReviewDecision(decision="approved", reason="Allowed.")

    monkeypatch.setattr(SandboxRunner, "run_async", fake_run_async)

    result = await run_tool_with_path_permissions(
        "shell_command",
        {"command": "false"},
        ToolContext(cwd=tmp_path / "work"),
        review_approval=review,
        writable_paths=[],
    )

    assert not result.ok
    assert reviews == []
    assert result.sandbox_failure_kind is None


@pytest.mark.anyio
async def test_additional_permissions_require_matching_sandbox_permissions(
    tmp_path, monkeypatch
) -> None:
    cache_dir = tmp_path / "cache"
    calls = 0
    reviews = 0

    async def fake_run_async(self, command, **kwargs):
        nonlocal calls
        calls += 1
        return CommandResult(
            command=" ".join(command),
            exit_code=0,
            stderr="",
            stdout="created",
        )

    async def approve(request: ApprovalReviewRequest) -> ApprovalReviewDecision:
        nonlocal reviews
        reviews += 1
        return ApprovalReviewDecision(decision="approved", reason="Allowed.")

    monkeypatch.setattr(SandboxRunner, "run_async", fake_run_async)

    result = await run_tool_with_path_permissions(
        "shell_command",
        {
            "additional_permissions": {"file_system": {"write": [str(cache_dir)]}},
            "command": f"touch {cache_dir / 'file.txt'}",
        },
        ToolContext(cwd=tmp_path / "work"),
        review_approval=approve,
        writable_paths=[],
    )

    assert not result.ok
    assert "with_additional_permissions" in tool_result_model_content(result)
    assert calls == 0
    assert reviews == 0


@pytest.mark.anyio
async def test_apply_patch_uses_reviewer_before_writing_outside_workdir_file(
    tmp_path, monkeypatch
) -> None:
    work_dir = tmp_path / "work"
    work_dir.mkdir()
    outside_dir = tmp_path / "outside"
    outside_dir.mkdir()
    target = outside_dir / "notes.txt"
    target.write_text("alpha\n")
    reviews: list[ApprovalReviewRequest] = []

    async def approve(request: ApprovalReviewRequest) -> ApprovalReviewDecision:
        reviews.append(request)
        return ApprovalReviewDecision(
            decision="approved", reason="The edit matches the request."
        )

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
        review_approval=approve,
        writable_paths=[],
    )

    assert result.ok
    assert reviews[0].tool_name == "apply_patch"
    assert reviews[0].action == "edit"
    assert reviews[0].write_paths == [outside_dir]
    assert result.result["approval"]["action"] == "edit"
    assert result.result["approval"]["decision"] == "approved"
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

    async def approve(request: ApprovalReviewRequest) -> ApprovalReviewDecision:
        nonlocal requests
        requests += 1
        return ApprovalReviewDecision(decision="approved", reason="Already allowed.")

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
        review_approval=approve,
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

    async def deny(request: ApprovalReviewRequest) -> ApprovalReviewDecision:
        return ApprovalReviewDecision(
            decision="denied", reason="The target is outside the allowed scope."
        )

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
        review_approval=deny,
        writable_paths=[],
    )

    assert not result.ok
    assert "outside the allowed scope" in tool_result_model_content(result)
    assert result.result["approval"]["action"] == "edit"
    assert result.result["approval"]["decision"] == "denied"
    assert target.read_text() == "alpha\n"
