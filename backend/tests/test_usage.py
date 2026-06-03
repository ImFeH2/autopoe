from flowent.usage import DEFAULT_MODEL_CONTEXT_WINDOW, model_context_window_for


def test_model_context_window_uses_exact_model_match() -> None:
    assert model_context_window_for("gpt-5.1") == 272_000


def test_model_context_window_uses_provider_prefixed_model_match() -> None:
    assert model_context_window_for("openai/gpt-5.1") == 272_000


def test_model_context_window_uses_longest_prefix_match() -> None:
    assert model_context_window_for("gpt-5.4-mini-experimental") == 272_000


def test_model_context_window_falls_back_for_unknown_model() -> None:
    assert model_context_window_for("custom-model") == DEFAULT_MODEL_CONTEXT_WINDOW
