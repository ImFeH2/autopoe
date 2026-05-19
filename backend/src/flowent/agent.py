from __future__ import annotations

from collections.abc import AsyncIterator, Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

from pydantic import BaseModel, ConfigDict

from flowent.llm import (
    CompletionCallable,
    ProviderConnection,
    ToolCallDelta,
    chunk_delta_content,
    chunk_delta_tool_calls,
    stream_chat_chunks,
)
from flowent.tools import (
    ToolContext,
    new_tool_item,
    parse_tool_arguments,
    run_tool,
    tool_specs,
)


class AgentStreamEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: dict[str, object]
    event: str


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


async def run_agent_stream(
    *,
    completion: CompletionCallable | None,
    connection: ProviderConnection,
    cwd: Path,
    messages: Sequence[Mapping[str, object]],
    web_searcher: Callable[[str], Sequence[dict[str, str]]] | None = None,
    max_tool_rounds: int = 8,
) -> AsyncIterator[AgentStreamEvent]:
    conversation: list[Mapping[str, object]] = [dict(message) for message in messages]
    assistant_id = str(uuid4())
    yield AgentStreamEvent(event="start", data={"id": assistant_id})

    final_content = ""

    for _round in range(max_tool_rounds):
        round_content = ""
        pending: dict[int, PendingToolCall] = {}

        async for chunk in stream_chat_chunks(
            connection, conversation, completion=completion, tools=tool_specs()
        ):
            content = chunk_delta_content(chunk)
            if content:
                round_content += content
                final_content += content
                yield AgentStreamEvent(event="delta", data={"content": content})
            for delta in chunk_delta_tool_calls(chunk):
                pending.setdefault(delta.index, PendingToolCall()).apply_delta(delta)

        tool_calls = [pending[index] for index in sorted(pending)]
        if not tool_calls:
            yield AgentStreamEvent(
                event="done",
                data={
                    "message": {
                        "author": "assistant",
                        "content": final_content,
                        "id": assistant_id,
                    }
                },
            )
            return

        conversation.append(assistant_tool_call_message(tool_calls, round_content))
        for index, tool_call in enumerate(tool_calls):
            tool_call_id = tool_call.id or f"call_{index}"
            try:
                arguments = parse_tool_arguments(tool_call.arguments)
            except Exception as error:
                arguments = {}
                result_content = str(error)
                tool_item = new_tool_item(tool_call.name, arguments)
                yield AgentStreamEvent(event="tool_start", data={"tool": tool_item})
                yield AgentStreamEvent(
                    event="tool_error",
                    data={
                        "id": tool_item["id"],
                        "content": result_content,
                        "data": {},
                        "status": "failed",
                        "title": tool_call.name or "Tool failed",
                    },
                )
            else:
                tool_item = new_tool_item(tool_call.name, arguments)
                yield AgentStreamEvent(event="tool_start", data={"tool": tool_item})
                result = run_tool(
                    tool_call.name,
                    arguments,
                    ToolContext(cwd=cwd, web_searcher=web_searcher),
                )
                result_content = result.content
                yield AgentStreamEvent(
                    event="tool_done" if result.ok else "tool_error",
                    data={
                        "id": tool_item["id"],
                        "content": result.content,
                        "data": result.data,
                        "status": "success" if result.ok else "failed",
                        "title": result.title,
                    },
                )
            conversation.append(tool_result_message(tool_call_id, result_content))

    yield AgentStreamEvent(
        event="error",
        data={"message": "Tool limit reached before the reply finished."},
    )
