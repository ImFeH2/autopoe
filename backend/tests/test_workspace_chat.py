import asyncio
import json
import time

import httpx
import pytest
from fastapi.testclient import TestClient

from flowent.agent import FLOWENT_AGENT_SYSTEM_PROMPT
from flowent.compact import (
    COMPACT_SUMMARY_PREFIX,
    build_replacement_history,
    retained_recent_user_messages,
)
from flowent.llm import ChatMessage
from flowent.main import create_app
from flowent.sandbox import CommandResult, SandboxRunner
from flowent.storage import StoredMessage


def configure_provider(
    client,
    *,
    agent_prompt: str = "",
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
            "agent_prompt": agent_prompt,
            "reasoning_effort": reasoning_effort,
            "selected_model": model,
            "selected_provider_id": provider_id,
        },
    )


async def configure_provider_async(
    client: httpx.AsyncClient,
    *,
    agent_prompt: str = "",
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
            "agent_prompt": agent_prompt,
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


def content_index(messages: list[dict[str, object]], content: str) -> int:
    for index, message in enumerate(messages):
        if message["content"] == content:
            return index
    raise AssertionError(f"Message content not found: {content}")


def compact_summary_messages(
    messages: list[dict[str, object]],
) -> list[dict[str, object]]:
    return [
        message
        for message in messages
        if str(message["content"]).startswith(COMPACT_SUMMARY_PREFIX)
    ]


def compact_summary_index(messages: list[dict[str, object]]) -> int:
    summaries = compact_summary_messages(messages)
    assert len(summaries) == 1
    return content_index(messages, str(summaries[0]["content"]))


def test_build_replacement_history_keeps_recent_user_messages_without_assistant() -> (
    None
):
    history = build_replacement_history(
        "Keep the provider setup decision.",
        [
            StoredMessage(author="user", content="Original request.", id="message-1"),
            StoredMessage(
                author="assistant", content="Original reply.", id="message-2"
            ),
            StoredMessage(author="system", content="Context compacted", id="message-3"),
            StoredMessage(author="user", content="Follow-up request.", id="message-4"),
        ],
    )

    assert history == [
        ChatMessage(role="user", content="Original request."),
        ChatMessage(role="user", content="Follow-up request."),
        ChatMessage(
            role="user",
            content=f"{COMPACT_SUMMARY_PREFIX}Keep the provider setup decision.",
        ),
    ]


def test_retained_recent_user_messages_respects_budget() -> None:
    history = retained_recent_user_messages(
        [
            StoredMessage(author="user", content="older message", id="message-1"),
            StoredMessage(author="user", content="recent message", id="message-2"),
        ],
        token_budget=4,
    )

    assert history == [ChatMessage(role="user", content="recent message")]


def test_retained_recent_user_messages_truncates_latest_oversized_message() -> None:
    history = retained_recent_user_messages(
        [
            StoredMessage(author="user", content="0123456789abcdef", id="message-1"),
        ],
        token_budget=2,
    )

    assert history == [ChatMessage(role="user", content="0123…2 tokens truncated…cdef")]


def test_build_replacement_history_places_compact_summary_after_retained_users() -> (
    None
):
    history = build_replacement_history(
        "Keep current task state.",
        [
            StoredMessage(author="user", content="First request.", id="message-1"),
            StoredMessage(author="user", content="Latest request.", id="message-2"),
        ],
    )

    assert history[-1] == ChatMessage(
        role="user",
        content=f"{COMPACT_SUMMARY_PREFIX}Keep current task state.",
    )


def test_build_replacement_history_excludes_compact_markers() -> None:
    history = build_replacement_history(
        "Keep current task state.",
        [
            StoredMessage(author="user", content="Before compact.", id="message-1"),
            StoredMessage(author="system", content="Context compacted", id="message-2"),
        ],
    )

    assert ChatMessage(role="user", content="Context compacted") not in history


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
            ],
            "usage": {
                "completion_tokens": 12,
                "prompt_tokens": 130,
                "prompt_tokens_details": {"cached_tokens": 20},
                "total_tokens": 142,
            },
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
    assert body["message"] == {
        "author": "system",
        "content": "Context compacted",
        "id": body["message"]["id"],
        "tools": [],
        "usage_info": body["usage_info"],
    }
    assert body["usage_info"] == {
        "last_token_usage": {
            "cached_input_tokens": 0,
            "input_tokens": 0,
            "output_tokens": 0,
            "reasoning_output_tokens": 0,
            "total_tokens": 103,
        },
        "model_context_window": 120000,
        "total_token_usage": {
            "cached_input_tokens": 20,
            "input_tokens": 130,
            "output_tokens": 12,
            "reasoning_output_tokens": 0,
            "total_tokens": 142,
        },
    }
    assert captured_request["model"] == "openai/gpt-5.1"
    assert captured_request["messages"][0] == {
        "role": "system",
        "content": "You are performing a context checkpoint compaction for Flowent.",
    }
    assert "AGENTS.md instructions" not in captured_request["messages"][-1]["content"]
    assert "<environment_context>" in captured_request["messages"][-1]["content"]
    assert captured_request["messages"][-1]["role"] == "user"
    assert (
        "CONTEXT CHECKPOINT COMPACTION" in captured_request["messages"][-1]["content"]
    )
    assert "Draft a launch checklist." in captured_request["messages"][-1]["content"]
    assert "Use provider setup first." in captured_request["messages"][-1]["content"]

    state = client.get("/api/state").json()
    assert state["messages"][-1] == body["message"]
    assert state["usage_info"] == body["usage_info"]


