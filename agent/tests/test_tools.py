import asyncio
import subprocess
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest
from pydantic_ai import RunContext
from pydantic_ai.messages import ModelMessage, ModelRequest, ToolReturnPart
from pydantic_ai.models.function import AgentInfo, DeltaToolCall, FunctionModel
from pydantic_ai.usage import RunUsage

from flowent.agents import AgentRunner, AgentRunRequest
from flowent.approval import (
    ApprovalCoordinator,
    ApprovalDecision,
    ApprovalScope,
)
from flowent.persistence import RuntimeServices
from flowent.tools.registry import AgentDependencies, CommandPolicy, ToolRegistry
from flowent.tools.workspace import (
    WorkspaceConfiguration,
    WorkspaceManager,
    sanitized_environment,
)


def git(repository: Path, *arguments: str) -> None:
    subprocess.run(
        ["git", "-C", str(repository), *arguments],
        check=True,
        capture_output=True,
    )


def create_repository(path: Path) -> None:
    path.mkdir()
    git(path, "init")
    git(path, "config", "user.email", "test@example.com")
    git(path, "config", "user.name", "Flowent Test")
    (path / "sample.txt").write_text("original\n", encoding="utf-8")
    git(path, "add", "sample.txt")
    git(path, "commit", "-m", "test: initialize repository")


def test_command_policy_separates_safe_approved_and_denied_commands() -> None:
    policy = CommandPolicy()

    assert policy.classify(["git", "status", "--short"]) == "allow"
    assert policy.classify(["cargo", "test"]) == "approve"
    assert policy.classify(["pytest"]) == "approve"
    assert policy.classify(["git", "commit", "-m", "change"]) == "approve"
    assert policy.classify(["python", "script.py"]) == "approve"
    assert policy.classify(["rm", "-rf", "."]) == "deny"
    assert policy.classify(["bash", "-c", "echo unsafe"]) == "deny"


def test_command_environment_excludes_provider_credentials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "secret")
    monkeypatch.setenv("PATH", "/usr/bin")

    environment = sanitized_environment()

    assert environment["PATH"] == "/usr/bin"
    assert "OPENAI_API_KEY" not in environment


async def test_workspace_rejects_escaped_paths_and_creates_worktree(
    tmp_path: Path,
) -> None:
    source = tmp_path / "source"
    create_repository(source)
    manager = WorkspaceManager(tmp_path / "data")
    direct = await manager.open_direct(str(source))

    with pytest.raises(ValueError, match="outside"):
        direct.resolve_path("../secret.txt")

    isolated = await manager.prepare(
        "workflow-run",
        WorkspaceConfiguration(path=str(source), mode="worktree"),
    )
    (isolated.root / "sample.txt").write_text("changed\n", encoding="utf-8")

    assert isolated.root != source
    assert (source / "sample.txt").read_text(encoding="utf-8") == "original\n"
    assert "sample.txt" in await isolated.git_status()


async def test_approval_coordinator_persists_and_resolves_requests(
    tmp_path: Path,
) -> None:
    services = await RuntimeServices.create(tmp_path)
    coordinator = ApprovalCoordinator(services.approvals)
    ready = asyncio.Event()
    approval_id = ""

    async def emit(name: str, payload: dict[str, Any]) -> None:
        nonlocal approval_id
        if name == "approval.required":
            approval_id = str(payload["approval_id"])
            ready.set()

    request_task = asyncio.create_task(
        coordinator.request(
            ApprovalScope(run_id="run-1"),
            "command",
            "Run tests",
            {"command": ["pytest"]},
            emit,
        )
    )
    await asyncio.wait_for(ready.wait(), 1)
    resolved = await coordinator.resolve(
        ApprovalDecision(approval_id=approval_id, approved=True)
    )
    decision = await request_task
    row = await (
        await services.database.connection.execute(
            "SELECT status FROM approvals WHERE id = ?", (approval_id,)
        )
    ).fetchone()

    assert resolved is True
    assert decision.approved is True
    assert row["status"] == "approved"
    await services.close()


async def tool_calling_model(
    messages: list[ModelMessage],
    _: AgentInfo,
) -> AsyncIterator[str | dict[int, DeltaToolCall]]:
    has_result = any(
        isinstance(part, ToolReturnPart)
        for message in messages
        if isinstance(message, ModelRequest)
        for part in message.parts
    )
    if has_result:
        yield "File inspected"
    else:
        yield {
            0: DeltaToolCall(
                name="read_file",
                json_args='{"path":"sample.txt"}',
                tool_call_id="read-1",
            )
        }


async def test_agent_runner_executes_workspace_tool_loop(tmp_path: Path) -> None:
    workspace_path = tmp_path / "workspace"
    workspace_path.mkdir()
    (workspace_path / "sample.txt").write_text("workspace content\n", encoding="utf-8")
    services = await RuntimeServices.create(tmp_path / "data")
    coordinator = ApprovalCoordinator(services.approvals)
    runner = AgentRunner(
        services.runs,
        coordinator,
        WorkspaceManager(tmp_path / "data"),
        model_factory=lambda _: FunctionModel(stream_function=tool_calling_model),
    )
    request = AgentRunRequest.model_validate(
        {
            "run_id": "tool-run",
            "workspace": {"path": str(workspace_path), "mode": "direct"},
            "messages": [{"role": "user", "content": "Inspect the sample"}],
            "agent": {
                "name": "Reader",
                "instructions": "Inspect the requested file.",
                "tools": ["read_file"],
            },
        }
    )
    events: list[str] = []

    async def emit(name: str, _: dict[str, Any]) -> None:
        events.append(name)

    result = await runner.run(request, emit)

    assert result.status == "completed"
    assert result.output == "File inspected"
    assert "agent.tool_started" in events
    assert "agent.tool_completed" in events
    await services.close()


async def test_command_tool_waits_for_approval(tmp_path: Path) -> None:
    repository = tmp_path / "repository"
    create_repository(repository)
    services = await RuntimeServices.create(tmp_path / "data")
    coordinator = ApprovalCoordinator(services.approvals)
    workspace = await WorkspaceManager(tmp_path / "data").open_direct(str(repository))
    ready = asyncio.Event()
    approval_id = ""

    async def emit(name: str, payload: dict[str, Any]) -> None:
        nonlocal approval_id
        if name == "approval.required":
            approval_id = str(payload["approval_id"])
            ready.set()

    dependencies = AgentDependencies(
        workspace=workspace,
        approvals=coordinator,
        approval_scope=ApprovalScope(run_id="command-run"),
        emit=emit,
    )
    context = RunContext(
        deps=dependencies,
        model=FunctionModel(stream_function=tool_calling_model),
        usage=RunUsage(),
        tool_call_id="command-1",
    )
    command_task = asyncio.create_task(
        ToolRegistry().run_command(
            context,
            ["git", "add", "--dry-run", "sample.txt"],
        )
    )
    await asyncio.wait_for(ready.wait(), 1)
    await coordinator.resolve(ApprovalDecision(approval_id=approval_id, approved=True))
    result = await command_task

    assert result["exit_code"] == 0
    await services.close()
