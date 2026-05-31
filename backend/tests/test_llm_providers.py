import json

import pytest

from flowent.llm import (
    ChatMessage,
    LLMStreamError,
    ProviderConnection,
    ProviderFormat,
    ReasoningEffort,
    build_litellm_request,
    chunk_delta_reasoning,
    complete_chat,
    normalize_system_messages,
    stream_chat,
    stream_chat_chunks,
)


def read_single_llm_request_diagnostic(tmp_path):
    files = sorted((tmp_path / "logs" / "llm-requests").glob("llm-request-*.json"))
    assert len(files) == 1
    return json.loads(files[0].read_text())


def test_supported_provider_formats_match_product_choices() -> None:
    assert [provider.value for provider in ProviderFormat] == [
        "openai",
        "openai_responses",
        "anthropic",
        "gemini",
    ]


def test_build_litellm_request_maps_provider_connection_to_completion_args() -> None:
    connection = ProviderConnection(
        name="Primary",
        provider=ProviderFormat.ANTHROPIC,
        model="claude-sonnet-4-5",
        secret_reference="connection-primary",
        base_url="https://example.test/v1",
    )
    messages = [
        ChatMessage(role="system", content="Keep answers direct."),
        ChatMessage(role="user", content="Draft a launch checklist."),
    ]

    request = build_litellm_request(connection, messages)

    assert request == {
        "api_base": "https://example.test/v1",
        "api_key": "connection-primary",
        "messages": [
            {"role": "system", "content": "Keep answers direct."},
            {"role": "user", "content": "Draft a launch checklist."},
        ],
        "model": "anthropic/claude-sonnet-4-5",
    }


def test_build_litellm_request_omits_default_reasoning_effort() -> None:
    connection = ProviderConnection(
        name="Primary",
        provider=ProviderFormat.OPENAI,
        model="gpt-5.1",
        secret_reference="connection-primary",
        reasoning_effort=ReasoningEffort.DEFAULT,
    )

    request = build_litellm_request(
        connection, [ChatMessage(role="user", content="Draft a checklist.")]
    )

    assert "reasoning_effort" not in request


def test_build_litellm_request_includes_selected_reasoning_effort() -> None:
    connection = ProviderConnection(
        name="Primary",
        provider=ProviderFormat.OPENAI,
        model="gpt-5.1",
        secret_reference="connection-primary",
        reasoning_effort=ReasoningEffort.XHIGH,
    )

    request = build_litellm_request(
        connection, [ChatMessage(role="user", content="Draft a checklist.")]
    )

    assert request["reasoning_effort"] == "xhigh"


def test_chunk_delta_reasoning_reads_litellm_reasoning_fields() -> None:
    assert (
        chunk_delta_reasoning(
            {"choices": [{"delta": {"reasoning_content": "Checking files."}}]}
        )
        == "Checking files."
    )
    assert (
        chunk_delta_reasoning(
            {
                "choices": [
                    {
                        "delta": {
                            "thinking_blocks": [{"thinking": "Read files."}],
                            "reasoning_items": [{"summary": "Summarize."}],
                        }
                    }
                ]
            }
        )
        == "Read files.Summarize."
    )


@pytest.mark.anyio
async def test_complete_chat_uses_injected_litellm_completion() -> None:
    captured_request: dict[str, object] = {}

    async def fake_completion(**request: object) -> dict[str, object]:
        captured_request.update(request)
        return {
            "choices": [
                {
                    "message": {
                        "content": "Here is the checklist.",
                        "role": "assistant",
                    },
                }
            ]
        }

    connection = ProviderConnection(
        name="Responses",
        provider=ProviderFormat.OPENAI_RESPONSES,
        model="gpt-5.1",
        secret_reference="connection-responses",
    )

    answer = await complete_chat(
        connection,
        [ChatMessage(role="user", content="Create a checklist.")],
        completion=fake_completion,
    )

    assert captured_request["model"] == "openai/gpt-5.1"
    assert answer == ChatMessage(role="assistant", content="Here is the checklist.")


