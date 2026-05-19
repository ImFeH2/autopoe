from __future__ import annotations

import logging
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
from flowent.logging import TRACE_LEVEL
from flowent.tools import (
    ToolContext,
    new_tool_item,
    parse_tool_arguments,
    run_tool,
    tool_specs,
)

logger = logging.getLogger("flowent.agent")


FLOWENT_AGENT_SYSTEM_PROMPT = """You are Flowent, an agent that completes tasks by combining conversation context with available tools.

Work through each turn until the request is resolved. If the current context is enough, answer directly. If more information or action is needed, call the appropriate tool, read the result, and continue from that new context.

Use tools deliberately:
- Read files and list directories before making file changes that depend on existing project context.
- Search files when you need to find definitions, references, or related behavior.
- Apply structured patches for file edits.
- Run shell commands for diagnostics, builds, tests, and operations that require the local environment.
- Search the web only when current external information is needed.
- Update the plan when a task has multiple meaningful steps.

After each tool result, decide whether the task is complete, whether another tool is needed, or whether you need to explain a blocker. When no more tool work is needed, provide the final response."""


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
) -> AsyncIterator[AgentStreamEvent]:
    conversation: list[Mapping[str, object]] = [
        {"role": "system", "content": FLOWENT_AGENT_SYSTEM_PROMPT},
        *[dict(message) for message in messages],
    ]
    assistant_id = str(uuid4())
    logger.info(
        "Agent response started id=%s provider=%s model=%s",
        assistant_id,
        connection.provider,
        connection.model,
    )
    logger.log(TRACE_LEVEL, "Agent initial messages=%r", conversation)
    yield AgentStreamEvent(event="start", data={"id": assistant_id})

    final_content = ""

    round_number = 0
    while True:
        round_number += 1
        logger.debug("Agent round started id=%s round=%s", assistant_id, round_number)
        round_content = ""
        pending: dict[int, PendingToolCall] = {}

        async for chunk in stream_chat_chunks(
            connection, conversation, completion=completion, tools=tool_specs()
        ):
            content = chunk_delta_content(chunk)
            if content:
                round_content += content
                final_content += content
                logger.log(
                    TRACE_LEVEL,
                    "Agent stream delta id=%s content=%r",
                    assistant_id,
                    content,
                )
                yield AgentStreamEvent(event="delta", data={"content": content})
            for delta in chunk_delta_tool_calls(chunk):
                pending.setdefault(delta.index, PendingToolCall()).apply_delta(delta)

        tool_calls = [pending[index] for index in sorted(pending)]
        logger.log(
            TRACE_LEVEL,
            "Agent round tool calls id=%s tool_calls=%r",
            assistant_id,
            tool_calls,
        )
        if not tool_calls:
            logger.info(
                "Agent response completed id=%s content_length=%s",
                assistant_id,
                len(final_content),
            )
            logger.log(
                TRACE_LEVEL,
                "Agent final content id=%s content=%r",
                assistant_id,
                final_content,
            )
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
                logger.debug("Tool call argument parse failed name=%s", tool_call.name)
                logger.log(TRACE_LEVEL, "Tool start item=%r", tool_item)
                yield AgentStreamEvent(event="tool_start", data={"tool": tool_item})
                logger.log(
                    TRACE_LEVEL,
                    "Tool error id=%s content=%r",
                    tool_item["id"],
                    result_content,
                )
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
                logger.debug(
                    "Tool call started name=%s id=%s", tool_call.name, tool_item["id"]
                )
                logger.log(TRACE_LEVEL, "Tool start item=%r", tool_item)
                yield AgentStreamEvent(event="tool_start", data={"tool": tool_item})
                result = run_tool(
                    tool_call.name,
                    arguments,
                    ToolContext(cwd=cwd, web_searcher=web_searcher),
                )
                result_content = result.content
                logger.debug(
                    "Tool call finished name=%s id=%s ok=%s",
                    tool_call.name,
                    tool_item["id"],
                    result.ok,
                )
                logger.log(
                    TRACE_LEVEL,
                    "Tool result id=%s result=%r",
                    tool_item["id"],
                    result.model_dump(),
                )
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