@pytest.mark.anyio
async def test_workspace_state_exposes_manual_compact_progress(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    compact_started = asyncio.Event()
    compact_can_finish = asyncio.Event()

    async def fake_completion(**request: object) -> dict[str, object]:
        compact_started.set()
        await asyncio.wait_for(compact_can_finish.wait(), timeout=2)
        return {
            "choices": [
                {
                    "message": {
                        "content": "Keep the launch checklist.",
                        "role": "assistant",
                    }
                }
            ]
        }

    app = create_app(serve_frontend=False, chat_completion=fake_completion)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        await configure_provider_async(client)
        await client.put(
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
        compact_response_task = asyncio.create_task(
            client.post("/api/workspace/compact")
        )
        await asyncio.wait_for(compact_started.wait(), timeout=2)
        active_state = (await client.get("/api/state")).json()
        compact_can_finish.set()
        compact_response = await compact_response_task
        finished_state = (await client.get("/api/state")).json()

    assert active_state["is_compacting"] is True
    assert compact_response.status_code == 200
    assert finished_state["is_compacting"] is False
    assert finished_state["messages"][-1]["content"] == "Context compacted"


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
    compacted_messages = [
        message
        for message in response_messages
        if str(message["content"]).startswith(
            "Another language model started working on this Flowent workspace session"
        )
    ]
    assert len(compacted_messages) == 1
    assert "Keep the provider setup decision." in compacted_messages[0]["content"]
    assert response_messages[
        content_index(response_messages, "Original detailed request.")
    ] == {
        "role": "user",
        "content": "Original detailed request.",
    }
    assert {
        "role": "assistant",
        "content": "Original detailed reply.",
    } not in response_messages
    assert content_index(
        response_messages, "Original detailed request."
    ) < compact_summary_index(response_messages)
    assert response_messages[-1] == {
        "role": "user",
        "content": "Continue from there.",
    }
    assert {"role": "user", "content": "Context compacted"} not in response_messages


def test_workspace_response_auto_compacts_before_next_message(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("FLOWENT_AUTO_COMPACT_TOKEN_LIMIT", "120")
    captured_requests: list[dict[str, object]] = []

    async def fake_completion(**request: object) -> object:
        captured_requests.append(request)
        if not request.get("stream"):
            return {
                "choices": [
                    {
                        "message": {
                            "content": "Keep the launch plan summary.",
                            "role": "assistant",
                        }
                    }
                ],
                "usage": {
                    "completion_tokens": 8,
                    "prompt_tokens": 200,
                    "total_tokens": 208,
                },
            }

        async def chunks() -> object:
            yield {
                "choices": [{"delta": {}}],
                "usage": {
                    "completion_tokens": 3,
                    "completion_tokens_details": {"reasoning_tokens": 1},
                    "prompt_tokens": 44,
                    "prompt_tokens_details": {"cached_tokens": 7},
                    "total_tokens": 47,
                },
            }
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
                    "content": "Original request. " * 80,
                    "id": "message-1",
                },
                {
                    "author": "assistant",
                    "content": "Detailed work log. " * 80,
                    "id": "message-2",
                },
            ]
        },
    )

    response = client.post(
        "/api/workspace/respond",
        json={"content": "Continue from there."},
    )

    assert response.status_code == 200
    events = stream_events(response.text)
    assert events[0]["event"] == "context_optimized"
    optimized_event_data = json.loads(events[0]["data"])
    assert optimized_event_data["message"]["content"] == ("Context optimized")
    assert (
        optimized_event_data["message"]["usage_info"]
        == optimized_event_data["usage_info"]
    )
    usage_events = [event for event in events if event["event"] == "usage"]
    assert len(usage_events) == 1
    assert json.loads(usage_events[0]["data"])["usage_info"] == {
        "last_token_usage": {
            "cached_input_tokens": 7,
            "input_tokens": 44,
            "output_tokens": 3,
            "reasoning_output_tokens": 1,
            "total_tokens": 47,
        },
        "model_context_window": 120000,
        "total_token_usage": {
            "cached_input_tokens": 7,
            "input_tokens": 244,
            "output_tokens": 11,
            "reasoning_output_tokens": 1,
            "total_tokens": 255,
        },
    }
    assert len(captured_requests) == 2
    assert (
        "CONTEXT CHECKPOINT COMPACTION"
        in captured_requests[0]["messages"][-1]["content"]
    )
    response_messages = captured_requests[1]["messages"]
    compacted_messages = [
        message
        for message in response_messages
        if str(message["content"]).startswith(
            "Another language model started working on this Flowent workspace session"
        )
    ]
    assert len(compacted_messages) == 1
    assert "Keep the launch plan summary." in compacted_messages[0]["content"]
    assert {
        "role": "assistant",
        "content": "Detailed work log. " * 80,
    } not in response_messages
    assert content_index(
        response_messages, "Original request. " * 80
    ) < compact_summary_index(response_messages)
    assert {"role": "user", "content": "Context optimized"} not in response_messages
    state = client.get("/api/state").json()
    assert [message["content"] for message in state["messages"]][-3:] == [
        "Context optimized",
        "Continue from there.",
        "Continuing.",
    ]
    assert state["usage_info"] == json.loads(usage_events[0]["data"])["usage_info"]
    assert state["messages"][-1]["usage_info"] == state["usage_info"]


