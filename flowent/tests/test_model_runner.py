from pathlib import Path
from typing import Any

import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)
from pydantic_ai import InstrumentationSettings
from pydantic_ai.exceptions import ModelHTTPError
from pydantic_ai.messages import ModelMessage
from pydantic_ai.models.anthropic import AnthropicModel
from pydantic_ai.models.function import AgentInfo, FunctionModel
from pydantic_ai.models.google import GoogleModel
from pydantic_ai.models.openai import OpenAIChatModel, OpenAIResponsesModel
from pydantic_ai.models.test import TestModel

from flowent.domain import Activation, OrganizationState
from flowent.host_tools import HostTools
from flowent.model_runner import (
    ApiType,
    ModelConfig,
    ModelRuntime,
    PydanticAgentRunner,
    create_runner,
)
from flowent.observability import (
    ObservabilityConfig,
    PydanticAIObservability,
    create_pydantic_ai_observability,
)
from flowent.runtime import AgentRunContext, AgentRunFailure


def activation_context(tmp_path: Path) -> tuple[Activation, AgentRunContext]:
    state = OrganizationState()
    state.create_agent("Ada")
    state.create_discussion("Work", 1, [2])
    activation = Activation(agent_id=2, discussion_id=1, message_id=1)
    return activation, AgentRunContext(
        agent_id=2,
        state=state,
        host_tools=HostTools(tmp_path),
    )


def test_model_config_repr_does_not_reveal_api_key() -> None:
    secret = "not-for-repr"

    config = ModelConfig(
        api_type="openai-chat",
        base_url="https://example.invalid/v1",
        api_key=secret,
        model="test-model",
    )

    assert secret not in repr(config)


def test_shared_model_settings_never_return_the_api_key() -> None:
    secret = "shared-secret"
    runtime = ModelRuntime()

    settings = runtime.configure(
        api_type="anthropic",
        base_url="https://example.invalid",
        api_key=secret,
        model="test-model",
    )

    assert settings == {
        "api_type": "anthropic",
        "base_url": "https://example.invalid",
        "model": "test-model",
        "has_api_key": True,
    }
    assert secret not in repr(runtime.settings())
    assert (
        runtime.configure(
            api_type="google",
            base_url="https://google.invalid",
            api_key="",
            model="gemini-test",
        )["has_api_key"]
        is True
    )


