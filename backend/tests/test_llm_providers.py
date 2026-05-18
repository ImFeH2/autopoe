import pytest

from flowent.llm import (
    ChatMessage,
    ProviderConnection,
    ProviderFormat,
    build_litellm_request,
    complete_chat,
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