def test_workspace_response_auto_compacts_after_tool_result(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("FLOWENT_AUTO_COMPACT_TOKEN_LIMIT", "1200")
    (tmp_path / "notes.txt").write_text("Launch notes. " * 600)
    captured_requests: list[dict[str, object]] = []

    async def fake_completion(**request: object) -> object:
        captured_requests.append(request)
        if not request.get("stream"):
            return {
                "choices": [
                    {
                        "message": {
                            "content": "Keep the file findings from notes.txt.",
                            "role": "assistant",
                        }
                    }
                ]
            }

        async def chunks() -> object:
            if len(captured_requests) == 1:
                yield tool_call_chunk("read_file", '{"path": "notes.txt"}')
                return
            yield {
                "choices": [{"delta": {}}],
                "usage": {
                    "input_tokens": 70,
                    "cached_input_tokens": 5,
                    "output_tokens": 4,
                    "reasoning_output_tokens": 2,
                    "total_tokens": 74,
                },
            }
            yield {"choices": [{"delta": {"content": "Done."}}]}

        return chunks()

    client = TestClient(
        create_app(serve_frontend=False, chat_completion=fake_completion)
    )
    configure_provider(client)

    response = client.post(
        "/api/workspace/respond",
        json={"content": "Read the launch notes."},
    )

    assert response.status_code == 200
    events = stream_events(response.text)
    assert [event["event"] for event in events] == [
        "start",
        "output_start",
        "tool_start",
        "tool_done",
        "context_optimized",
        "output_start",
        "usage",
        "delta",
        "done",
    ]
    assert json.loads(events[4]["data"])["message"]["content"] == ("Context optimized")
    assert json.loads(events[6]["data"])["usage_info"]["last_token_usage"] == {
        "cached_input_tokens": 5,
        "input_tokens": 70,
        "output_tokens": 4,
        "reasoning_output_tokens": 2,
        "total_tokens": 74,
    }
    assert len(captured_requests) == 3
    assert "Launch notes." in captured_requests[1]["messages"][-1]["content"]
    response_messages = captured_requests[2]["messages"]
    compacted_messages = [
        message
        for message in response_messages
        if str(message["content"]).startswith(
            "Another language model started working on this Flowent workspace session"
        )
    ]
    assert len(compacted_messages) == 1
    assert "Keep the file findings from notes.txt." in compacted_messages[0]["content"]
    state = client.get("/api/state").json()
    assert [message["content"] for message in state["messages"]] == [
        "Read the launch notes.",
        "Context optimized",
        "Done.",
    ]


def test_workspace_auto_compact_failure_keeps_existing_checkpoint(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("FLOWENT_AUTO_COMPACT_TOKEN_LIMIT", "120")

    async def fake_completion(**request: object) -> object:
        if not request.get("stream"):
            raise RuntimeError("summary failed")

        async def chunks() -> object:
            yield {"choices": [{"delta": {"content": "Should not run."}}]}

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
                    "content": "Original request. " * 80,
                    "id": "message-1",
                }
            ]
        },
    )

    response = client.post(
        "/api/workspace/respond",
        json={"content": "Continue from there."},
    )

    assert response.status_code == 200
    events = stream_events(response.text)
    assert events[-1]["event"] == "error"
    assert json.loads(events[-1]["data"])["message"] == (
        "Context could not be optimized."
    )
    state = client.get("/api/state").json()
    assert "Context optimized" not in [
        message["content"] for message in state["messages"]
    ]


def test_workspace_response_uses_auto_compaction_checkpoint_after_restart(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("FLOWENT_AUTO_COMPACT_TOKEN_LIMIT", "120")
    captured_requests: list[dict[str, object]] = []

    async def fake_completion(**request: object) -> object:
        captured_requests.append(request)
        if not request.get("stream"):
            return {
                "choices": [
                    {
                        "message": {
                            "content": "Auto checkpoint survives restarts.",
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
                    "content": "Original request. " * 80,
                    "id": "message-1",
                }
            ]
        },
    )

    first_response = client.post(
        "/api/workspace/respond",
        json={"content": "Continue from there."},
    )
    monkeypatch.setenv("FLOWENT_AUTO_COMPACT_TOKEN_LIMIT", "100000")
    restarted_client = TestClient(
        create_app(serve_frontend=False, chat_completion=fake_completion)
    )
    second_response = restarted_client.post(
        "/api/workspace/respond",
        json={"content": "Continue after restart."},
    )

    assert first_response.status_code == 200
    assert second_response.status_code == 200
    response_messages = captured_requests[2]["messages"]
    compacted_messages = [
        message
        for message in response_messages
        if str(message["content"]).startswith(
            "Another language model started working on this Flowent workspace session"
        )
    ]
    assert len(compacted_messages) == 1
    assert "Auto checkpoint survives restarts." in compacted_messages[0]["content"]
    assert content_index(
        response_messages, "Original request. " * 80
    ) < compact_summary_index(response_messages)
    assert {"role": "user", "content": "Context optimized"} not in response_messages
    assert response_messages[-1] == {
        "role": "user",
        "content": "Continue after restart.",
    }


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


def test_workspace_response_uses_flowent_workdir(tmp_path, monkeypatch) -> None:
    launch_dir = tmp_path / "launch"
    workdir = tmp_path / "workspace"
    data_dir = tmp_path / "data"
    launch_dir.mkdir()
    workdir.mkdir()
    monkeypatch.chdir(launch_dir)
    monkeypatch.setenv("FLOWENT_WORKDIR", str(workdir))
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(data_dir))
    (workdir / ".git").mkdir()
    (workdir / "AGENTS.md").write_text("Use workspace instructions.")
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
    assert project_message == {
        "role": "user",
        "content": (
            f"# AGENTS.md instructions for {workdir}\n\n"
            "<INSTRUCTIONS>\nUse workspace instructions.\n</INSTRUCTIONS>"
        ),
    }
    environment_message = environment_context_message(captured_request)
    assert f"<cwd>{workdir}</cwd>" in environment_message["content"]


