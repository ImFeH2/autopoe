import json
import os
from collections.abc import Mapping, Sequence

from flowent.application_errors import InvalidRequestError
from flowent.compact import transcript_messages_after
from flowent.llm import ChatMessage
from flowent.storage import (
    StoredCompactionCheckpoint,
    StoredMessage,
    StoredSettings,
    StoredState,
)
from flowent.tools import tool_result_model_content
from flowent.usage import (
    TokenUsageInfo,
    current_model_context_window,
    estimated_token_usage_for_messages,
    estimated_token_usage_for_request,
    recompute_context_usage,
)
from flowent.workspace.output import error_context_summary, message_error_items

COMPACTED_CONTEXT_MARKER = "Context compacted"
OPTIMIZED_CONTEXT_MARKER = "Context optimized"
DEFAULT_AUTO_COMPACT_CONTEXT_WINDOW_RATIO = 0.95


def latest_compacted_context_index(messages: list[StoredMessage]) -> int | None:
    for index in range(len(messages) - 1, -1, -1):
        message = messages[index]
        if message.author == "system" and is_context_marker(message):
            return index
    return None


def is_context_marker(message: StoredMessage) -> bool:
    return message.content in {COMPACTED_CONTEXT_MARKER, OPTIMIZED_CONTEXT_MARKER}


def auto_compact_token_limit(context_window: int) -> int:
    raw_limit = os.environ.get("FLOWENT_AUTO_COMPACT_TOKEN_LIMIT", "")
    if not raw_limit:
        return max(0, int(context_window * DEFAULT_AUTO_COMPACT_CONTEXT_WINDOW_RATIO))
    try:
        return max(0, int(raw_limit))
    except ValueError:
        return max(0, int(context_window * DEFAULT_AUTO_COMPACT_CONTEXT_WINDOW_RATIO))


def should_auto_compact(
    messages: Sequence[ChatMessage | Mapping[str, object]],
    *,
    context_window: int,
    tools: Sequence[Mapping[str, object]] = (),
) -> bool:
    token_limit = auto_compact_token_limit(context_window)
    if token_limit <= 0:
        return False
    request_messages = model_request_messages_data(messages)
    if explicit_auto_compact_token_limit():
        return (
            estimated_token_usage_for_messages(request_messages).total_tokens
            >= token_limit
        )
    return (
        estimated_token_usage_for_request(
            request_messages,
            tools=tools,
        ).total_tokens
        >= token_limit
    )


def explicit_auto_compact_token_limit() -> bool:
    raw_limit = os.environ.get("FLOWENT_AUTO_COMPACT_TOKEN_LIMIT", "")
    if not raw_limit:
        return False
    try:
        int(raw_limit)
    except ValueError:
        return False
    return True


def model_visible_messages_for_usage(
    messages: Sequence[Mapping[str, object]],
) -> list[dict[str, object]]:
    return [
        dict(message)
        for message in messages
        if message.get("role") in {"system", "user", "assistant", "tool"}
    ]


def usage_event_data(usage_info: TokenUsageInfo) -> dict[str, object]:
    return {"usage_info": usage_info.model_dump()}


def update_context_usage_for_response(
    usage_info: TokenUsageInfo | None,
    *,
    messages: Sequence[Mapping[str, object]],
    output_content: str,
    output_tools: Sequence[Mapping[str, object]] = (),
    request_tools: Sequence[Mapping[str, object]] = (),
    model_context_window: int,
) -> TokenUsageInfo:
    return recompute_context_usage(
        usage_info,
        estimated_token_usage_for_request(
            [
                *model_visible_messages_for_usage(messages),
                *model_visible_response_messages_for_usage(
                    output_content, output_tools
                ),
            ],
            tools=request_tools,
        ).total_tokens,
        model_context_window=model_context_window,
    )


def model_visible_response_messages_for_usage(
    output_content: str,
    output_tools: Sequence[Mapping[str, object]],
) -> list[dict[str, object]]:
    visible_messages: list[dict[str, object]] = []
    for index, tool in enumerate(output_tools):
        tool_id = str(tool.get("id") or f"call_{index}")
        arguments = tool.get("arguments")
        result_payload = tool.get("result")
        tool_result = result_payload if isinstance(result_payload, dict) else {}
        visible_messages.append(
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [
                    {
                        "id": tool_id,
                        "type": "function",
                        "function": {
                            "name": str(tool.get("name") or ""),
                            "arguments": json.dumps(
                                arguments if arguments is not None else {},
                                ensure_ascii=False,
                            ),
                        },
                    }
                ],
            }
        )
        visible_messages.append(
            {
                "role": "tool",
                "tool_call_id": tool_id,
                "content": tool_result_model_content(tool_result),
            }
        )
    if output_content:
        visible_messages.append({"role": "assistant", "content": output_content})
    return visible_messages


