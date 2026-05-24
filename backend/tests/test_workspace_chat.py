import asyncio
import time

import httpx
import pytest
from fastapi.testclient import TestClient

from flowent.agent import FLOWENT_AGENT_SYSTEM_PROMPT
from flowent.main import create_app
from flowent.sandbox import CommandResult, SandboxRunner


def configure_provider(
    client,
    *,
    base_url: str = "",
    model: str = "gpt-5.1",
    name: str = "OpenAI",
    provider_id: str = "provider-openai",
    provider_type: str = "openai",
    reasoning_effort: str = "default",
) -> None:
    client.post(
        "/api/providers",
        json={
            "api_key": "sk-local",
            "base_url": base_url,
            "id": provider_id,
            "models": [model],
            "name": name,
            "type": provider_type,
        },
    )
    client.put(
        "/api/settings",
        json={
            "reasoning_effort": reasoning_effort,
            "selected_model": model,
            "selected_provider_id": provider_id,
        },
    )


async def configure_provider_async(
    client: httpx.AsyncClient,
    *,
    base_url: str = "",
    model: str = "gpt-5.1",
    name: str = "OpenAI",
    provider_id: str = "provider-openai",
    provider_type: str = "openai",
    reasoning_effort: str = "default",
) -> None:
    await client.post(
        "/api/providers",
        json={
            "api_key": "sk-local",
            "base_url": base_url,
            "id": provider_id,
            "models": [model],
            "name": name,
            "type": provider_type,
        },
    )
    await client.put(
        "/api/settings",
        json={
            "reasoning_effort": reasoning_effort,
            "selected_model": model,
            "selected_provider_id": provider_id,
        },
    )


def project_context_message(request: dict[str, object]) -> dict[str, object] | None:
    for message in request["messages"]:
        if str(message["content"]).startswith("# AGENTS.md instructions for "):
            return message
    return None


def environment_context_message(request: dict[str, object]) -> dict[str, object]:
    for message in request["messages"]:
        if str(message["content"]).startswith("<environment_context>"):
            return message
    raise AssertionError("Environment context was not sent.")


def stream_events(content: str) -> list[dict[str, object]]:
    events: list[dict[str, object]] = []
    for raw_event in content.strip().split("\n\n"):
        event_type = ""
        data = ""
        for line in raw_event.splitlines():
            if line.startswith("event: "):
                event_type = line.removeprefix("event: ")
            if line.startswith("data: "):
                data = line.removeprefix("data: ")
        events.append({"event": event_type, "data": data})
    return events


def tool_call_chunk(
    name: str,
    arguments: str,
    *,
    call_id: str = "call-1",
) -> dict[str, object]:
    return {
        "choices": [
            {
                "delta": {
                    "tool_calls": [
                        {
                            "index": 0,
                            "id": call_id,
                            "type": "function",
                            "function": {
                                "arguments": arguments,
                                "name": name,
                            },
                        }
                    ]
                }
            }
        ]
    }