def test_create_app_workdir_overrides_flowent_workdir(tmp_path, monkeypatch) -> None:
    env_workdir = tmp_path / "env-workspace"
    app_workdir = tmp_path / "app-workspace"
    data_dir = tmp_path / "data"
    env_workdir.mkdir()
    app_workdir.mkdir()
    monkeypatch.setenv("FLOWENT_WORKDIR", str(env_workdir))
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(data_dir))
    (env_workdir / ".git").mkdir()
    (app_workdir / ".git").mkdir()
    (env_workdir / "AGENTS.md").write_text("Use env instructions.")
    (app_workdir / "AGENTS.md").write_text("Use app instructions.")
    captured_request: dict[str, object] = {}

    async def fake_completion(**request: object) -> object:
        captured_request.update(request)

        async def chunks() -> object:
            yield {"choices": [{"delta": {"content": "Done."}}]}

        return chunks()

    client = TestClient(
        create_app(
            serve_frontend=False,
            chat_completion=fake_completion,
            workdir=app_workdir,
        )
    )
    configure_provider(client)

    response = client.post("/api/workspace/respond", json={"content": "Hello."})

    assert response.status_code == 200
    project_message = project_context_message(captured_request)
    assert project_message is not None
    assert "Use app instructions." in project_message["content"]
    assert "Use env instructions." not in project_message["content"]
    environment_message = environment_context_message(captured_request)
    assert f"<cwd>{app_workdir}</cwd>" in environment_message["content"]


def test_workspace_workdir_does_not_change_data_directory(
    tmp_path, monkeypatch
) -> None:
    workdir = tmp_path / "workspace"
    data_dir = tmp_path / "data"
    workdir.mkdir()
    monkeypatch.setenv("FLOWENT_WORKDIR", str(workdir))
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(data_dir))

    client = TestClient(create_app(serve_frontend=False))
    response = client.post(
        "/api/providers",
        json={
            "api_key": "sk-local",
            "base_url": "",
            "id": "provider-openai",
            "models": ["gpt-5.1"],
            "name": "OpenAI",
            "type": "openai",
        },
    )

    assert response.status_code == 200
    assert (data_dir / "flowent.db").is_file()
    assert not (workdir / "flowent.db").exists()


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
    compacted_messages = [
        message
        for message in response_messages
        if str(message["content"]).startswith(
            "Another language model started working on this Flowent workspace session"
        )
    ]
    assert len(compacted_messages) == 1
    assert "Keep compacted state." in compacted_messages[0]["content"]


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
    assert assistant["groups"][-1] == {
        "id": f"{assistant['id']}-errors",
        "items": [
            {
                "detail": "provider stopped",
                "id": f"{assistant['id']}-error-1",
                "message": "Check the model connection settings and try again.",
                "title": "Request failed",
                "type": "error",
            }
        ],
    }


def test_workspace_persists_error_block_when_responses_stream_fails(
    tmp_path, monkeypatch, fake_litellm_responses_transformer
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))

    async def fake_completion(**request: object) -> object:
        async def chunks() -> object:
            from litellm.completion_extras.litellm_responses_transformation.transformation import (
                OpenAiResponsesToChatCompletionStreamIterator,
            )

            yield {"choices": [{"delta": {"content": "Partial answer."}}]}
            yield OpenAiResponsesToChatCompletionStreamIterator.translate_responses_chunk_to_openai_stream(
                {
                    "response": {
                        "error": {
                            "code": "upstream_error",
                            "message": "Upstream request failed",
                        },
                        "status": "failed",
                    },
                    "type": "response.failed",
                }
            )

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
    assert json.loads(events[-1]["data"])["error"] == {
        "detail": "Upstream request failed",
        "id": f"{assistant['id']}-error-1",
        "message": "Check the model connection settings and try again.",
        "title": "Request failed",
        "type": "error",
    }