def model_visible_assistant_output_messages(
    message: StoredMessage,
) -> list[dict[str, object]]:
    visible_messages: list[dict[str, object]] = []
    for group in message.groups:
        group_content = "".join(
            item.content for item in group.items if item.type == "text"
        )
        group_tools = [item.tool for item in group.items if item.type == "tool"]
        if not group_tools:
            if group_content:
                visible_messages.append({"role": "assistant", "content": group_content})
            continue
        visible_messages.append(
            {
                "role": "assistant",
                "content": group_content or None,
                "tool_calls": [
                    {
                        "id": tool.id,
                        "type": "function",
                        "function": {
                            "name": tool.name,
                            "arguments": json.dumps(
                                tool.arguments or {},
                                ensure_ascii=False,
                            ),
                        },
                    }
                    for tool in group_tools
                ],
            }
        )
        visible_messages.extend(
            {
                "role": "tool",
                "tool_call_id": tool.id,
                "content": tool_result_model_content(tool.result or {}),
            }
            for tool in group_tools
            if tool.status != "running"
        )
    if not visible_messages and message.content:
        visible_messages.append({"role": "assistant", "content": message.content})
    return visible_messages


def model_visible_workspace_message(message: StoredMessage) -> list[dict[str, object]]:
    if message.author == "user":
        return [{"role": "user", "content": message.content}]
    if message.author != "assistant":
        raise InvalidRequestError("Message history is invalid.")
    errors = message_error_items(message)
    if errors:
        return [
            {"role": "assistant", "content": error_context_summary(error)}
            for error in errors
        ]
    return model_visible_assistant_output_messages(message)


def model_visible_workspace_messages(
    messages: Sequence[StoredMessage],
) -> list[dict[str, object]]:
    visible_messages: list[dict[str, object]] = []
    for message in messages:
        visible_messages.extend(model_visible_workspace_message(message))
    return visible_messages


def compact_prompt_chat_message(message: Mapping[str, object]) -> ChatMessage:
    role_value = message.get("role")
    content = str(message.get("content") or "")
    if role_value == "system":
        return ChatMessage(role="system", content=content)
    if role_value == "assistant":
        tool_calls = message.get("tool_calls")
        if tool_calls:
            return ChatMessage(
                role="assistant",
                content=(
                    f"Tool call: {json.dumps(tool_calls, ensure_ascii=False)}"
                    if not content
                    else f"{content}\nTool call: {json.dumps(tool_calls, ensure_ascii=False)}"
                ),
            )
        return ChatMessage(role="assistant", content=content)
    if role_value == "tool":
        return ChatMessage(role="user", content=f"Tool result: {content}")
    return ChatMessage(role="user", content=content)


def model_request_message_data(
    message: ChatMessage | Mapping[str, object],
) -> dict[str, object]:
    if isinstance(message, ChatMessage):
        return message.model_dump()
    return dict(message)


def model_request_messages_data(
    messages: Sequence[ChatMessage | Mapping[str, object]],
) -> list[dict[str, object]]:
    return [model_request_message_data(message) for message in messages]


def compact_prompt_chat_messages(
    messages: Sequence[ChatMessage | Mapping[str, object]],
) -> list[ChatMessage]:
    return [
        message
        if isinstance(message, ChatMessage)
        else compact_prompt_chat_message(message)
        for message in messages
    ]


def usage_info_for_model(
    usage_info: TokenUsageInfo | None,
    model_context_window: int,
) -> TokenUsageInfo | None:
    if usage_info is None:
        return TokenUsageInfo(model_context_window=model_context_window)
    return usage_info.model_copy(update={"model_context_window": model_context_window})


def context_window_for_settings(settings: StoredSettings) -> int:
    if settings.context_window_limit is not None:
        return settings.context_window_limit
    return current_model_context_window(settings.selected_model)


def state_with_current_model_context_window(state: StoredState) -> StoredState:
    model_context_window = context_window_for_settings(state.settings)
    return state.model_copy(
        update={
            "messages": [
                message.model_copy(
                    update={
                        "usage_info": usage_info_for_model(
                            message.usage_info,
                            model_context_window,
                        )
                    }
                )
                if message.usage_info is not None
                else message
                for message in state.messages
            ],
            "usage_info": usage_info_for_model(
                state.usage_info,
                model_context_window,
            ),
        }
    )


def workspace_chat_messages(
    messages: list[StoredMessage],
    compacted_context: str = "",
    checkpoint: StoredCompactionCheckpoint | None = None,
) -> list[dict[str, object]]:
    chat_messages: list[dict[str, object]] = []

    if checkpoint is not None:
        chat_messages.extend(
            model_request_messages_data(checkpoint.replacement_history)
        )
        visible_messages = transcript_messages_after(
            messages,
            checkpoint.source_message_id,
        )
        for message in visible_messages:
            if message.author == "system" and is_context_marker(message):
                continue
            chat_messages.extend(model_visible_workspace_message(message))
        return chat_messages

    marker_index = latest_compacted_context_index(messages)
    visible_messages = messages

    if compacted_context and marker_index is not None:
        chat_messages.extend(
            [
                {"role": "user", "content": COMPACTED_CONTEXT_MARKER},
                {"role": "assistant", "content": compacted_context},
            ]
        )
        visible_messages = messages[marker_index + 1 :]

    for message in visible_messages:
        if message.author == "system" and is_context_marker(message):
            continue
        chat_messages.extend(model_visible_workspace_message(message))
    return chat_messages
