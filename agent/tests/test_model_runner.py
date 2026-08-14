from pathlib import Path
from typing import Any

import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)
from pydantic_ai import InstrumentationSettings
from pydantic_ai.exceptions import ModelHTTPError
from pydantic_ai.models.test import TestModel

from e2e_support.runner import DeterministicRunner
from flowent.domain import Activation, ActivationItem, OrganizationState
from flowent.host_tools import HostTools
from flowent.model_runner import (
    ModelConfig,
    ModelRuntime,
    ObservabilityConfig,
    ObservabilitySession,
    ProviderType,
    PydanticAgentRunner,
    create_observability_session,
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


def test_model_config_repr_does_not_reveal_api_key() -> None:
    secret = "not-for-repr"

    config = ModelConfig(
        provider="openai",
        base_url="https://example.invalid/v1",
        api_key=secret,
        model="test-model",
    )

    assert secret not in repr(config)


def test_shared_model_settings_never_return_the_api_key() -> None:
    secret = "shared-secret"
    runtime = ModelRuntime()

    settings = runtime.configure(
        provider="anthropic",
        base_url="https://example.invalid",
        api_key=secret,
        model="test-model",
    )

    assert settings == {
        "provider": "anthropic",
        "base_url": "https://example.invalid",
        "model": "test-model",
        "has_api_key": True,
    }
    assert secret not in repr(runtime.settings())
    assert (
        runtime.configure(
            provider="google",
            base_url="https://google.invalid",
            api_key="",
            model="gemini-test",
        )["has_api_key"]
        is True
    )


@pytest.mark.parametrize("provider", ["openai", "anthropic", "google"])
def test_pydantic_runner_accepts_supported_provider_configs(
    provider: ProviderType,
) -> None:
    PydanticAgentRunner(
        ModelConfig(
            provider=provider,
            base_url="https://example.invalid",
            api_key="test-key",
            model="test-model",
        )
    )


def test_all_agents_use_the_latest_shared_runner(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    calls: list[tuple[str, int]] = []

    class RecordingRunner:
        def __init__(self, model: str) -> None:
            self.model = model

        def run(self, activation: Activation, context: AgentRunContext) -> None:
            del context
            calls.append((self.model, activation.agent_id))

    def create_recording_runner(
        _runtime: ModelRuntime,
        config: ModelConfig | None,
        _instrumentation: object,
    ) -> RecordingRunner:
        return RecordingRunner(config.model if config else "unavailable")

    monkeypatch.setattr(ModelRuntime, "_create_runner", create_recording_runner)
    runtime = ModelRuntime()
    runtime.configure(
        provider="openai",
        base_url="https://example.invalid",
        api_key="test-key",
        model="shared-model",
    )
    state = OrganizationState(tmp_path)
    host_tools = HostTools(tmp_path)

    for agent_id in (2, 3):
        runtime.run(
            Activation(agent_id=agent_id, items=()),
            AgentRunContext(agent_id, state, host_tools),
        )

    assert calls == [("shared-model", 2), ("shared-model", 3)]


def test_observability_settings_never_return_the_secret_key() -> None:
    secret = "langfuse-secret"
    runtime = ModelRuntime(observability_session_factory=lambda _config: None)

    settings = runtime.configure_observability(
        enabled=True,
        base_url="https://langfuse.invalid",
        public_key="langfuse-public",
        secret_key=secret,
        environment="development",
        capture_content=True,
    )

    assert settings == {
        "enabled": True,
        "base_url": "https://langfuse.invalid",
        "public_key": "langfuse-public",
        "environment": "development",
        "capture_content": True,
        "has_secret_key": True,
    }
    assert secret not in repr(settings)
    assert (
        runtime.configure_observability(
            enabled=False,
            base_url="",
            public_key="",
            secret_key="",
            environment="",
            capture_content=False,
        )["has_secret_key"]
        is True
    )


def test_observability_reconfiguration_shuts_down_idle_exporters() -> None:
    shutdown_calls: list[int] = []
    providers: list[object] = []

    class RecordingProvider:
        def shutdown(self) -> None:
            shutdown_calls.append(id(self))

    def create_session(_config: ObservabilityConfig) -> ObservabilitySession:
        provider = RecordingProvider()
        providers.append(provider)
        instrumentation = InstrumentationSettings(
            tracer_provider=TracerProvider(),
            include_content=False,
        )
        return ObservabilitySession(provider, instrumentation)

    runtime = ModelRuntime(observability_session_factory=create_session)
    for public_key in ("first-public", "second-public"):
        runtime.configure_observability(
            enabled=True,
            base_url="https://langfuse.invalid",
            public_key=public_key,
            secret_key="test-secret",
            environment="test",
            capture_content=False,
        )

    assert shutdown_calls == [id(providers[0])]
    runtime.shutdown()
    assert shutdown_calls == [id(providers[0]), id(providers[1])]


def test_pydantic_runner_exports_content_only_when_enabled(tmp_path: Path) -> None:
    def exported_attributes(capture_content: bool) -> list[dict[str, Any]]:
        exporter = InMemorySpanExporter()
        session = create_observability_session(
            ObservabilityConfig(
                enabled=True,
                base_url="https://langfuse.invalid",
                public_key="test-public",
                secret_key="test-secret",
                environment="test",
                capture_content=capture_content,
            ),
            span_exporter=exporter,
        )
        runner = PydanticAgentRunner(
            ModelConfig(
                provider="openai",
                base_url="https://example.invalid/v1",
                api_key="test-key",
                model="test-model",
            ),
            session.instrumentation,
        )
        activation, context = activation_context(tmp_path)
        with runner._agent.override(
            model=TestModel(call_tools=[], custom_output_text="TRACE_RESPONSE")
        ):
            runner.run(activation, context)
        session.shutdown()
        return [dict(span.attributes or {}) for span in exporter.get_finished_spans()]

    hidden_attributes = exported_attributes(False)
    visible_attributes = exported_attributes(True)

    assert hidden_attributes
    assert all("Process this Activation" not in str(item) for item in hidden_attributes)
    assert any("Process this Activation" in str(item) for item in visible_attributes)
    assert any("TRACE_RESPONSE" in str(item) for item in visible_attributes)
    assert any(
        item.get("langfuse.trace.metadata.agent_id") == 2
        and item.get("langfuse.session.id") == "flowent-discussion-1"
        for item in visible_attributes
    )
    assert any("gen_ai.usage.output_tokens" in item for item in visible_attributes)


def test_missing_model_config_returns_runner_that_fails_on_activation(
    tmp_path: Path,
) -> None:
    runner = create_runner()
    activation, context = activation_context(tmp_path)

    with pytest.raises(AgentRunFailure, match="configuration is incomplete"):
        runner.run(activation, context)


def test_pydantic_model_errors_are_mapped_to_safe_message(tmp_path: Path) -> None:
    class FailingAgent:
        def run_sync(
            self,
            prompt: str,
            deps: AgentRunContext,
            metadata: dict[str, Any],
        ) -> Any:
            del prompt, deps, metadata
            raise ModelHTTPError(401, "secret upstream detail", "test-model")

    runner = object.__new__(PydanticAgentRunner)
    runner._instrumentation = None  # type: ignore[attr-defined]
    runner._agent = FailingAgent()  # type: ignore[attr-defined]
    activation, context = activation_context(tmp_path)

    with pytest.raises(AgentRunFailure, match="^Model request failed$"):
        runner.run(activation, context)