def test_workspace_persists_error_block_when_model_fails_before_output(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))

    async def fake_completion(**request: object) -> object:
        raise RuntimeError("provider unavailable")

    client = TestClient(
        create_app(serve_frontend=False, chat_completion=fake_completion)
    )
    configure_provider(client)

    response = client.post("/api/workspace/respond", json={"content": "Hello."})

    assert response.status_code == 200
    events = stream_events(response.text)
    assert events[-1]["event"] == "error"
    assistant_id = json.loads(events[0]["data"])["id"]
    assert json.loads(events[-1]["data"]) == {
        "error": {
            "detail": "provider unavailable",
            "id": f"{assistant_id}-error-1",
            "message": "Check the model connection settings and try again.",
            "title": "Request failed",
            "type": "error",
        },
        "message": "Check the model connection settings and try again.",
    }
    state = client.get("/api/state").json()
    assistant = state["messages"][-1]
    assert assistant["author"] == "assistant"
    assert assistant["content"] == ""
    assert assistant["status"] == "failed"
    assert assistant["groups"] == [
        {
            "id": f"{assistant['id']}-group-1",
            "items": [],
        },
        {
            "id": f"{assistant['id']}-errors",
            "items": [
                {
                    "detail": "provider unavailable",
                    "id": f"{assistant['id']}-error-1",
                    "message": "Check the model connection settings and try again.",
                    "title": "Request failed",
                    "type": "error",
                }
            ],
        },
    ]


def test_workspace_treats_empty_model_result_as_failed_error_block(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))

    async def fake_completion(**request: object) -> object:
        async def chunks() -> object:
            if False:
                yield {}

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
    assert assistant["status"] == "failed"
    assert assistant["groups"][-1]["items"] == [
        {
            "detail": "The model did not return a response.",
            "id": f"{assistant['id']}-error-1",
            "message": "Check the model connection settings and try again.",
            "title": "Request failed",
            "type": "error",
        }
    ]


def test_workspace_includes_previous_error_summary_in_next_request(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    captured_requests: list[dict[str, object]] = []

    async def fake_completion(**request: object) -> object:
        captured_requests.append(request)

        async def chunks() -> object:
            yield {"choices": [{"delta": {"content": "Recovered."}}]}

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
                    "content": "Try once.",
                    "id": "message-user-1",
                },
                {
                    "author": "assistant",
                    "content": "",
                    "groups": [
                        {
                            "id": "message-assistant-1-errors",
                            "items": [
                                {
                                    "detail": "HTML response returned.",
                                    "id": "message-assistant-1-error-1",
                                    "message": "Check the model connection settings and try again.",
                                    "title": "Request failed",
                                    "type": "error",
                                }
                            ],
                        }
                    ],
                    "id": "message-assistant-1",
                    "status": "failed",
                },
            ]
        },
    )

    response = client.post("/api/workspace/respond", json={"content": "Try again."})

    assert response.status_code == 200
    request_messages = captured_requests[0]["messages"]
    assert {
        "role": "assistant",
        "content": "Previous response failed: Request failed. Check the model connection settings and try again. Detail: HTML response returned.",
    } in request_messages


def test_workspace_marks_running_tool_failed_when_stream_errors(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))

    async def fake_run_async(self, command, **kwargs):
        raise RuntimeError("sandbox failed")

    monkeypatch.setattr(SandboxRunner, "run_async", fake_run_async)

    async def fake_completion(**request: object) -> object:
        async def chunks() -> object:
            yield tool_call_chunk("shell_command", '{"command": "boom"}')

        return chunks()

    client = TestClient(
        create_app(serve_frontend=False, chat_completion=fake_completion)
    )
    configure_provider(client)

    response = client.post("/api/workspace/respond", json={"content": "Run it."})

    assert response.status_code == 200
    events = stream_events(response.text)
    assert events[-1]["event"] == "error"
    state = client.get("/api/state").json()
    assistant = state["messages"][-1]
    assert assistant["status"] == "failed"
    assert assistant["tools"][0]["name"] == "shell_command"
    assert assistant["tools"][0]["status"] == "failed"
    assert "sandbox failed" in assistant["tools"][0]["content"]


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


