import pytest

from flowent.llm import (
    ChatMessage,
    ProviderConnection,
    ProviderFormat,
    ReasoningEffort,
    build_litellm_request,
    chunk_delta_reasoning,
    complete_chat,
    stream_chat,
)


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
