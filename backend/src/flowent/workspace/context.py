import json
import os
from collections.abc import Mapping, Sequence
from typing import Literal

from fastapi import HTTPException

from flowent.compact import transcript_messages_after
from flowent.llm import ChatMessage
from flowent.storage import (
    StoredCompactionCheckpoint,
    StoredMessage,
    StoredSettings,
    StoredState,
)
from flowent.usage import (
    TokenUsageInfo,
    current_model_context_window,
    estimated_token_usage_for_messages,
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
    messages: list[ChatMessage],
    *,
    context_window: int,
) -> bool:
    token_limit = auto_compact_token_limit(context_window)
    if token_limit <= 0:
        return False
    return (
        estimated_token_usage_for_messages(
            [message.model_dump() for message in messages]
        ).total_tokens
        >= token_limit
    )


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
    model_context_window: int,
) -> TokenUsageInfo:
    return recompute_context_usage(
        usage_info,
        estimated_token_usage_for_messages(
            [
                *model_visible_messages_for_usage(messages),
                *model_visible_response_messages_for_usage(
                    output_content, output_tools
                ),
            ],
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
                "content": str(tool.get("content") or ""),
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
                "content": tool.content or "",
            }
            for tool in group_tools
            if tool.status != "running"
        )
    if not visible_messages and message.content:
        visible_messages.append({"role": "assistant", "content": message.content})
    return visible_messages


def usage_info_for_model(
    usage_info: TokenUsageInfo | None,
    model_context_window: int,
) -> TokenUsageInfo | None:
    if usage_info is None:
        return None
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
) -> list[ChatMessage]:
    chat_messages: list[ChatMessage] = []

    if checkpoint is not None:
        chat_messages.extend(checkpoint.replacement_history)
        visible_messages = transcript_messages_after(
            messages,
            checkpoint.source_message_id,
        )
        for message in visible_messages:
            if message.author == "system" and is_context_marker(message):
                continue
            if message.author not in ("user", "assistant"):
                raise HTTPException(
                    status_code=400, detail="Message history is invalid."
                )
            if message.author == "assistant":
                errors = message_error_items(message)
                if errors:
                    chat_messages.extend(
                        ChatMessage(
                            role="assistant", content=error_context_summary(error)
                        )
                        for error in errors
                    )
                    continue
            checkpoint_role: Literal["user", "assistant"] = (
                "user" if message.author == "user" else "assistant"
            )
            chat_messages.append(
                ChatMessage(role=checkpoint_role, content=message.content)
            )
        return chat_messages

    marker_index = latest_compacted_context_index(messages)
    visible_messages = messages

    if compacted_context and marker_index is not None:
        chat_messages.extend(
            [
                ChatMessage(role="user", content=COMPACTED_CONTEXT_MARKER),
                ChatMessage(role="assistant", content=compacted_context),
            ]
        )
        visible_messages = messages[marker_index + 1 :]

    for message in visible_messages:
        if message.author == "system" and is_context_marker(message):
            continue
        if message.author not in ("user", "assistant"):
            raise HTTPException(status_code=400, detail="Message history is invalid.")
        if message.author == "assistant":
            errors = message_error_items(message)
            if errors:
                chat_messages.extend(
                    ChatMessage(role="assistant", content=error_context_summary(error))
                    for error in errors
                )
                continue
        role: Literal["user", "assistant"] = (
            "user" if message.author == "user" else "assistant"
        )
        chat_messages.append(ChatMessage(role=role, content=message.content))
    return chat_messages