def test_workspace_persists_assistant_output_groups_after_tool_round(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    (tmp_path / "notes.txt").write_text("Launch notes")
    completion_calls = 0

    async def fake_completion(**request: object) -> object:
        nonlocal completion_calls
        completion_calls += 1

        async def chunks() -> object:
            if completion_calls == 1:
                yield tool_call_chunk("read_file", '{"path": "notes.txt"}')
                return
            yield {"choices": [{"delta": {"content": "The notes are ready."}}]}

        return chunks()

    client = TestClient(
        create_app(serve_frontend=False, chat_completion=fake_completion)
    )
    configure_provider(client)

    response = client.post("/api/workspace/respond", json={"content": "Read notes."})
    state = client.get("/api/state").json()
    assistant = state["messages"][-1]
    tool_id = assistant["tools"][0]["id"]

    assert response.status_code == 200
    assert assistant["content"] == "The notes are ready."
    assert assistant["groups"] == [
        {
            "id": f"{assistant['id']}-group-1",
            "items": [
                {
                    "id": f"tool-{tool_id}",
                    "tool": assistant["tools"][0],
                    "type": "tool",
                }
            ],
        },
        {
            "id": f"{assistant['id']}-group-2",
            "items": [
                {
                    "content": "The notes are ready.",
                    "id": f"{assistant['id']}-text-1",
                    "type": "text",
                }
            ],
        },
    ]


@pytest.mark.anyio
async def test_workspace_run_continues_without_stream_consumer(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    first_chunk_sent = asyncio.Event()
    finish_response = asyncio.Event()

    async def fake_completion(**request: object) -> object:
        async def chunks() -> object:
            yield {"choices": [{"delta": {"content": "Partial "}}]}
            first_chunk_sent.set()
            await asyncio.wait_for(finish_response.wait(), timeout=2)
            yield {"choices": [{"delta": {"content": "answer."}}]}

        return chunks()

    app = create_app(serve_frontend=False, chat_completion=fake_completion)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        await configure_provider_async(client)
        response = await client.post(
            "/api/workspace/runs",
            json={"content": "Keep working."},
        )
        assert response.status_code == 200
        await asyncio.wait_for(first_chunk_sent.wait(), timeout=2)
        finish_response.set()

        for _ in range(20):
            state = (await client.get("/api/state")).json()
            assistant = state["messages"][-1]
            if (
                assistant["author"] == "assistant"
                and assistant.get("status", "completed") == "completed"
            ):
                break
            await asyncio.sleep(0.05)
        else:
            raise AssertionError("Workspace run did not complete.")

    assert assistant["content"] == "Partial answer."


@pytest.mark.anyio
async def test_workspace_state_exposes_active_run_for_reconnect(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    first_chunk_sent = asyncio.Event()
    finish_response = asyncio.Event()

    async def fake_completion(**request: object) -> object:
        async def chunks() -> object:
            yield {"choices": [{"delta": {"content": "First "}}]}
            first_chunk_sent.set()
            await asyncio.wait_for(finish_response.wait(), timeout=2)
            yield {"choices": [{"delta": {"content": "second."}}]}

        return chunks()

    app = create_app(serve_frontend=False, chat_completion=fake_completion)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        await configure_provider_async(client)
        response = await client.post(
            "/api/workspace/runs",
            json={"content": "Continue if I reconnect."},
        )
        run_id = response.json()["run_id"]
        await asyncio.wait_for(first_chunk_sent.wait(), timeout=2)
        state = (await client.get("/api/state")).json()
        event_index = state["active_run_event_index"]
        finish_response.set()
        stream_response = await client.get(
            f"/api/workspace/runs/{run_id}/stream?after={event_index}"
        )

    assert state["active_run_id"] == run_id
    assert event_index > 0
    events = stream_events(stream_response.text)
    assert {"event": "delta", "data": '{"content": "First "}'} not in events
    assert {"event": "delta", "data": '{"content": "second."}'} in events


@pytest.mark.anyio
async def test_workspace_persists_automatic_review_result_during_stream(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    work_dir = tmp_path / "work"
    outside_dir = tmp_path / "outside"
    work_dir.mkdir()
    outside_dir.mkdir()
    target = outside_dir / "notes.txt"
    target.write_text("alpha\n")
    patch = f"""*** Begin Patch
*** Update File: {target}
@@
-alpha
+beta
*** End Patch"""

    review_started = asyncio.Event()
    finish_review = asyncio.Event()
    review_payload: dict[str, object] = {}

    async def fake_completion(**request: object) -> object:
        messages = request["messages"]
        if messages[0]["content"].startswith("You are Flowent Approval Reviewer"):
            review_payload.update(json.loads(messages[-1]["content"]))
            review_started.set()
            await asyncio.wait_for(finish_review.wait(), timeout=2)
            return {
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {
                                    "risk_level": "high",
                                    "risk_score": 85,
                                    "rationale": "Outside the task scope.",
                                    "evidence": [],
                                }
                            ),
                            "role": "assistant",
                        }
                    }
                ]
            }

        async def chunks() -> object:
            if request["messages"][-1]["role"] == "user":
                yield tool_call_chunk(
                    "apply_patch",
                    json.dumps({"patch": patch}),
                )
                return
            yield {"choices": [{"delta": {"content": "Done."}}]}

        return chunks()

    app = create_app(
        workdir=work_dir,
        serve_frontend=False,
        chat_completion=fake_completion,
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        await configure_provider_async(client)
        response = await client.post(
            "/api/workspace/runs",
            json={"content": "Edit notes."},
        )
        run_id = response.json()["run_id"]
        await asyncio.wait_for(review_started.wait(), timeout=2)
        state = (await client.get("/api/state")).json()
        finish_review.set()
        stream_response = await client.get(
            f"/api/workspace/runs/{run_id}/stream?after={state['active_run_event_index']}"
        )

    assistant = state["messages"][-1]
    assert state["active_run_id"] == run_id
    assert assistant["tools"][0]["name"] == "apply_patch"
    assert assistant["tools"][0]["status"] == "running"
    events = stream_events(stream_response.text)
    tool_error = next(event for event in events if event["event"] == "tool_error")
    tool_error_data = json.loads(str(tool_error["data"]))
    assert tool_error_data["data"]["approval"]["decision"] == "denied"
    assert tool_error_data["data"]["approval"]["reason"] == "Outside the task scope."
    assert review_payload["user_request"] == "Edit notes."
    assert target.read_text() == "alpha\n"


@pytest.mark.anyio
async def test_workspace_review_request_includes_recent_transcript(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    work_dir = tmp_path / "work"
    work_dir.mkdir()
    review_payload: dict[str, object] = {}

    async def fake_completion(**request: object) -> object:
        messages = request["messages"]
        if messages[0]["content"].startswith("You are Flowent Approval Reviewer"):
            review_payload.update(json.loads(messages[-1]["content"]))
            return {
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {
                                    "risk_level": "high",
                                    "risk_score": 85,
                                    "rationale": "No run is needed for this test.",
                                    "evidence": [],
                                }
                            ),
                            "role": "assistant",
                        }
                    }
                ]
            }

        async def chunks() -> object:
            if request["messages"][-1]["role"] == "user":
                yield tool_call_chunk(
                    "shell_command",
                    json.dumps(
                        {
                            "additional_permissions": {
                                "file_system": {"write": ["/var/run/docker.sock"]}
                            },
                            "command": (
                                "docker compose up -d --force-recreate flowent"
                            ),
                            "sandbox_permissions": "with_additional_permissions",
                        }
                    ),
                )
                return
            yield {"choices": [{"delta": {"content": "Stopped."}}]}

        return chunks()

    app = create_app(
        workdir=work_dir,
        serve_frontend=False,
        chat_completion=fake_completion,
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        await configure_provider_async(client)
        await client.put(
            "/api/workspace/messages",
            json={
                "messages": [
                    {
                        "author": "user",
                        "content": "Can you recreate the dev container?",
                        "id": "user-1",
                    },
                    {
                        "author": "assistant",
                        "content": (
                            "This will recreate the Flowent dev container through "
                            "Docker and may briefly interrupt the running service."
                        ),
                        "id": "assistant-1",
                        "tools": [
                            {
                                "arguments": {"command": "docker compose ps"},
                                "content": "flowent-dev-preview-flowent-1 running",
                                "data": {},
                                "id": "tool-1",
                                "name": "shell_command",
                                "status": "success",
                                "title": "Ran docker compose ps",
                            }
                        ],
                    },
                ]
            },
        )
        response = await client.post(
            "/api/workspace/runs",
            json={"content": "确认"},
        )
        run_id = response.json()["run_id"]
        stream_response = await client.get(f"/api/workspace/runs/{run_id}/stream")

    events = stream_events(stream_response.text)
    assert "tool_error" in [event["event"] for event in events]
    assert review_payload["user_request"] == "确认"
    transcript = review_payload["transcript"]
    assert {"role": "user", "content": "确认"} in transcript
    assert any(
        entry["role"] == "assistant" and "briefly interrupt" in entry["content"]
        for entry in transcript
    )
    assert any(
        entry["role"] == "tool"
        and entry["name"] == "shell_command"
        and "flowent-dev-preview-flowent-1" in entry["content"]
        for entry in transcript
    )


@pytest.mark.anyio
async def test_workspace_clear_removes_running_run_draft(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    first_chunk_sent = asyncio.Event()
    finish_response = asyncio.Event()

    async def fake_completion(**request: object) -> object:
        async def chunks() -> object:
            yield {"choices": [{"delta": {"content": "Partial"}}]}
            first_chunk_sent.set()
            await finish_response.wait()

        return chunks()

    app = create_app(serve_frontend=False, chat_completion=fake_completion)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        await configure_provider_async(client)
        response = await client.post(
            "/api/workspace/runs",
            json={"content": "Keep working."},
        )
        assert response.status_code == 200
        await asyncio.wait_for(first_chunk_sent.wait(), timeout=2)
        clear_response = await client.put(
            "/api/workspace/messages",
            json={"messages": []},
        )
        await asyncio.sleep(0)
        state = (await client.get("/api/state")).json()

    assert clear_response.status_code == 200
    assert state["messages"] == []
    assert state["active_run_id"] is None


def test_workspace_response_uses_compaction_checkpoint_after_restart(
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
                            "content": "Checkpoint summary survives restarts.",
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
                {"author": "user", "content": "Original request.", "id": "message-1"},
                {
                    "author": "assistant",
                    "content": "Original reply.",
                    "id": "message-2",
                },
            ]
        },
    )

    compact_response = client.post("/api/workspace/compact")
    restarted_client = TestClient(
        create_app(serve_frontend=False, chat_completion=fake_completion)
    )
    response = restarted_client.post(
        "/api/workspace/respond",
        json={"content": "Continue after restart."},
    )

    assert compact_response.status_code == 200
    assert response.status_code == 200
    response_messages = captured_requests[1]["messages"]
    compacted_messages = [
        message
        for message in response_messages
        if str(message["content"]).startswith(
            "Another language model started working on this Flowent workspace session"
        )
    ]
    assert len(compacted_messages) == 1
    assert "Checkpoint summary survives restarts." in compacted_messages[0]["content"]
    assert response_messages[content_index(response_messages, "Original request.")] == {
        "role": "user",
        "content": "Original request.",
    }
    assert {"role": "assistant", "content": "Original reply."} not in response_messages
    assert content_index(
        response_messages, "Original request."
    ) < compact_summary_index(response_messages)
    assert {"role": "user", "content": "Context compacted"} not in response_messages


