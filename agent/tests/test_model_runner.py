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
