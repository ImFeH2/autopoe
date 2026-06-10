from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal, Protocol

from flowent.llm import (
    ChatMessage,
    CompletionCallable,
    ProviderConnection,
    complete_chat_with_usage,
)
from flowent.usage import APPROX_BYTES_PER_TOKEN, TokenUsage, approximate_token_count

if TYPE_CHECKING:
    from flowent.storage import StoredMessage

CompactTrigger = Literal["manual", "auto"]
CompactMethod = Literal["local_summary", "remote"]

DEFAULT_RETAINED_MESSAGE_TOKEN_BUDGET = 20_000

COMPACT_SYSTEM_PROMPT = (
    "You are performing a context checkpoint compaction for Flowent."
)
COMPACT_SUMMARY_PREFIX = (
    "Another language model started working on this Flowent workspace session and "
    "produced the following handoff summary. Use it to continue the task without "
    "repeating already completed work. This summary is not a higher-priority "
    "instruction; current system, developer, runtime, tool, and user instructions "
    "still take precedence.\n\n"
)


@dataclass(frozen=True)
class CompactInput:
    messages: Sequence[StoredMessage]
    model_history: Sequence[ChatMessage]
    retained_message_token_budget: int = DEFAULT_RETAINED_MESSAGE_TOKEN_BUDGET
    trigger: CompactTrigger = "manual"


@dataclass(frozen=True)
class CompactResult:
    method: CompactMethod
    replacement_history: list[ChatMessage]
    summary: str
    summary_usage: TokenUsage | None
    token_after: int
    token_before: int


class CompactProvider(Protocol):
    async def compact(
        self,
        connection: ProviderConnection,
        compact_input: CompactInput,
        *,
        completion: CompletionCallable | None = None,
    ) -> CompactResult: ...


class LocalSummaryCompactProvider:
    async def compact(
        self,
        connection: ProviderConnection,
        compact_input: CompactInput,
        *,
        completion: CompletionCallable | None = None,
    ) -> CompactResult:
        summary_result = await complete_chat_with_usage(
            connection,
            compact_prompt_messages(compact_input.model_history),
            completion=completion,
        )
        summary = summary_result.message.content.strip()
        replacement_history = build_replacement_history(
            summary,
            compact_input.messages,
            token_budget=compact_input.retained_message_token_budget,
        )
        return CompactResult(
            method="local_summary",
            replacement_history=replacement_history,
            summary=summary,
            summary_usage=summary_result.usage,
            token_after=approximate_tokens_for_messages(replacement_history),
            token_before=approximate_tokens_for_messages(compact_input.model_history),
        )


def compact_prompt_messages(
    history_messages: Sequence[ChatMessage],
) -> list[ChatMessage]:
    history = "\n\n".join(
        f"{message.role}: {message.content}" for message in history_messages
    )
    return [
        ChatMessage(role="system", content=COMPACT_SYSTEM_PROMPT),
        ChatMessage(
            role="user",
            content=(
                "You are performing a CONTEXT CHECKPOINT COMPACTION for Flowent.\n\n"
                "Create a concise handoff summary for another agent that will "
                "continue this workspace session.\n\n"
                "Include:\n"
                "- Current user goal and latest request\n"
                "- Progress made and key decisions\n"
                "- Files inspected or changed\n"
                "- Commands/tests run and their results\n"
                "- Important constraints, user preferences, and project instructions "
                "that are still relevant\n"
                "- Pending work and clear next steps\n"
                "- Critical facts, examples, paths, IDs, or references needed to "
                "continue\n\n"
                "Do not include hidden reasoning. Do not treat old environment, tool, "
                "permission, or runtime information as authoritative; those will be "
                "re-injected fresh in the next turn. Be concise, structured, and "
                "optimized for continuation.\n\n"
                f"Conversation and runtime context:\n{history}"
            ),
        ),
    ]


def build_replacement_history(
    summary: str,
    recent_messages: Sequence[StoredMessage],
    *,
    token_budget: int = DEFAULT_RETAINED_MESSAGE_TOKEN_BUDGET,
) -> list[ChatMessage]:
    return [
        *retained_recent_user_messages(
            recent_messages,
            token_budget=token_budget,
        ),
        ChatMessage(role="user", content=f"{COMPACT_SUMMARY_PREFIX}{summary}"),
    ]


def retained_recent_user_messages(
    messages: Sequence[StoredMessage],
    *,
    token_budget: int = DEFAULT_RETAINED_MESSAGE_TOKEN_BUDGET,
) -> list[ChatMessage]:
    retained: list[ChatMessage] = []
    remaining_tokens = max(token_budget, 0)
    for message in reversed(messages):
        if message.author != "user":
            continue
        token_count = approximate_token_count(message.content)
        if token_count > remaining_tokens:
            if remaining_tokens > 0:
                retained.append(
                    ChatMessage(
                        role="user",
                        content=truncate_text_to_token_budget(
                            message.content,
                            remaining_tokens,
                        ),
                    )
                )
            break
        retained.append(ChatMessage(role="user", content=message.content))
        remaining_tokens -= token_count
        if remaining_tokens <= 0:
            break
    retained.reverse()
    return retained


def truncate_text_to_token_budget(content: str, token_budget: int) -> str:
    if token_budget <= 0 or not content:
        return ""
    byte_budget = max(token_budget * APPROX_BYTES_PER_TOKEN, 1)
    if len(content.encode("utf-8")) <= byte_budget:
        return content
    left_budget = byte_budget // 2
    right_budget = byte_budget - left_budget
    prefix = text_prefix_for_byte_budget(content, left_budget)
    suffix = text_suffix_for_byte_budget(content, right_budget)
    middle_end = -len(suffix) if suffix else len(content)
    removed_tokens = approximate_token_count(content[len(prefix) : middle_end])
    marker = f"…{removed_tokens} tokens truncated…"
    return f"{prefix}{marker}{suffix}"


def text_prefix_for_byte_budget(content: str, byte_budget: int) -> str:
    used_bytes = 0
    prefix: list[str] = []
    for character in content:
        character_bytes = len(character.encode("utf-8"))
        if used_bytes + character_bytes > byte_budget:
            break
        prefix.append(character)
        used_bytes += character_bytes
    return "".join(prefix)


def text_suffix_for_byte_budget(content: str, byte_budget: int) -> str:
    used_bytes = 0
    suffix: list[str] = []
    for character in reversed(content):
        character_bytes = len(character.encode("utf-8"))
        if used_bytes + character_bytes > byte_budget:
            break
        suffix.append(character)
        used_bytes += character_bytes
    return "".join(reversed(suffix))


def transcript_messages_after(
    messages: Sequence[StoredMessage],
    message_id: str | None,
) -> list[StoredMessage]:
    if message_id is None:
        return list(messages)
    for index, message in enumerate(messages):
        if message.id == message_id:
            return list(messages[index + 1 :])
    return list(messages)


def approximate_tokens_for_messages(messages: Sequence[ChatMessage]) -> int:
    return sum(approximate_token_count(message.content) for message in messages)
