from __future__ import annotations

import logging
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

from pydantic import BaseModel, ConfigDict

from flowent.llm import (
    CompletionCallable,
    ProviderConnection,
    ToolCallDelta,
    chunk_delta_content,
    chunk_delta_reasoning,
    chunk_delta_tool_calls,
    chunk_token_usage,
    stream_chat_chunks,
)
from flowent.logging import TRACE_LEVEL
from flowent.tools import (
    ToolContext,
    ToolResult,
    new_tool_item,
    parse_tool_arguments,
    run_tool_async,
    tool_specs,
)

logger = logging.getLogger("flowent.agent")
EMPTY_MODEL_RESPONSE_ERROR = "The model did not return a response."


FLOWENT_AGENT_SYSTEM_PROMPT = """You are Flowent, an agent that completes tasks by combining conversation context with available tools.

Work through each turn until the request is resolved. If the current context is enough, answer directly. If more information or action is needed, call the appropriate tool, read the result, and continue from that new context.

Use tools deliberately:
- Read files and list directories before making file changes that depend on existing project context.
- Search files when you need to find definitions, references, or related behavior.
- Apply structured patches for file edits.
- Run shell commands for diagnostics, builds, tests, and operations that require the local environment.
- When a shell command needs to write outside the current workspace, declare each needed writable directory with sandbox_permissions set to with_additional_permissions and additional_permissions.file_system.write. Flowent reviews elevated permissions automatically, so keep the requested paths specific and tied to the task.
- Search the web only when current external information is needed.
- Update the plan when a task has multiple meaningful steps.

After each tool result, decide whether the task is complete, whether another tool is needed, or whether you need to explain a blocker. A tool call is not a final response. After every tool result, continue the same turn until you either call another tool, explain a blocker, or provide a final response. If a tool fails, use the error as context and continue deciding whether to retry, use another tool, or explain the blocker. When no more tool work is needed, provide the final response."""


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


