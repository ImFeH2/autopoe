import asyncio
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from flowent_agent.agents import AgentExecutionResult, AgentRunner
from flowent_agent.approval import ApprovalCoordinator
from flowent_agent.persistence import RuntimeServices
from flowent_agent.tools.workspace import WorkspaceManager
from flowent_agent.workflows import (
    ApprovalDecision,
    WorkflowDefinition,
    WorkflowRunRequest,
    seed_builtin_workflows,
    software_delivery_workflow,
)
from flowent_agent.workflows.engine import WorkflowEngine
from flowent_agent.workflows.template import TemplateRenderer


class FakeAgentRunner:
    def __init__(self) -> None:
        self.active = 0
        self.max_active = 0
        self.node_runs: dict[str, int] = {}

    async def run(
        self,
        request: Any,
        emit: Any,
        workspace: Any = None,
    ) -> AgentExecutionResult:
        self.active += 1
        self.max_active = max(self.max_active, self.active)
        self.node_runs[request.node_id] = self.node_runs.get(request.node_id, 0) + 1
        await emit("agent.started", {})
        await asyncio.sleep(0.01)
        if request.node_id == "review":
            approved = self.node_runs[request.node_id] > 1
            output = f'{{"approved":{str(approved).lower()}}}'
        else:
            output = request.messages[-1].content
        await emit("agent.text_delta", {"delta": output})
        await emit("agent.completed", {"output": output, "usage": {}})
        self.active -= 1
        return AgentExecutionResult(
            run_id=request.run_id,
            status="completed",
            output=output,
        )


def agent_config(name: str) -> dict[str, Any]:
    return {
        "name": name,
        "instructions": "Complete the assigned work.",
    }


def test_workflow_rejects_dependency_cycles() -> None:
    with pytest.raises(ValidationError, match="dependency cycle"):
        WorkflowDefinition.model_validate(
            {
                "id": "cycle",
                "name": "Cycle",
                "nodes": [
                    {
                        "id": "one",
                        "name": "One",
                        "type": "agent",
                        "depends_on": ["two"],
                        "agent": agent_config("One"),
                        "prompt": "One",
                    },
                    {
                        "id": "two",
                        "name": "Two",
                        "type": "agent",
                        "depends_on": ["one"],
                        "agent": agent_config("Two"),
                        "prompt": "Two",
                    },
                ],
            }
        )


def test_template_renderer_resolves_nested_values() -> None:
    renderer = TemplateRenderer()

    rendered = renderer.render(
        "Build {{ input.feature }} after {{ outputs.requirements }}",
        {"input": {"feature": "search"}, "outputs": {"requirements": "spec"}},
    )

    assert rendered == "Build search after spec"


def test_workflow_preserves_canvas_positions() -> None:
    definition = WorkflowDefinition.model_validate(
        {
            "id": "layout",
            "name": "Layout",
            "nodes": [
                {
                    "id": "node",
                    "name": "Node",
                    "type": "agent",
                    "position": {"x": 120, "y": 240},
                    "agent": agent_config("Agent"),
                    "prompt": "Run",
                }
            ],
        }
    )

    assert definition.nodes[0].position is not None
    assert definition.nodes[0].position.x == 120


async def test_workflow_store_versions_drafts(tmp_path: Path) -> None:
    services = await RuntimeServices.create(tmp_path)
    definition = WorkflowDefinition.model_validate(
        {
            "id": "delivery",
            "name": "Delivery",
            "nodes": [
                {
                    "id": "analysis",
                    "name": "Analysis",
                    "type": "agent",
                    "agent": agent_config("Analyst"),
                    "prompt": "Analyze {{ input.request }}",
                }
            ],
        }
    )
    await services.workflows.save_draft(definition)
    first = await services.workflows.publish(definition.id)
    changed = definition.model_copy(update={"name": "Delivery v2"})
    await services.workflows.save_draft(changed)
    second = await services.workflows.publish(definition.id)
    await services.workflows.start_run(
        "history-run",
        second.id,
        {"request": "Build history"},
    )
    await services.workflows.finish_run(
        "history-run",
        "completed",
        {"result": "done"},
    )

    persisted_first = await services.workflows.get_version(definition.id, 1)
    summaries = await services.workflows.list_definitions()
    runs = await services.workflows.list_runs()
    assert first.version == 1
    assert second.version == 2
    assert persisted_first is not None
    assert persisted_first.definition.name == "Delivery"
    assert summaries[0].latest_version == 2
    assert runs[0].workflow_name == "Delivery v2"
    assert runs[0].input == {"request": "Build history"}
    assert runs[0].output == {"result": "done"}
    await services.close()


