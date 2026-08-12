from pathlib import Path
from typing import Any

import pytest
from pydantic_ai.exceptions import ModelHTTPError

from flowent.domain import Activation, ActivationItem, OrganizationState
from flowent.host_tools import HostTools
from flowent.model_runner import (
    DeterministicRunner,
    ModelConfig,
    PydanticAgentRunner,
    UnavailableRunner,
    create_runner,
)
from flowent.runtime import AgentRunContext, AgentRunFailure


def activation_context(tmp_path: Path) -> tuple[Activation, AgentRunContext]:
    state = OrganizationState()
    state.create_agent("Ada")
    state.create_discussion("Work", 1, [2])
    activation = Activation(
        agent_id=2,
        items=(ActivationItem(discussion_id=1, message_ids=(1,)),),
    )
    return activation, AgentRunContext(
        agent_id=2,
        state=state,
        host_tools=HostTools(tmp_path),
    )


def test_deterministic_runner_uses_exec_and_patch_for_e2e_task(
    tmp_path: Path,
) -> None:
    work = tmp_path / "artifacts" / "desktop" / "e2e-agent-work"
    work.mkdir(parents=True)
    (work / "input.txt").write_text("before\n")
    state = OrganizationState(tmp_path)
    state.create_agent("Ada")
    state.create_discussion("Work", 1, [2])
    state.send_message(1, 1, "E2E_REPOSITORY_TASK: update the fixture", [2])
    activation, _ = state.claim_next_activation()
    assert activation is not None
    context = AgentRunContext(
        agent_id=2,
        state=state,
        host_tools=HostTools(tmp_path),
    )

    DeterministicRunner().run(activation, context)

    snapshot = state.snapshot()
    assert (work / "input.txt").read_text() == "after\n"
    assert snapshot["discussions"][0]["messages"][0]["mentions"] == [
        {"member_id": 2, "status": "acked"}
    ]
    assert "used exec and patch" in snapshot["discussions"][0]["messages"][1]["body"]


def test_deterministic_runner_retries_the_same_failed_message(
    tmp_path: Path,
) -> None:
    state = OrganizationState(tmp_path)
    state.create_agent("Ada")
    state.create_discussion("Retry", 1, [2])
    state.send_message(1, 1, "E2E_RETRY_TASK: fail once", [2])
    activation, _ = state.claim_next_activation()
    assert activation is not None
    runner = DeterministicRunner()
    context = AgentRunContext(2, state, HostTools(tmp_path))

    with pytest.raises(AgentRunFailure, match="Model request failed"):
        runner.run(activation, context)
    state.complete_activation(2, "Model request failed")
    assert state.snapshot()["members"][1]["status"] == "error"
    assert state.snapshot()["discussions"][0]["messages"][0]["mentions"] == [
        {"member_id": 2, "status": "read"}
    ]

    state.retry_agent(2)
    retried, _ = state.claim_next_activation()
    assert retried is not None
    runner.run(retried, context)
    state.complete_activation(2)

    snapshot = state.snapshot()
    assert snapshot["members"][1]["status"] == "idle"
    assert snapshot["discussions"][0]["messages"][0]["mentions"] == [
        {"member_id": 2, "status": "acked"}
    ]
    assert snapshot["discussions"][0]["messages"][1]["body"] == (
        "Ada completed the retried work."
    )


def test_deterministic_runner_hands_work_to_an_equal_agent(tmp_path: Path) -> None:
    state = OrganizationState(tmp_path)
    state.create_agent("Ada")
    state.create_agent("Lin")
    state.create_discussion("Handoff", 1, [2, 3])
    state.send_message(1, 1, "E2E_AGENT_HANDOFF: collaborate", [2])
    runner = DeterministicRunner()

    first, _ = state.claim_next_activation()
    assert first is not None
    runner.run(first, AgentRunContext(2, state, HostTools(tmp_path)))
    state.complete_activation(2)
    second, _ = state.claim_next_activation()
    assert second is not None
    assert second.agent_id == 3
    runner.run(second, AgentRunContext(3, state, HostTools(tmp_path)))
    state.complete_activation(3)

    messages = state.snapshot()["discussions"][0]["messages"]
    assert messages[0]["mentions"] == [{"member_id": 2, "status": "acked"}]
    assert messages[1] == {
        "id": 2,
        "sender_id": 2,
        "body": "E2E_AGENT_FOLLOWUP: Ada asked Lin to continue.",
        "mentions": [{"member_id": 3, "status": "acked"}],
    }
    assert messages[2]["body"] == "Lin completed the Agent handoff."


def test_deterministic_handoff_requires_another_discussion_agent(
    tmp_path: Path,
) -> None:
    state = OrganizationState(tmp_path)
    state.create_agent("Ada")
    state.create_discussion("Handoff", 1, [2])
    state.send_message(1, 1, "E2E_AGENT_HANDOFF: collaborate", [2])
    activation, _ = state.claim_next_activation()
    assert activation is not None

    with pytest.raises(
        AgentRunFailure,
        match="Agent handoff requires another Agent",
    ):
        DeterministicRunner().run(
            activation,
            AgentRunContext(2, state, HostTools(tmp_path)),
        )

    assert state.snapshot()["discussions"][0]["messages"][0]["mentions"] == [
        {"member_id": 2, "status": "read"}
    ]


def test_model_config_loads_lowercase_env_without_revealing_key(tmp_path: Path) -> None:
    secret = "not-for-repr"
    (tmp_path / ".env").write_text(
        f"base_url=https://example.invalid/v1\napi_key={secret}\nmodel=test-model\n"
    )

    config = ModelConfig.load(tmp_path)

    assert config.api_key == secret
    assert secret not in repr(config)


def test_missing_model_config_returns_runner_that_fails_on_activation(
    tmp_path: Path,
) -> None:
    runner = create_runner(tmp_path)
    assert isinstance(runner, UnavailableRunner)
    activation, context = activation_context(tmp_path)

    with pytest.raises(AgentRunFailure, match="configuration is incomplete"):
        runner.run(activation, context)


def test_pydantic_model_errors_are_mapped_to_safe_message(tmp_path: Path) -> None:
    class FailingAgent:
        def run_sync(self, prompt: str, deps: AgentRunContext) -> Any:
            del prompt, deps
            raise ModelHTTPError(401, "secret upstream detail", "test-model")

    runner = object.__new__(PydanticAgentRunner)
    runner._agent = FailingAgent()  # type: ignore[attr-defined]
    activation, context = activation_context(tmp_path)

    with pytest.raises(AgentRunFailure, match="^Model request failed$"):
        runner.run(activation, context)
