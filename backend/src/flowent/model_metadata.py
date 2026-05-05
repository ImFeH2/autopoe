from __future__ import annotations

from flowent.models import ModelCapabilities, ModelInfo

_STATIC_CONTEXT_WINDOWS: tuple[tuple[tuple[str, ...], int], ...] = (
    (("gpt-5", "gpt-4.1", "gpt-4o", "o1", "o3"), 128_000),
    (("claude-3", "claude-sonnet-4", "claude-opus-4"), 200_000),
    (("gemini-2.5", "gemini-2.0"), 1_000_000),
)
_STATIC_INPUT_IMAGE_PREFIXES: tuple[str, ...] = (
    "gpt-5",
    "gpt-4.1",
    "gpt-4o",
    "claude-3",
    "claude-sonnet-4",
    "claude-opus-4",
    "gemini-2.5",
    "gemini-2.0",
)
_STATIC_OPENAI_RESPONSES_OUTPUT_IMAGE_PREFIXES: tuple[str, ...] = (
    "gpt-5",
    "gpt-4.1",
    "gpt-4o",
)


def _normalize_model_id(model_id: str) -> str:
    return model_id.strip().lower()


def infer_model_capabilities(
    *,
    provider_type: str,
    model_id: str,
    input_image: bool | None = None,
    output_image: bool | None = None,
    structured_output: bool | None = None,
) -> ModelCapabilities:
    normalized_model_id = _normalize_model_id(model_id)
    inferred_input_image = any(
        normalized_model_id.startswith(prefix)
        for prefix in _STATIC_INPUT_IMAGE_PREFIXES
    )
    if provider_type == "gemini":
        inferred_input_image = True
    inferred_output_image = False
    if provider_type == "openai_responses":
        inferred_output_image = any(
            normalized_model_id.startswith(prefix)
            for prefix in _STATIC_OPENAI_RESPONSES_OUTPUT_IMAGE_PREFIXES
        )
    elif provider_type == "gemini":
        inferred_output_image = "image" in normalized_model_id
    return ModelCapabilities(
        input_image=inferred_input_image if input_image is None else input_image,
        output_image=(inferred_output_image if output_image is None else output_image),
        structured_output=False if structured_output is None else structured_output,
    )


def infer_context_window_tokens(
    *,
    provider_type: str,
    model_id: str,
    context_window_tokens: int | None = None,
) -> int | None:
    if isinstance(context_window_tokens, int) and context_window_tokens > 0:
        return context_window_tokens

    normalized_model_id = _normalize_model_id(model_id)
    for prefixes, inferred_limit in _STATIC_CONTEXT_WINDOWS:
        if any(normalized_model_id.startswith(prefix) for prefix in prefixes):
            return inferred_limit
    if provider_type == "gemini" and normalized_model_id:
        return 1_000_000
    return None


def build_model_info(
    *,
    provider_type: str,
    model_id: str,
    input_image: bool | None = None,
    output_image: bool | None = None,
    structured_output: bool | None = None,
    context_window_tokens: int | None = None,
) -> ModelInfo:
    return ModelInfo(
        id=model_id,
        capabilities=infer_model_capabilities(
            provider_type=provider_type,
            model_id=model_id,
            input_image=input_image,
            output_image=output_image,
            structured_output=structured_output,
        ),
        context_window_tokens=infer_context_window_tokens(
            provider_type=provider_type,
            model_id=model_id,
            context_window_tokens=context_window_tokens,
        ),
    )
