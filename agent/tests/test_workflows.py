import asyncio
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from flowent_agent.agents import AgentExecutionResult
from flowent_agent.persistence import RuntimeServices
from flowent_agent.workflows import (
    ApprovalDecision,
    WorkflowDefinition,
    WorkflowRunRequest,
)
from flowent_agent.workflows.engine import WorkflowEngine
from flowent_agent.workflows.template import TemplateRenderer


class FakeAgentRunner:
    def __init__(self) -> None:
        self.active = 0
        self.max_active = 0
        self.node_runs: dict[str, int] = {}

    async def run(self, request: Any, emit: Any) -> AgentExecutionResult:
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

    persisted_first = await services.workflows.get_version(definition.id, 1)
    summaries = await services.workflows.list_definitions()
    assert first.version == 1
    assert second.version == 2
    assert persisted_first is not None
    assert persisted_first.definition.name == "Delivery"
    assert summaries[0].latest_version == 2
    await services.close()


async def test_workflow_engine_runs_parallel_agents_and_bounded_loop(
    tmp_path: Path,
) -> None:
    services = await RuntimeServices.create(tmp_path)
    runner = FakeAgentRunner()
    engine = WorkflowEngine(services.workflows, runner)
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
    engine = WorkflowEngine(
        services.workflows,
        FakeAgentRunner(),
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
    resolved = await engine.resolve_approval(
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