@pytest.mark.anyio
async def test_workspace_long_shell_command_does_not_block_health(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    command_started = asyncio.Event()
    command_can_finish = asyncio.Event()

    async def fake_run_async(self, command, **kwargs):
        command_started.set()
        await asyncio.wait_for(command_can_finish.wait(), timeout=2)
        return CommandResult(
            command=" ".join(command),
            exit_code=0,
            stderr="",
            stdout="slow command finished",
        )

    monkeypatch.setattr(SandboxRunner, "run_async", fake_run_async)

    captured_requests: list[dict[str, object]] = []

    async def fake_completion(**request: object) -> object:
        captured_requests.append(request)

        async def chunks() -> object:
            if len(captured_requests) == 1:
                yield tool_call_chunk("shell_command", '{"command": "slow"}')
            else:
                yield {"choices": [{"delta": {"content": "Done."}}]}

        return chunks()

    app = create_app(serve_frontend=False, chat_completion=fake_completion)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        await configure_provider_async(client)
        response_task = asyncio.create_task(
            client.post("/api/workspace/respond", json={"content": "Run slow."})
        )
        await asyncio.wait_for(command_started.wait(), timeout=2)
        start = time.perf_counter()
        health_response = await client.get("/api/health")
        elapsed = time.perf_counter() - start
        command_can_finish.set()
        response = await response_task

    assert health_response.status_code == 200
    assert health_response.json() == {"status": "ok"}
    assert elapsed < 0.2
    assert response.status_code == 200


def test_workspace_response_streams_selected_provider_model_and_history(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    captured_request: dict[str, object] = {}

    async def fake_completion(**request: object) -> object:
        captured_request.update(request)

        async def chunks() -> object:
            yield {"choices": [{"delta": {"content": "Here is "}}]}
            yield {"choices": [{"delta": {"content": "the launch checklist."}}]}

        return chunks()

    client = TestClient(
        create_app(serve_frontend=False, chat_completion=fake_completion)
    )
    configure_provider(
        client,
        base_url="https://api.example.test/v1",
        model="claude-sonnet-4-5",
        name="Anthropic",
        provider_id="provider-anthropic",
        provider_type="anthropic",
    )

    response = client.post(
        "/api/workspace/respond",
        json={"content": "Draft a launch checklist."},
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    events = stream_events(response.text)
    assert events[0]["event"] == "start"
    assert events[1] == {"event": "output_start", "data": '{"index": 1}'}
    assert events[2] == {"event": "delta", "data": '{"content": "Here is "}'}
    assert events[3] == {
        "event": "delta",
        "data": '{"content": "the launch checklist."}',
    }
    assert '"author": "assistant"' in str(events[4]["data"])
    assert '"content": "Here is the launch checklist."' in str(events[4]["data"])
    assert captured_request["api_base"] == "https://api.example.test/v1"
    assert captured_request["api_key"] == "sk-local"
    assert captured_request["messages"][0] == {
        "role": "system",
        "content": FLOWENT_AGENT_SYSTEM_PROMPT,
    }
    assert project_context_message(captured_request) is None
    assert environment_context_message(captured_request)["role"] == "user"
    assert captured_request["messages"][-1] == {
        "role": "user",
        "content": "Draft a launch checklist.",
    }
    assert captured_request["model"] == "anthropic/claude-sonnet-4-5"
    assert captured_request["stream"] is True
    assert isinstance(captured_request["tools"], list)


def test_workspace_response_requires_selected_provider_and_model(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    client = TestClient(create_app(serve_frontend=False))

    response = client.post(
        "/api/workspace/respond",
        json={"content": "Draft a launch checklist."},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Choose a provider and model before sending."


def test_workspace_compact_persists_compacted_context(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    captured_request: dict[str, object] = {}

    async def fake_completion(**request: object) -> dict[str, object]:
        captured_request.update(request)
        return {
            "choices": [
                {
                    "message": {
                        "content": "Keep the launch checklist and provider setup decisions.",
                        "role": "assistant",
                    }
                }
            ]
        }

    client = TestClient(
        create_app(serve_frontend=False, chat_completion=fake_completion)
    )
    configure_provider(client)
    client.put(
        "/api/workspace/messages",
        json={
            "messages": [
                {
                    "author": "user",
                    "content": "Draft a launch checklist.",
                    "id": "message-1",
                },
                {
                    "author": "assistant",
                    "content": "Use provider setup first.",
                    "id": "message-2",
                },
            ]
        },
    )

    response = client.post("/api/workspace/compact")

    assert response.status_code == 200
    body = response.json()
    assert body == {
        "message": {
            "author": "system",
            "content": "Context compacted",
            "id": body["message"]["id"],
            "tools": [],
        }
    }
    assert captured_request["model"] == "openai/gpt-5.1"
    assert captured_request["messages"][0] == {
        "role": "system",
        "content": "You are compacting Flowent workspace context.",
    }
    assert "AGENTS.md instructions" not in captured_request["messages"][-1]["content"]
    assert "<environment_context>" in captured_request["messages"][-1]["content"]
    assert captured_request["messages"][-1]["role"] == "user"
    assert "Draft a launch checklist." in captured_request["messages"][-1]["content"]
    assert "Use provider setup first." in captured_request["messages"][-1]["content"]

    state = client.get("/api/state").json()
    assert state["messages"][-1] == body["message"]


def test_workspace_response_uses_compacted_context_after_compact(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    captured_requests: list[dict[str, object]] = []

    async def fake_completion(**request: object) -> object:
        captured_requests.append(request)
        if len(captured_requests) == 1:
            return {
                "choices": [
                    {
                        "message": {
                            "content": "Keep the provider setup decision.",
                            "role": "assistant",
                        }
                    }
                ]
            }

        async def chunks() -> object:
            yield {"choices": [{"delta": {"content": "Continuing."}}]}

        return chunks()

    client = TestClient(
        create_app(serve_frontend=False, chat_completion=fake_completion)
    )
    configure_provider(client)
    client.put(
        "/api/workspace/messages",
        json={
            "messages": [
                {
                    "author": "user",
                    "content": "Original detailed request.",
                    "id": "message-1",
                },
                {
                    "author": "assistant",
                    "content": "Original detailed reply.",
                    "id": "message-2",
                },
            ]
        },
    )

    compact_response = client.post("/api/workspace/compact")
    response = client.post(
        "/api/workspace/respond",
        json={"content": "Continue from there."},
    )

    assert compact_response.status_code == 200
    assert response.status_code == 200
    response_messages = captured_requests[1]["messages"]
    assert response_messages[0] == {
        "role": "system",
        "content": FLOWENT_AGENT_SYSTEM_PROMPT,
    }
    assert project_context_message(captured_requests[1]) is None
    assert environment_context_message(captured_requests[1])["role"] == "user"
    assert response_messages[-3:] == [
        {"role": "user", "content": "Context compacted"},
        {"role": "assistant", "content": "Keep the provider setup decision."},
        {"role": "user", "content": "Continue from there."},
    ]


def test_workspace_response_includes_project_and_environment_context(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    (tmp_path / ".git").mkdir()
    (tmp_path / "AGENTS.md").write_text("Use concise replies.")
    captured_request: dict[str, object] = {}

    async def fake_completion(**request: object) -> object:
        captured_request.update(request)

        async def chunks() -> object:
            yield {"choices": [{"delta": {"content": "Done."}}]}

        return chunks()

    client = TestClient(
        create_app(serve_frontend=False, chat_completion=fake_completion)
    )
    configure_provider(client)

    response = client.post("/api/workspace/respond", json={"content": "Hello."})

    assert response.status_code == 200
    assert captured_request["messages"][0] == {
        "role": "system",
        "content": FLOWENT_AGENT_SYSTEM_PROMPT,
    }
    project_message = project_context_message(captured_request)
    assert project_message == {
        "role": "user",
        "content": (
            f"# AGENTS.md instructions for {tmp_path}\n\n"
            "<INSTRUCTIONS>\nUse concise replies.\n</INSTRUCTIONS>"
        ),
    }
    environment_message = environment_context_message(captured_request)
    assert environment_message["role"] == "user"
    assert f"<cwd>{tmp_path}</cwd>" in environment_message["content"]
    assert "<filesystem>workspace-write</filesystem>" in environment_message["content"]
    assert "<network>enabled</network>" in environment_message["content"]
    assert "<tool>read_file</tool>" in environment_message["content"]
    assert captured_request["messages"][-1] == {
        "role": "user",
        "content": "Hello.",
    }


def test_workspace_response_uses_selected_reasoning_effort(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    captured_request: dict[str, object] = {}

    async def fake_completion(**request: object) -> object:
        captured_request.update(request)

        async def chunks() -> object:
            yield {"choices": [{"delta": {"content": "Done."}}]}

        return chunks()

    client = TestClient(
        create_app(serve_frontend=False, chat_completion=fake_completion)
    )
    configure_provider(client, reasoning_effort="xhigh")

    response = client.post("/api/workspace/respond", json={"content": "Hello."})

    assert response.status_code == 200
    assert captured_request["reasoning_effort"] == "xhigh"


def test_workspace_response_prefers_agents_override(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    (tmp_path / ".git").mkdir()
    (tmp_path / "AGENTS.md").write_text("Versioned instructions.")
    (tmp_path / "AGENTS.override.md").write_text("Local override instructions.")
    captured_request: dict[str, object] = {}

    async def fake_completion(**request: object) -> object:
        captured_request.update(request)

        async def chunks() -> object:
            yield {"choices": [{"delta": {"content": "Done."}}]}

        return chunks()

    client = TestClient(
        create_app(serve_frontend=False, chat_completion=fake_completion)
    )
    configure_provider(client)

    response = client.post("/api/workspace/respond", json={"content": "Hello."})

    assert response.status_code == 200
    project_message = project_context_message(captured_request)
    assert project_message is not None
    assert "Local override instructions." in project_message["content"]
    assert "Versioned instructions." not in project_message["content"]


def test_workspace_response_merges_project_instructions_from_root_to_cwd(
    tmp_path, monkeypatch
) -> None:
    repo = tmp_path / "repo"
    nested = repo / "packages" / "agent"
    nested.mkdir(parents=True)
    (repo / ".git").mkdir()
    (repo / "AGENTS.md").write_text("Root instructions.")
    (nested / "AGENTS.md").write_text("Nested instructions.")
    monkeypatch.chdir(nested)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    captured_request: dict[str, object] = {}

    async def fake_completion(**request: object) -> object:
        captured_request.update(request)

        async def chunks() -> object:
            yield {"choices": [{"delta": {"content": "Done."}}]}

        return chunks()

    client = TestClient(
        create_app(serve_frontend=False, chat_completion=fake_completion)
    )
    configure_provider(client)

    response = client.post("/api/workspace/respond", json={"content": "Hello."})

    assert response.status_code == 200
    project_message = project_context_message(captured_request)
    assert project_message is not None
    assert project_message["content"].index("Root instructions.") < project_message[
        "content"
    ].index("Nested instructions.")


def test_workspace_response_uses_updated_project_instructions(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    (tmp_path / ".git").mkdir()
    agents_file = tmp_path / "AGENTS.md"
    agents_file.write_text("Old instructions.")
    captured_requests: list[dict[str, object]] = []

    async def fake_completion(**request: object) -> object:
        captured_requests.append(request)

        async def chunks() -> object:
            yield {"choices": [{"delta": {"content": "Done."}}]}

        return chunks()

    client = TestClient(
        create_app(serve_frontend=False, chat_completion=fake_completion)
    )
    configure_provider(client)

    first_response = client.post("/api/workspace/respond", json={"content": "First."})
    agents_file.write_text("Updated instructions.")
    second_response = client.post("/api/workspace/respond", json={"content": "Second."})

    assert first_response.status_code == 200
    assert second_response.status_code == 200
    first_project_message = project_context_message(captured_requests[0])
    second_project_message = project_context_message(captured_requests[1])
    assert first_project_message is not None
    assert second_project_message is not None
    assert "Old instructions." in first_project_message["content"]
    assert "Updated instructions." in second_project_message["content"]
    assert "Old instructions." not in second_project_message["content"]


def test_workspace_context_is_not_persisted_in_state(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    (tmp_path / ".git").mkdir()
    (tmp_path / "AGENTS.md").write_text("Hidden instructions.")

    async def fake_completion(**request: object) -> object:
        async def chunks() -> object:
            yield {"choices": [{"delta": {"content": "Done."}}]}

        return chunks()

    client = TestClient(
        create_app(serve_frontend=False, chat_completion=fake_completion)
    )
    configure_provider(client)

    response = client.post("/api/workspace/respond", json={"content": "Hello."})
    state = client.get("/api/state").json()

    assert response.status_code == 200
    persisted_content = "\n".join(message["content"] for message in state["messages"])
    assert "Hidden instructions." not in persisted_content
    assert "<environment_context>" not in persisted_content


def test_workspace_clear_keeps_runtime_context_available(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    (tmp_path / ".git").mkdir()
    (tmp_path / "AGENTS.md").write_text("Instructions after clear.")
    captured_requests: list[dict[str, object]] = []

    async def fake_completion(**request: object) -> object:
        captured_requests.append(request)

        async def chunks() -> object:
            yield {"choices": [{"delta": {"content": "Done."}}]}

        return chunks()

    client = TestClient(
        create_app(serve_frontend=False, chat_completion=fake_completion)
    )
    configure_provider(client)

    first_response = client.post("/api/workspace/respond", json={"content": "First."})
    clear_response = client.put("/api/workspace/messages", json={"messages": []})
    second_response = client.post("/api/workspace/respond", json={"content": "Second."})

    assert first_response.status_code == 200
    assert clear_response.status_code == 200
    assert second_response.status_code == 200
    project_message = project_context_message(captured_requests[1])
    assert project_message is not None
    assert "Instructions after clear." in project_message["content"]
    assert environment_context_message(captured_requests[1])["role"] == "user"


def test_workspace_compacted_response_includes_latest_runtime_context(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    (tmp_path / ".git").mkdir()
    agents_file = tmp_path / "AGENTS.md"
    agents_file.write_text("Instructions before compact.")
    captured_requests: list[dict[str, object]] = []

    async def fake_completion(**request: object) -> object:
        captured_requests.append(request)
        if len(captured_requests) == 1:
            return {
                "choices": [
                    {
                        "message": {
                            "content": "Keep compacted state.",
                            "role": "assistant",
                        }
                    }
                ]
            }

        async def chunks() -> object:
            yield {"choices": [{"delta": {"content": "Done."}}]}

        return chunks()

    client = TestClient(
        create_app(serve_frontend=False, chat_completion=fake_completion)
    )
    configure_provider(client)
    client.put(
        "/api/workspace/messages",
        json={
            "messages": [
                {"author": "user", "content": "Original request.", "id": "message-1"}
            ]
        },
    )

    compact_response = client.post("/api/workspace/compact")
    agents_file.write_text("Instructions after compact.")
    response = client.post("/api/workspace/respond", json={"content": "Continue."})

    assert compact_response.status_code == 200
    assert response.status_code == 200
    response_messages = captured_requests[1]["messages"]
    project_message = project_context_message(captured_requests[1])
    assert project_message is not None
    assert "Instructions after compact." in project_message["content"]
    assert environment_context_message(captured_requests[1])["role"] == "user"
    assert {
        "role": "assistant",
        "content": "Keep compacted state.",
    } in response_messages


def test_project_instructions_are_truncated_to_size_limit(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("FLOWENT_PROJECT_INSTRUCTIONS_MAX_BYTES", "12")
    (tmp_path / ".git").mkdir()
    (tmp_path / "AGENTS.md").write_text("1234567890abcdef")
    captured_request: dict[str, object] = {}

    async def fake_completion(**request: object) -> object:
        captured_request.update(request)

        async def chunks() -> object:
            yield {"choices": [{"delta": {"content": "Done."}}]}

        return chunks()

    client = TestClient(
        create_app(serve_frontend=False, chat_completion=fake_completion)
    )
    configure_provider(client)

    response = client.post("/api/workspace/respond", json={"content": "Hello."})

    assert response.status_code == 200
    project_message = project_context_message(captured_request)
    assert project_message is not None
    assert "1234567890ab" in project_message["content"]
    assert "cdef" not in project_message["content"]


@pytest.mark.anyio
async def test_workspace_persists_tool_start_during_stream(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    command_started = asyncio.Event()
    command_can_finish = asyncio.Event()

    async def fake_run_async(self, command, **kwargs):
        command_started.set()
        await asyncio.wait_for(command_can_finish.wait(), timeout=2)
        return CommandResult(
            command=" ".join(command),
            exit_code=0,
            stderr="",
            stdout="Launch notes",
        )

    monkeypatch.setattr(SandboxRunner, "run_async", fake_run_async)

    async def fake_completion(**request: object) -> object:
        async def chunks() -> object:
            if request["messages"][-1]["role"] == "user":
                yield tool_call_chunk("shell_command", '{"command": "slow"}')
            else:
                yield {"choices": [{"delta": {"content": "Done."}}]}

        return chunks()

    app = create_app(serve_frontend=False, chat_completion=fake_completion)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        await configure_provider_async(client)
        response_task = asyncio.create_task(
            client.post("/api/workspace/respond", json={"content": "Read notes."})
        )
        await asyncio.wait_for(command_started.wait(), timeout=2)
        state = (await client.get("/api/state")).json()
        command_can_finish.set()
        response = await response_task

    assistant = state["messages"][-1]
    assert response.status_code == 200
    assert assistant["author"] == "assistant"
    assert assistant["status"] == "running"
    assert assistant["tools"][0]["name"] == "shell_command"
    assert assistant["tools"][0]["status"] == "running"


@pytest.mark.anyio
async def test_workspace_persists_tool_result_during_stream(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    (tmp_path / "notes.txt").write_text("Launch notes")
    second_round_started = asyncio.Event()
    continue_stream = asyncio.Event()

    async def fake_completion(**request: object) -> object:
        async def chunks() -> object:
            if request["messages"][-1]["role"] == "user":
                yield tool_call_chunk("read_file", '{"path": "notes.txt"}')
                return
            second_round_started.set()
            await asyncio.wait_for(continue_stream.wait(), timeout=2)
            yield {"choices": [{"delta": {"content": "Done."}}]}

        return chunks()

    app = create_app(serve_frontend=False, chat_completion=fake_completion)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        await configure_provider_async(client)
        response_task = asyncio.create_task(
            client.post("/api/workspace/respond", json={"content": "Read notes."})
        )
        await asyncio.wait_for(second_round_started.wait(), timeout=2)
        state = (await client.get("/api/state")).json()
        continue_stream.set()
        response = await response_task

    assistant = state["messages"][-1]
    assert response.status_code == 200
    assert assistant["status"] == "running"
    assert assistant["tools"][0]["status"] == "success"
    assert assistant["tools"][0]["content"] == "Launch notes"


def test_workspace_persists_failed_draft_when_stream_errors(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))

    async def fake_completion(**request: object) -> object:
        async def chunks() -> object:
            yield {"choices": [{"delta": {"content": "Partial answer."}}]}
            raise RuntimeError("provider stopped")

        return chunks()

    client = TestClient(
        create_app(serve_frontend=False, chat_completion=fake_completion)
    )
    configure_provider(client)

    response = client.post("/api/workspace/respond", json={"content": "Hello."})

    assert response.status_code == 200
    events = stream_events(response.text)
    assert events[-1]["event"] == "error"
    state = client.get("/api/state").json()
    assistant = state["messages"][-1]
    assert assistant["author"] == "assistant"
    assert assistant["content"] == "Partial answer."
    assert assistant["status"] == "failed"


def test_workspace_marks_draft_complete_when_stream_finishes(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))

    async def fake_completion(**request: object) -> object:
        async def chunks() -> object:
            yield {"choices": [{"delta": {"content": "Done."}}]}

        return chunks()

    client = TestClient(
        create_app(serve_frontend=False, chat_completion=fake_completion)
    )
    configure_provider(client)

    response = client.post("/api/workspace/respond", json={"content": "Hello."})

    assert response.status_code == 200
    state = client.get("/api/state").json()
    assistant = state["messages"][-1]
    assert assistant["author"] == "assistant"
    assert assistant["content"] == "Done."
    assert assistant.get("status", "completed") == "completed"