@pytest.mark.anyio
async def test_development_mode_writes_completion_request_diagnostic_file(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("DEBUG", "true")

    async def fake_completion(**request: object) -> dict[str, object]:
        return {
            "choices": [
                {
                    "message": {
                        "content": "Here is the checklist.",
                        "role": "assistant",
                    },
                }
            ]
        }

    connection = ProviderConnection(
        name="Responses",
        provider=ProviderFormat.OPENAI_RESPONSES,
        model="gpt-5.1",
        secret_reference="sk-request-secret",
    )
    messages = [ChatMessage(role="user", content="Create a checklist.")]
    tools = [
        {
            "type": "function",
            "function": {
                "name": "create_checklist",
                "description": "Create a checklist.",
            },
        }
    ]

    await complete_chat(
        connection,
        messages,
        completion=fake_completion,
        tools=tools,
    )

    diagnostic = read_single_llm_request_diagnostic(tmp_path)

    assert diagnostic == {
        "base_url": None,
        "litellm_model": "openai/gpt-5.1",
        "messages": [{"content": "Create a checklist.", "role": "user"}],
        "model": "gpt-5.1",
        "provider": "openai_responses",
        "reasoning_effort": "default",
        "stream": False,
        "tools": tools,
    }


@pytest.mark.anyio
async def test_stream_chat_uses_litellm_streaming() -> None:
    captured_request: dict[str, object] = {}

    async def fake_completion(**request: object) -> object:
        captured_request.update(request)

        async def chunks() -> object:
            yield {"choices": [{"delta": {"content": "Here is "}}]}
            yield {"choices": [{"delta": {"content": "the checklist."}}]}

        return chunks()

    connection = ProviderConnection(
        name="Responses",
        provider=ProviderFormat.OPENAI_RESPONSES,
        model="gpt-5.1",
        secret_reference="connection-responses",
    )

    chunks = [
        chunk
        async for chunk in stream_chat(
            connection,
            [ChatMessage(role="user", content="Create a checklist.")],
            completion=fake_completion,
        )
    ]

    assert captured_request["stream"] is True
    assert captured_request["model"] == "openai/gpt-5.1"
    assert chunks == ["Here is ", "the checklist."]


@pytest.mark.anyio
async def test_stream_chat_chunks_raises_when_responses_stream_fails(
    fake_litellm_responses_transformer,
) -> None:
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

    connection = ProviderConnection(
        name="Responses",
        provider=ProviderFormat.OPENAI_RESPONSES,
        model="gpt-5.1",
        secret_reference="connection-responses",
    )

    with pytest.raises(LLMStreamError, match="Upstream request failed"):
        [
            chunk
            async for chunk in stream_chat_chunks(
                connection,
                [ChatMessage(role="user", content="Create a checklist.")],
                completion=fake_completion,
            )
        ]


@pytest.mark.anyio
async def test_development_mode_writes_one_streaming_request_diagnostic_file(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("DEBUG", "true")

    async def fake_completion(**request: object) -> object:
        async def chunks() -> object:
            yield {"choices": [{"delta": {"content": "Here is "}}]}
            yield {"choices": [{"delta": {"content": "the checklist."}}]}

        return chunks()

    connection = ProviderConnection(
        name="Responses",
        provider=ProviderFormat.OPENAI_RESPONSES,
        model="gpt-5.1",
        secret_reference="sk-request-secret",
    )

    chunks = [
        chunk
        async for chunk in stream_chat(
            connection,
            [ChatMessage(role="user", content="Create a checklist.")],
            completion=fake_completion,
        )
    ]
    diagnostic = read_single_llm_request_diagnostic(tmp_path)

    assert chunks == ["Here is ", "the checklist."]
    assert diagnostic["stream"] is True


@pytest.mark.anyio
async def test_development_request_diagnostic_omits_api_key_and_secret_values(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("DEBUG", "true")

    async def fake_completion(**request: object) -> dict[str, object]:
        return {
            "choices": [
                {
                    "message": {
                        "content": "Here is the checklist.",
                        "role": "assistant",
                    },
                }
            ]
        }

    connection = ProviderConnection(
        name="Responses",
        provider=ProviderFormat.OPENAI_RESPONSES,
        model="gpt-5.1",
        secret_reference="sk-provider-secret",
    )
    tools = [
        {
            "type": "function",
            "function": {
                "name": "create_checklist",
                "description": "Uses api_key=sk-tool-secret when configured.",
            },
        }
    ]

    await complete_chat(
        connection,
        [ChatMessage(role="user", content="authorization=Bearer sk-message-secret")],
        completion=fake_completion,
        tools=tools,
    )

    rendered = next(
        (tmp_path / "logs" / "llm-requests").glob("llm-request-*.json")
    ).read_text()

    assert "api_key" not in rendered
    assert "sk-provider-secret" not in rendered
    assert "sk-tool-secret" not in rendered
    assert "sk-message-secret" not in rendered


@pytest.mark.anyio
async def test_non_development_mode_skips_request_diagnostic_file(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("DEBUG", raising=False)

    async def fake_completion(**request: object) -> dict[str, object]:
        return {
            "choices": [
                {
                    "message": {
                        "content": "Here is the checklist.",
                        "role": "assistant",
                    },
                }
            ]
        }

    connection = ProviderConnection(
        name="Responses",
        provider=ProviderFormat.OPENAI_RESPONSES,
        model="gpt-5.1",
        secret_reference="sk-request-secret",
    )

    await complete_chat(
        connection,
        [ChatMessage(role="user", content="Create a checklist.")],
        completion=fake_completion,
    )

    assert not (tmp_path / "logs" / "llm-requests").exists()


def test_normalize_system_messages_keeps_multiple_system_messages_for_openai() -> None:
    messages = [
        {"role": "system", "content": "Base prompt."},
        {"role": "system", "content": "Configured prompt."},
        {"role": "user", "content": "Hello."},
    ]

    assert normalize_system_messages(messages, ProviderFormat.OPENAI) == messages


def test_normalize_system_messages_converts_additional_system_messages_for_anthropic() -> (
    None
):
    messages = [
        {"role": "system", "content": "Base prompt."},
        {"role": "system", "content": "Configured prompt."},
        {"role": "system", "content": "Project prompt."},
        {"role": "user", "content": "Hello."},
    ]

    assert normalize_system_messages(messages, ProviderFormat.ANTHROPIC) == [
        {"role": "system", "content": "Base prompt."},
        {"role": "user", "content": "Configured prompt."},
        {"role": "user", "content": "Project prompt."},
        {"role": "user", "content": "Hello."},
    ]