async def test_builtin_workflow_is_seeded_without_overwriting_edits(
    tmp_path: Path,
) -> None:
    services = await RuntimeServices.create(tmp_path)
    await seed_builtin_workflows(services.workflows)
    seeded = await services.workflows.get_draft("software-delivery")
    assert seeded is not None
    edited = seeded.model_copy(update={"name": "My delivery"})
    await services.workflows.save_draft(edited)

    await seed_builtin_workflows(services.workflows)

    retained = await services.workflows.get_draft("software-delivery")
    assert retained is not None
    assert retained.name == "My delivery"
    await services.close()


async def test_builtin_delivery_workflow_runs_end_to_end(tmp_path: Path) -> None:
    repository = tmp_path / "repository"
    repository.mkdir()
    services = await RuntimeServices.create(tmp_path / "data")
    approvals = ApprovalCoordinator(services.approvals)
    workspaces = WorkspaceManager(services.data_dir)
    runner = AgentRunner(
        services.runs,
        approvals,
        workspaces,
        services.credentials,
        services.settings,
    )
    engine = WorkflowEngine(
        services.workflows,
        runner,
        approvals,
        workspaces,
        services.artifacts,
    )
    definition = software_delivery_workflow()
    await services.workflows.save_draft(definition)
    await services.workflows.publish(definition.id)
    events: list[str] = []

    async def emit(
        name: str,
        payload: dict[str, Any],
        agent_run_id: str | None,
    ) -> None:
        events.append(name)
        if name == "workflow.approval_required":
            await approvals.resolve(
                ApprovalDecision(
                    approval_id=str(payload["approval_id"]),
                    approved=True,
                )
            )

    result = await engine.run(
        WorkflowRunRequest(
            run_id="builtin-run",
            workflow_id=definition.id,
            input={"request": "Exercise the delivery loop"},
            workspace={
                "path": str(repository),
                "mode": "direct",
                "base_ref": "HEAD",
            },
        ),
        emit,
    )

    assert result.status == "completed"
    assert result.output["quality"]["count"] == 1
    assert "agent.text_delta" in events
    assert "workflow.approval_required" in events
    assert events[-1] == "workflow.completed"
    await services.close()


async def test_workflow_engine_runs_parallel_agents_and_bounded_loop(
    tmp_path: Path,
) -> None:
    services = await RuntimeServices.create(tmp_path)
    runner = FakeAgentRunner()
    engine = WorkflowEngine(
        services.workflows,
        runner,
        ApprovalCoordinator(services.approvals),
        WorkspaceManager(tmp_path),
        services.artifacts,
    )
    definition = WorkflowDefinition.model_validate(
        {
            "id": "delivery",
            "name": "Delivery",
            "max_parallelism": 2,
            "nodes": [
                {
                    "id": "requirements",
                    "name": "Requirements",
                    "type": "agent",
                    "agent": agent_config("Analyst"),
                    "prompt": "Analyze {{ input.request }}",
                },
                {
                    "id": "frontend",
                    "name": "Frontend",
                    "type": "agent",
                    "depends_on": ["requirements"],
                    "agent": agent_config("Frontend"),
                    "prompt": "Build UI from {{ outputs.requirements }}",
                },
                {
                    "id": "backend",
                    "name": "Backend",
                    "type": "agent",
                    "depends_on": ["requirements"],
                    "agent": agent_config("Backend"),
                    "prompt": "Build API from {{ outputs.requirements }}",
                },
                {
                    "id": "quality",
                    "name": "Quality loop",
                    "type": "loop",
                    "depends_on": ["frontend", "backend"],
                    "max_iterations": 3,
                    "until": {
                        "path": "outputs.review.approved",
                        "operator": "equals",
                        "value": True,
                    },
                    "nodes": [
                        {
                            "id": "review",
                            "name": "Review",
                            "type": "agent",
                            "agent": agent_config("Reviewer"),
                            "prompt": "Review iteration {{ iteration }}",
                            "output_mode": "json",
                        }
                    ],
                },
            ],
        }
    )
    await services.workflows.save_draft(definition)
    await services.workflows.publish(definition.id)
    events: list[tuple[str, dict[str, Any], str | None]] = []

    async def emit(
        name: str,
        payload: dict[str, Any],
        agent_run_id: str | None,
    ) -> None:
        events.append((name, payload, agent_run_id))

    result = await engine.run(
        WorkflowRunRequest(
            run_id="workflow-run-1",
            workflow_id=definition.id,
            input={"request": "Add search"},
        ),
        emit,
    )

    assert result.status == "completed"
    assert runner.max_active == 2
    assert runner.node_runs["review"] == 2
    assert result.output["quality"]["satisfied"] is True
    assert events[0][0] == "workflow.started"
    assert events[-1][0] == "workflow.completed"
    await services.close()