def test_workspace_state_restores_compact_usage_after_restart(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))

    async def fake_completion(**request: object) -> dict[str, object]:
        return {
            "choices": [
                {
                    "message": {
                        "content": "Restarted usage summary.",
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
                    "content": "Keep state after restart.",
                    "id": "message-1",
                }
            ]
        },
    )

    compact_response = client.post("/api/workspace/compact")
    restarted_client = TestClient(
        create_app(serve_frontend=False, chat_completion=fake_completion)
    )
    state = restarted_client.get("/api/state").json()

    assert compact_response.status_code == 200
    assert state["usage_info"] == compact_response.json()["usage_info"]
    assert state["messages"][-1]["usage_info"] == state["usage_info"]


def test_workspace_response_estimates_usage_when_model_stream_omits_usage(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))

    async def fake_completion(**request: object) -> object:
        async def chunks() -> object:
            yield {"choices": [{"delta": {"content": "Estimated reply."}}]}

        return chunks()

    client = TestClient(
        create_app(serve_frontend=False, chat_completion=fake_completion)
    )
    configure_provider(client)

    response = client.post(
        "/api/workspace/respond",
        json={"content": "Need local estimate."},
    )

    assert response.status_code == 200
    events = stream_events(response.text)
    assert "usage" not in [event["event"] for event in events]
    state = client.get("/api/state").json()
    assert state["usage_info"]["last_token_usage"]["total_tokens"] > 0
    assert state["usage_info"]["last_token_usage"]["input_tokens"] == 0
    assert state["usage_info"]["last_token_usage"]["output_tokens"] == 0
    assert state["messages"][-1]["usage_info"] == state["usage_info"]


