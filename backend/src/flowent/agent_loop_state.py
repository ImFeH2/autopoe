from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from uuid import uuid4

from flowent.llm import (
    ToolCallDelta,
    chunk_delta_content,
    chunk_delta_reasoning,
    chunk_delta_tool_calls,
    chunk_token_usage,
)
from flowent.usage import TokenUsage


@dataclass
class PendingToolCall:
    arguments: str = ""
    id: str = ""
    name: str = ""
    type: str = "function"

    def apply_delta(self, delta: ToolCallDelta) -> None:
        if delta.id:
            self.id = delta.id
        if delta.name:
            self.name = delta.name
        if delta.type:
            self.type = delta.type
        if delta.arguments:
            self.arguments += delta.arguments


@dataclass(frozen=True)
class AgentContextUpdate:
    conversation: Sequence[Mapping[str, object]]
    message: Mapping[str, object]


@dataclass(frozen=True)
class AgentRoundUpdate:
    content: str
    reasoning: str
    usage: TokenUsage | None


@dataclass
class AgentRoundState:
    number: int
    chunk_count: int = 0
    content: str = ""
    content_delta_count: int = 0
    pending_tool_calls: dict[int, PendingToolCall] = field(default_factory=dict)
    reasoning_delta_count: int = 0
    tool_delta_count: int = 0

    def apply_chunk(self, chunk: object) -> AgentRoundUpdate:
        self.chunk_count += 1
        usage = chunk_token_usage(chunk)
        reasoning = chunk_delta_reasoning(chunk)
        if reasoning:
            self.reasoning_delta_count += 1
        content = chunk_delta_content(chunk)
        if content:
            self.content_delta_count += 1
            self.content += content
        for delta in chunk_delta_tool_calls(chunk):
            self.tool_delta_count += 1
            self.pending_tool_calls.setdefault(
                delta.index, PendingToolCall()
            ).apply_delta(delta)
        return AgentRoundUpdate(content=content, reasoning=reasoning, usage=usage)

    @property
    def tool_calls(self) -> list[PendingToolCall]:
        return [
            self.pending_tool_calls[index] for index in sorted(self.pending_tool_calls)
        ]


@dataclass
class AgentLoopState:
    assistant_id: str
    conversation: list[Mapping[str, object]]
    content: str = ""
    thinking: str = ""
    round_number: int = 0

    @classmethod
    def create(
        cls,
        *,
        system_prompt: str,
        messages: Sequence[Mapping[str, object]],
    ) -> "AgentLoopState":
        conversation: list[Mapping[str, object]] = [
            {"role": "system", "content": system_prompt},
            *[dict(message) for message in messages],
        ]
        return cls(assistant_id=str(uuid4()), conversation=conversation)

    def start_round(self) -> AgentRoundState:
        self.round_number += 1
        return AgentRoundState(number=self.round_number)

    def apply_round_update(self, update: AgentRoundUpdate) -> None:
        self.content += update.content
        self.thinking += update.reasoning

    def append_tool_calls(self, round_state: AgentRoundState) -> None:
        self.conversation.append(
            assistant_tool_call_message(round_state.tool_calls, round_state.content)
        )

    def append_tool_result(self, tool_call_id: str, content: str) -> None:
        self.conversation.append(tool_result_message(tool_call_id, content))

    def append_final_response(self) -> None:
        self.conversation.append({"role": "assistant", "content": self.content})

    def replace_conversation(
        self, conversation: Sequence[Mapping[str, object]]
    ) -> None:
        self.conversation = [dict(message) for message in conversation]

    def conversation_copy(self) -> list[dict[str, object]]:
        return [dict(message) for message in self.conversation]


def assistant_tool_call_message(
    tool_calls: Sequence[PendingToolCall],
    content: str,
) -> dict[str, object]:
    return {
        "role": "assistant",
        "content": content or None,
        "tool_calls": [
            {
                "id": tool_call.id or f"call_{index}",
                "type": tool_call.type,
                "function": {
                    "name": tool_call.name,
                    "arguments": tool_call.arguments,
                },
            }
            for index, tool_call in enumerate(tool_calls)
        ],
    }


def tool_result_message(tool_call_id: str, content: str) -> dict[str, object]:
    return {
        "role": "tool",
        "tool_call_id": tool_call_id,
        "content": content,
    }