async def test_workflow_approval_can_be_resolved(tmp_path: Path) -> None:
    services = await RuntimeServices.create(tmp_path)
    approvals = ApprovalCoordinator(services.approvals)
    engine = WorkflowEngine(
        services.workflows,
        FakeAgentRunner(),
        approvals,
        WorkspaceManager(tmp_path),
        services.artifacts,
    )
    definition = WorkflowDefinition.model_validate(
        {
            "id": "approval",
            "name": "Approval",
            "nodes": [
                {
                    "id": "gate",
                    "name": "Gate",
                    "type": "approval",
                    "prompt": "Approve {{ input.change }}?",
                }
            ],
        }
    )
    await services.workflows.save_draft(definition)
    await services.workflows.publish(definition.id)
    approval_ready = asyncio.Event()
    approval_id = ""

    async def emit(
        name: str,
        payload: dict[str, Any],
        _: str | None,
    ) -> None:
        nonlocal approval_id
        if name == "workflow.approval_required":
            approval_id = str(payload["approval_id"])
            approval_ready.set()

    run_task = asyncio.create_task(
        engine.run(
            WorkflowRunRequest(
                run_id="workflow-run-approval",
                workflow_id=definition.id,
                input={"change": "release"},
            ),
            emit,
        )
    )
    await asyncio.wait_for(approval_ready.wait(), 1)
    resolved = await approvals.resolve(
        ApprovalDecision(
            approval_id=approval_id,
            approved=True,
            data={"reviewer": "user"},
        )
    )
    result = await run_task

    assert resolved is True
    assert result.status == "completed"
    assert result.output["gate"]["approved"] is True
    await services.close()


async def test_workflow_waiting_for_approval_can_be_cancelled(
    tmp_path: Path,
) -> None:
    services = await RuntimeServices.create(tmp_path)
    approvals = ApprovalCoordinator(services.approvals)
    engine = WorkflowEngine(
        services.workflows,
        FakeAgentRunner(),
        approvals,
        WorkspaceManager(tmp_path),
        services.artifacts,
    )
    definition = WorkflowDefinition.model_validate(
        {
            "id": "cancel",
            "name": "Cancel",
            "nodes": [
                {
                    "id": "gate",
                    "name": "Gate",
                    "type": "approval",
                    "prompt": "Continue?",
                }
            ],
        }
    )
    await services.workflows.save_draft(definition)
    await services.workflows.publish(definition.id)
    approval_ready = asyncio.Event()

    async def emit(
        name: str,
        payload: dict[str, Any],
        agent_run_id: str | None,
    ) -> None:
        if name == "workflow.approval_required":
            approval_ready.set()

    run_task = asyncio.create_task(
        engine.run(
            WorkflowRunRequest(
                run_id="workflow-run-cancel",
                workflow_id=definition.id,
            ),
            emit,
        )
    )
    await asyncio.wait_for(approval_ready.wait(), 1)
    run_task.cancel()
    result = await run_task
    runs = await services.workflows.list_runs()

    assert result.status == "cancelled"
    assert runs[0].status == "cancelled"
    await services.close()
