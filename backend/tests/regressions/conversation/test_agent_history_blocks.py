from fastapi.testclient import TestClient

from flowent.main import create_app


def configure_provider(client: TestClient) -> None:
    client.post(
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
    client.put(
        "/api/settings",
        json={
            "agent_prompt": "",
            "reasoning_effort": "default",
            "selected_model": "gpt-5.1",
            "selected_provider_id": "provider-openai",
        },
    )


def test_follow_up_response_keeps_previous_tool_blocks_in_model_history(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    captured_request: dict[str, object] = {}

    async def fake_completion(**request: object) -> object:
        captured_request.update(request)

        async def chunks() -> object:
            yield {"choices": [{"delta": {"content": "Use the saved finding."}}]}

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
                    "content": "Read the launch notes.",
                    "id": "message-user-1",
                },
                {
                    "author": "assistant",
                    "content": "The notes say launch is ready.",
                    "groups": [
                        {
                            "id": "message-assistant-1-group-1",
                            "items": [
                                {
                                    "id": "tool-call-1-item",
                                    "tool": {
                                        "arguments": {"path": "notes.txt"},
                                        "content": "Launch is ready.",
                                        "data": {},
                                        "id": "call-1",
                                        "name": "read_file",
                                        "status": "success",
                                        "title": "Reading notes.txt",
                                    },
                                    "type": "tool",
                                }
                            ],
                        },
                        {
                            "id": "message-assistant-1-group-2",
                            "items": [
                                {
                                    "content": "The notes say launch is ready.",
                                    "id": "message-assistant-1-text-1",
                                    "type": "text",
                                }
                            ],
                        },
                    ],
                    "id": "message-assistant-1",
                    "tools": [
                        {
                            "arguments": {"path": "notes.txt"},
                            "content": "Launch is ready.",
                            "data": {},
                            "id": "call-1",
                            "name": "read_file",
                            "status": "success",
                            "title": "Reading notes.txt",
                        }
                    ],
                },
            ]
        },
    )

    response = client.post(
        "/api/workspace/respond",
        json={"content": "What did the notes say?"},
    )

    assert response.status_code == 200
    messages = captured_request["messages"]
    tool_result_index = next(
        index
        for index, message in enumerate(messages)
        if message.get("role") == "tool" and message.get("tool_call_id") == "call-1"
    )
    assert messages[tool_result_index - 1] == {
        "role": "assistant",
        "content": None,
        "tool_calls": [
            {
                "id": "call-1",
                "type": "function",
                "function": {
                    "name": "read_file",
                    "arguments": '{"path": "notes.txt"}',
                },
            }
        ],
    }
    assert messages[tool_result_index] == {
        "role": "tool",
        "tool_call_id": "call-1",
        "content": "Launch is ready.",
    }
    assert messages[tool_result_index + 1] == {
        "role": "assistant",
        "content": "The notes say launch is ready.",
    }
    assert messages[-1] == {"role": "user", "content": "What did the notes say?"}