@dataclass(frozen=True)
class AgentContextUpdate:
    conversation: Sequence[Mapping[str, object]]
    message: Mapping[str, object]


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
    extra_tool_runner: Callable[[str, dict[str, object]], Awaitable[ToolResult | None]]
    | None = None,
    extra_tool_specs: Sequence[Mapping[str, object]] | None = None,
    extra_tool_title: Callable[[str], str | None] | None = None,
    context_compactor: Callable[
        [Sequence[Mapping[str, object]]], Awaitable[AgentContextUpdate | None]
    ]
    | None = None,
    tool_runner: Callable[[str, dict[str, object], ToolContext], Awaitable[ToolResult]]
    | None = None,
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
    final_thinking = ""

    round_number = 0
    while True:
        round_number += 1
        logger.debug("Agent round started id=%s round=%s", assistant_id, round_number)
        logger.info(
            "Agent model call started id=%s round=%s conversation_messages=%s",
            assistant_id,
            round_number,
            len(conversation),
        )
        yield AgentStreamEvent(event="output_start", data={"index": round_number})
        round_content = ""
        pending: dict[int, PendingToolCall] = {}
        chunk_count = 0
        content_delta_count = 0
        reasoning_delta_count = 0
        tool_delta_count = 0

        try:
            async for chunk in stream_chat_chunks(
                connection,
                conversation,
                completion=completion,
                tools=[*tool_specs(), *list(extra_tool_specs or [])],
            ):
                chunk_count += 1
                usage = chunk_token_usage(chunk)
                if usage is not None:
                    yield AgentStreamEvent(
                        event="usage",
                        data={"usage": usage.model_dump()},
                    )
                reasoning = chunk_delta_reasoning(chunk)
                if reasoning:
                    reasoning_delta_count += 1
                    final_thinking += reasoning
                    logger.log(
                        TRACE_LEVEL,
                        "Agent stream reasoning id=%s round=%s content=%r",
                        assistant_id,
                        round_number,
                        reasoning,
                    )
                    yield AgentStreamEvent(
                        event="thinking_delta", data={"content": reasoning}
                    )
                content = chunk_delta_content(chunk)
                if content:
                    content_delta_count += 1
                    round_content += content
                    final_content += content
                    logger.log(
                        TRACE_LEVEL,
                        "Agent stream delta id=%s round=%s content=%r",
                        assistant_id,
                        round_number,
                        content,
                    )
                    yield AgentStreamEvent(event="delta", data={"content": content})
                for delta in chunk_delta_tool_calls(chunk):
                    tool_delta_count += 1
                    pending.setdefault(delta.index, PendingToolCall()).apply_delta(
                        delta
                    )
        except Exception:
            logger.exception(
                "Agent model call failed id=%s round=%s chunk_count=%s content_deltas=%s reasoning_deltas=%s tool_deltas=%s conversation_messages=%s",
                assistant_id,
                round_number,
                chunk_count,
                content_delta_count,
                reasoning_delta_count,
                tool_delta_count,
                len(conversation),
            )
            raise

        tool_calls = [pending[index] for index in sorted(pending)]
        logger.info(
            "Agent model call completed id=%s round=%s chunk_count=%s content_deltas=%s reasoning_deltas=%s tool_deltas=%s tool_calls=%s content_length=%s decision=%s",
            assistant_id,
            round_number,
            chunk_count,
            content_delta_count,
            reasoning_delta_count,
            tool_delta_count,
            len(tool_calls),
            len(round_content),
            "run_tools" if tool_calls else "final_response",
        )
        logger.log(
            TRACE_LEVEL,
            "Agent round tool calls id=%s round=%s tool_calls=%r",
            assistant_id,
            round_number,
            tool_calls,
        )
        yield AgentStreamEvent(event="output_done", data={"index": round_number})
        if not tool_calls:
            if not final_content and not final_thinking:
                raise RuntimeError(EMPTY_MODEL_RESPONSE_ERROR)
            logger.info(
                "Agent response completed id=%s rounds=%s content_length=%s thinking_length=%s decision=final_response",
                assistant_id,
                round_number,
                len(final_content),
                len(final_thinking),
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
                        "thinking": final_thinking,
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
                tool_item = new_tool_item(
                    tool_call.name,
                    arguments,
                    extra_tool_title(tool_call.name) if extra_tool_title else None,
                )
                logger.debug(
                    "Tool call started name=%s id=%s", tool_call.name, tool_item["id"]
                )
                logger.log(TRACE_LEVEL, "Tool start item=%r", tool_item)
                yield AgentStreamEvent(event="tool_start", data={"tool": tool_item})
                extra_result = (
                    await extra_tool_runner(tool_call.name, arguments)
                    if extra_tool_runner is not None
                    else None
                )
                result = extra_result if isinstance(extra_result, ToolResult) else None
                if result is None:
                    context = ToolContext(cwd=cwd, web_searcher=web_searcher)
                    result = await (
                        tool_runner(
                            tool_call.name,
                            arguments,
                            context,
                        )
                        if tool_runner is not None
                        else run_tool_async(
                            tool_call.name,
                            arguments,
                            context,
                        )
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

        logger.info(
            "Agent continuing after tools id=%s completed_round=%s tool_results=%s conversation_messages=%s decision=continue",
            assistant_id,
            round_number,
            len(tool_calls),
            len(conversation),
        )

        if context_compactor is not None:
            compaction = await context_compactor(conversation)
            if compaction is not None:
                logger.info(
                    "Agent context optimized id=%s round=%s conversation_messages_before=%s conversation_messages_after=%s",
                    assistant_id,
                    round_number,
                    len(conversation),
                    len(compaction.conversation),
                )
                conversation = [dict(message) for message in compaction.conversation]
                compaction_message = dict(compaction.message)
                usage_info = compaction_message.pop("usage_info", None)
                event_data: dict[str, object] = {"message": compaction_message}
                if isinstance(usage_info, dict):
                    event_data["usage_info"] = usage_info
                yield AgentStreamEvent(event="context_optimized", data=event_data)