@pytest.mark.parametrize(
    ("api_type", "model_type"),
    [
        ("openai-chat", OpenAIChatModel),
        ("openai-responses", OpenAIResponsesModel),
        ("anthropic", AnthropicModel),
        ("google", GoogleModel),
    ],
)
def test_pydantic_runner_uses_the_selected_api_type(
    api_type: ApiType,
    model_type: type[Any],
) -> None:
    runner = PydanticAgentRunner(
        ModelConfig(
            api_type=api_type,
            base_url="https://example.invalid",
            api_key="test-key",
            model="test-model",
        )
    )

    assert isinstance(runner._agent.model, model_type)


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
        _observability: object,
    ) -> RecordingRunner:
        return RecordingRunner(config.model if config else "unavailable")

    monkeypatch.setattr(ModelRuntime, "_create_runner", create_recording_runner)
    runtime = ModelRuntime()
    runtime.configure(
        api_type="openai-chat",
        base_url="https://example.invalid",
        api_key="test-key",
        model="shared-model",
    )
    state = OrganizationState(tmp_path)
    host_tools = HostTools(tmp_path)

    for agent_id in (2, 3):
        runtime.run(
            Activation(agent_id=agent_id, discussion_id=1, message_id=1),
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

    def create_session(_config: ObservabilityConfig) -> PydanticAIObservability:
        provider = RecordingProvider()
        providers.append(provider)
        instrumentation = InstrumentationSettings(
            tracer_provider=TracerProvider(),
            include_content=False,
        )
        return PydanticAIObservability(provider, instrumentation)

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


def test_pydantic_runner_exports_only_pydantic_ai_spans(tmp_path: Path) -> None:
    def exported_spans(capture_content: bool) -> list[Any]:
        exporter = InMemorySpanExporter()
        observability = create_pydantic_ai_observability(
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
                api_type="openai-chat",
                base_url="https://example.invalid/v1",
                api_key="test-key",
                model="test-model",
            ),
            observability,
        )
        activation, context = activation_context(tmp_path)
        with runner._agent.override(
            model=TestModel(call_tools=[], custom_output_text="TRACE_RESPONSE")
        ):
            runner.run(activation, context)
        observability.shutdown()
        return list(exporter.get_finished_spans())

    hidden_spans = exported_spans(False)
    visible_spans = exported_spans(True)
    hidden_attributes = [dict(span.attributes or {}) for span in hidden_spans]
    visible_attributes = [dict(span.attributes or {}) for span in visible_spans]

    assert hidden_spans
    assert all(
        span.instrumentation_scope.name == "pydantic-ai" for span in visible_spans
    )
    assert all(span.name != "Flowent activation" for span in visible_spans)
    assert len({span.context.trace_id for span in visible_spans}) == 1
    assert all("Process this Activation" not in str(item) for item in hidden_attributes)
    assert any("Process this Activation" in str(item) for item in visible_attributes)
    assert any("TRACE_RESPONSE" in str(item) for item in visible_attributes)
    assert all(
        item.get("langfuse.trace.metadata.agent_id") == 2
        and item.get("langfuse.session.id") == "flowent-discussion-1"
        for item in visible_attributes
    )
    assert any("gen_ai.usage.output_tokens" in item for item in visible_attributes)


def test_pydantic_runner_continues_the_same_agent_message_history(
    tmp_path: Path,
) -> None:
    seen_messages: list[list[ModelMessage]] = []

    async def respond(
        messages: list[ModelMessage],
        _info: AgentInfo,
    ):
        seen_messages.append(list(messages))
        yield f"Reply {len(seen_messages)}"

    runner = PydanticAgentRunner(
        ModelConfig(
            api_type="openai-chat",
            base_url="https://example.invalid/v1",
            api_key="test-key",
            model="test-model",
        )
    )
    activation, first_context = activation_context(tmp_path)
    first_events: list[tuple[str, dict[str, Any]]] = []
    first_context = AgentRunContext(
        first_context.agent_id,
        first_context.state,
        first_context.host_tools,
        run_id="first-run",
        history_event_sink=lambda event_type, **data: first_events.append(
            (event_type, data)
        ),
    )
    with runner._agent.override(model=FunctionModel(stream_function=respond)):
        first = runner.run(activation, first_context)
        second = runner.run(
            activation,
            AgentRunContext(
                first_context.agent_id,
                first_context.state,
                first_context.host_tools,
                run_id="second-run",
                message_history=first.messages,
            ),
        )

    assert len(seen_messages) == 2
    assert len(seen_messages[0]) == 1
    assert len(seen_messages[1]) == 3
    assert seen_messages[1][0:2] == list(first.messages)
    assert len(first.messages) == 2
    assert len(second.messages) == 2
    assert first.messages[0].conversation_id == second.messages[0].conversation_id
    assert first.messages[0].run_id == "first-run"
    assert second.messages[0].run_id == "second-run"
    assert any(event_type == "text_delta" for event_type, _data in first_events)


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
            **_kwargs: Any,
        ) -> Any:
            del prompt, deps, metadata
            raise ModelHTTPError(401, "secret upstream detail", "test-model")

    runner = object.__new__(PydanticAgentRunner)
    runner._observability = None  # type: ignore[attr-defined]
    runner._agent = FailingAgent()  # type: ignore[attr-defined]
    activation, context = activation_context(tmp_path)

    with pytest.raises(AgentRunFailure, match="^Model request failed$"):
        runner.run(activation, context)
