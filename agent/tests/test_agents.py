from pathlib import Path

import pytest

from flowent_agent.agents import (
    AgentRunner,
    AgentRunRequest,
    ModelConfiguration,
)
from flowent_agent.agents.model_factory import chunk_text, create_model
from flowent_agent.persistence import RuntimeServices


def test_chunk_text_preserves_content() -> None:
    value = "Flowent streams from Python"

    assert "".join(chunk_text(value)) == value


def test_openai_compatible_model_requires_chat_api() -> None:
    with pytest.raises(ValueError, match="chat API mode"):
        ModelConfiguration(
            provider="openai_compatible",
            model="local-model",
            base_url="http://localhost:11434/v1",
        )


def test_demo_model_can_be_created_without_credentials() -> None:
    model = create_model(ModelConfiguration())

    assert model.model_name == "flowent-demo"


async def test_agent_runner_streams_and_persists_run(tmp_path: Path) -> None:
    services = await RuntimeServices.create(tmp_path)
    runner = AgentRunner(services.runs)
    request = AgentRunRequest(
        run_id="agent-run-1",
        conversation_id="conversation-1",
        messages=[{"role": "user", "content": "Build the runtime"}],
    )
    events: list[tuple[str, dict[str, object]]] = []

    async def emit(name: str, payload: dict[str, object]) -> None:
        events.append((name, payload))

    await runner.run(request, emit)

    record = await services.runs.get("agent-run-1")
    text = "".join(
        str(payload["delta"]) for name, payload in events if name == "agent.text_delta"
    )
    assert record is not None
    assert record.status == "completed"
    assert record.provider == "demo"
    assert record.usage["requests"] == 1
    assert text.startswith("I received")
    assert events[-1][0] == "agent.completed"
    await services.close()