def test_workspace_save_messages_restores_usage_from_latest_message(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    client = TestClient(create_app(serve_frontend=False))
    usage_info = {
        "last_token_usage": {
            "cached_input_tokens": 0,
            "input_tokens": 20,
            "output_tokens": 5,
            "reasoning_output_tokens": 0,
            "total_tokens": 25,
        },
        "model_context_window": 120000,
        "total_token_usage": {
            "cached_input_tokens": 0,
            "input_tokens": 20,
            "output_tokens": 5,
            "reasoning_output_tokens": 0,
            "total_tokens": 25,
        },
    }

    response = client.put(
        "/api/workspace/messages",
        json={
            "messages": [
                {
                    "author": "assistant",
                    "content": "Persisted reply.",
                    "id": "message-usage",
                    "usage_info": usage_info,
                }
            ]
        },
    )
    state = client.get("/api/state").json()

    assert response.status_code == 200
    assert state["usage_info"] == usage_info
    assert state["messages"][-1]["usage_info"] == usage_info


def test_workspace_compact_is_unavailable_while_response_is_running(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    continue_stream = asyncio.Event()

    async def fake_completion(**request: object) -> object:
        async def chunks() -> object:
            yield {"choices": [{"delta": {"content": "Partial."}}]}
            await asyncio.wait_for(continue_stream.wait(), timeout=2)
            yield {"choices": [{"delta": {"content": " Done."}}]}

        return chunks()

    async def run_test() -> None:
        app = create_app(serve_frontend=False, chat_completion=fake_completion)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://testserver"
        ) as client:
            await configure_provider_async(client)
            response_task = asyncio.create_task(
                client.post("/api/workspace/respond", json={"content": "Start."})
            )
            await asyncio.sleep(0)
            compact_response = await client.post("/api/workspace/compact")
            continue_stream.set()
            response = await response_task

        assert compact_response.status_code == 409
        assert compact_response.json()["detail"] == (
            "Compact is unavailable while Flowent is responding."
        )
        assert response.status_code == 200

    asyncio.run(run_test())


def configured_agent_prompt_message(
    request: dict[str, object],
) -> dict[str, object] | None:
    for message in request["messages"]:
        if str(message["content"]).startswith("# Flowent configured agent prompt"):
            return message
    return None


def test_workspace_response_includes_configured_agent_prompt_before_agents_md(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    (tmp_path / ".git").mkdir()
    (tmp_path / "AGENTS.md").write_text("Use project instructions.")
    captured_request: dict[str, object] = {}

    async def fake_completion(**request: object) -> object:
        captured_request.update(request)

        async def chunks() -> object:
            yield {"choices": [{"delta": {"content": "Done."}}]}

        return chunks()

    client = TestClient(
        create_app(serve_frontend=False, chat_completion=fake_completion)
    )
    configure_provider(client, agent_prompt="Use UI configured instructions first.")

    response = client.post("/api/workspace/respond", json={"content": "Hello."})

    assert response.status_code == 200
    configured_message = configured_agent_prompt_message(captured_request)
    project_message = project_context_message(captured_request)
    assert configured_message is not None
    assert project_message is not None
    assert configured_message["role"] == "system"
    assert "Use UI configured instructions first." in configured_message["content"]
    assert "Use project instructions." in project_message["content"]
    assert captured_request["messages"].index(configured_message) < captured_request[
        "messages"
    ].index(project_message)


def test_workspace_compacted_response_includes_latest_configured_agent_prompt(
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
    configure_provider(client, agent_prompt="Prompt before compact.")
    client.put(
        "/api/workspace/messages",
        json={
            "messages": [
                {"author": "user", "content": "Original request.", "id": "message-1"}
            ]
        },
    )

    compact_response = client.post("/api/workspace/compact")
    client.put(
        "/api/settings",
        json={
            "agent_prompt": "Prompt after compact.",
            "reasoning_effort": "default",
            "selected_model": "gpt-5.1",
            "selected_provider_id": "provider-openai",
        },
    )
    response = client.post("/api/workspace/respond", json={"content": "Continue."})

    assert compact_response.status_code == 200
    assert response.status_code == 200
    configured_message = configured_agent_prompt_message(captured_requests[1])
    assert configured_message is not None
    assert "Prompt after compact." in configured_message["content"]
    assert "Prompt before compact." not in configured_message["content"]


def test_workspace_response_trims_blank_configured_agent_prompt(
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
    configure_provider(client, agent_prompt="\n\n")

    response = client.post("/api/workspace/respond", json={"content": "Hello."})

    assert response.status_code == 200
    assert configured_agent_prompt_message(captured_request) is None
