from flowent.llm import ChatMessage
from flowent.usage import (
    DEFAULT_MODEL_CONTEXT_WINDOW,
    approximate_token_count,
    estimated_token_usage_for_messages,
    estimated_token_usage_for_request,
    model_context_window_for,
)
from flowent.workspace.context import should_auto_compact


def test_model_context_window_uses_exact_model_match() -> None:
    assert model_context_window_for("gpt-5.1") == 272_000


def test_model_context_window_uses_provider_prefixed_model_match() -> None:
    assert model_context_window_for("openai/gpt-5.1") == 272_000


def test_model_context_window_uses_longest_prefix_match() -> None:
    assert model_context_window_for("gpt-5.4-mini-experimental") == 272_000


def test_model_context_window_falls_back_for_unknown_model() -> None:
    assert model_context_window_for("custom-model") == DEFAULT_MODEL_CONTEXT_WINDOW


def test_model_context_window_uses_litellm_input_window_metadata(
    monkeypatch,
) -> None:
    import litellm

    monkeypatch.setitem(
        litellm.model_cost,
        "window-probe-model",
        {
            "max_input_tokens": 999_000,
            "max_output_tokens": 128_000,
            "max_tokens": 128_000,
        },
    )

    assert model_context_window_for("openai/window-probe-model") == 999_000


def test_auto_compact_uses_context_window_ratio_by_default(monkeypatch) -> None:
    monkeypatch.delenv("FLOWENT_AUTO_COMPACT_TOKEN_LIMIT", raising=False)
    messages = [ChatMessage(role="user", content="A" * (120_000 * 4))]

    assert not should_auto_compact(messages, context_window=400_000)


def test_auto_compact_triggers_near_context_window_limit(monkeypatch) -> None:
    monkeypatch.delenv("FLOWENT_AUTO_COMPACT_TOKEN_LIMIT", raising=False)
    messages = [ChatMessage(role="user", content="A" * (380_000 * 4))]

    assert should_auto_compact(messages, context_window=400_000)


def test_auto_compact_uses_utf8_byte_estimate(monkeypatch) -> None:
    monkeypatch.delenv("FLOWENT_AUTO_COMPACT_TOKEN_LIMIT", raising=False)
    messages = [ChatMessage(role="user", content="你" * 600)]

    assert should_auto_compact(messages, context_window=400)


def test_auto_compact_env_limit_overrides_context_window_ratio(monkeypatch) -> None:
    monkeypatch.setenv("FLOWENT_AUTO_COMPACT_TOKEN_LIMIT", "120000")
    messages = [ChatMessage(role="user", content="A" * (120_000 * 4))]

    assert should_auto_compact(messages, context_window=400_000)


def test_auto_compact_includes_tool_schemas(monkeypatch) -> None:
    monkeypatch.delenv("FLOWENT_AUTO_COMPACT_TOKEN_LIMIT", raising=False)
    messages = [ChatMessage(role="user", content="small")]
    tools = [
        {
            "type": "function",
            "function": {
                "description": "A" * 1_600,
                "name": "large_tool",
                "parameters": {"type": "object"},
            },
        }
    ]

    assert should_auto_compact(messages, context_window=400, tools=tools)


def test_token_estimate_uses_utf8_bytes() -> None:
    assert approximate_token_count("你" * 4) == 3


def test_estimated_usage_includes_output_content() -> None:
    usage = estimated_token_usage_for_messages(
        [{"role": "user", "content": "AAAA"}],
        output_content="BBBB",
    )

    assert usage.input_tokens == 1
    assert usage.output_tokens == 1
    assert usage.total_tokens == 2


def test_estimated_request_usage_includes_tool_schemas() -> None:
    usage = estimated_token_usage_for_request(
        [{"role": "user", "content": "AAAA"}],
        tools=[
            {
                "type": "function",
                "function": {
                    "description": "B" * 400,
                    "name": "large_tool",
                    "parameters": {"type": "object"},
                },
            }
        ],
    )

    assert (
        usage.total_tokens
        > estimated_token_usage_for_messages(
            [{"role": "user", "content": "AAAA"}]
        ).total_tokens
    )
