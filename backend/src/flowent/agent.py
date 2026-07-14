from __future__ import annotations

import logging
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping, Sequence
from pathlib import Path

from flowent.agent_events import (
    AgentStreamEvent,
    content_delta_event,
    context_optimized_event,
    done_event,
    output_done_event,
    output_start_event,
    start_event,
    thinking_delta_event,
    usage_event,
)
from flowent.agent_loop_state import AgentContextUpdate, AgentLoopState
from flowent.agent_tool_execution import (
    AgentToolExecution,
    AgentToolServices,
    ExtraToolRunner,
    ExtraToolTitle,
    ToolRunner,
    WebSearcher,
)
from flowent.llm import CompletionCallable, ProviderConnection, stream_chat_chunks
from flowent.logging import TRACE_LEVEL
from flowent.tool_catalog import tool_specs

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
- Use workflow tools when the user asks to view, inspect, run, create, modify, or delete saved workflows. List workflows first when you need the workflow id. Read a workflow before modifying it.
- When running a workflow and the user's current message contains one plain value to process, pass that content as the run_workflow input. When a workflow has multiple input nodes or the user provides separate values, use inputs with the exact input node ids from get_workflow.
- Use start_workflow_schedule for Timer workflows, stop_workflow_schedule to stop them, and get_workflow_schedule to inspect their state and latest trace. Before starting a cron schedule without a timezone, ask the user which IANA timezone to use. When a run or schedule fails, use get_workflow_run with its run_id to inspect the complete trace and the actual immutable workflow revision before repairing the workflow or restarting the schedule.
- When creating or updating a workflow, save a complete workflow object with valid node ids and connections. If saving fails, use the validation error as context and explain what needs to change.
- Use delete_workflow to delete saved workflows when the user clearly asks. If the requested workflow cannot be found, explain that it was not found.
- Search the web only when current external information is needed.
- Update the plan when a task has multiple meaningful steps.

After each tool result, decide whether the task is complete, whether another tool is needed, or whether you need to explain a blocker. A tool call is not a final response. After every tool result, continue the same turn until you either call another tool, explain a blocker, or provide a final response. If a tool fails, use the error as context and continue deciding whether to retry, use another tool, or explain the blocker. When no more tool work is needed, provide the final response."""


async def run_agent_stream(
    *,
    completion: CompletionCallable | None,
    connection: ProviderConnection,
    conversation_recorder: Callable[[Sequence[Mapping[str, object]]], None]
    | None = None,
    cwd: Path,
    messages: Sequence[Mapping[str, object]],
    extra_tool_runner: ExtraToolRunner | None = None,
    extra_tool_specs: Sequence[Mapping[str, object]] | None = None,
    extra_tool_title: ExtraToolTitle | None = None,
    context_compactor: Callable[
        [Sequence[Mapping[str, object]]], Awaitable[AgentContextUpdate | None]
    ]
    | None = None,
    tool_runner: ToolRunner | None = None,
    web_searcher: WebSearcher | None = None,
) -> AsyncIterator[AgentStreamEvent]:
    state = AgentLoopState.create(
        system_prompt=FLOWENT_AGENT_SYSTEM_PROMPT,
        messages=messages,
    )
    tool_services = AgentToolServices(
        cwd=cwd,
        extra_tool_runner=extra_tool_runner,
        extra_tool_title=extra_tool_title,
        tool_runner=tool_runner,
        web_searcher=web_searcher,
    )
    logger.info(
        "Agent response started id=%s provider=%s model=%s",
        state.assistant_id,
        connection.provider,
        connection.model,
    )
    logger.log(TRACE_LEVEL, "Agent initial messages=%r", state.conversation)
    yield start_event(state.assistant_id)

    while True:
        round_state = state.start_round()
        logger.debug(
            "Agent round started id=%s round=%s",
            state.assistant_id,
            round_state.number,
        )
        logger.info(
            "Agent model call started id=%s round=%s conversation_messages=%s",
            state.assistant_id,
            round_state.number,
            len(state.conversation),
        )
        yield output_start_event(round_state.number)

        try:
            async for chunk in stream_chat_chunks(
                connection,
                state.conversation,
                completion=completion,
                tools=[*tool_specs(), *list(extra_tool_specs or [])],
            ):
                update = round_state.apply_chunk(chunk)
                state.apply_round_update(update)
                if update.usage is not None:
                    yield usage_event(update.usage)
                if update.reasoning:
                    logger.log(
                        TRACE_LEVEL,
                        "Agent stream reasoning id=%s round=%s content=%r",
                        state.assistant_id,
                        round_state.number,
                        update.reasoning,
                    )
                    yield thinking_delta_event(update.reasoning)
                if update.content:
                    logger.log(
                        TRACE_LEVEL,
                        "Agent stream delta id=%s round=%s content=%r",
                        state.assistant_id,
                        round_state.number,
                        update.content,
                    )
                    yield content_delta_event(update.content)
        except Exception:
            logger.exception(
                "Agent model call failed id=%s round=%s chunk_count=%s content_deltas=%s reasoning_deltas=%s tool_deltas=%s conversation_messages=%s",
                state.assistant_id,
                round_state.number,
                round_state.chunk_count,
                round_state.content_delta_count,
                round_state.reasoning_delta_count,
                round_state.tool_delta_count,
                len(state.conversation),
            )
            raise

        tool_calls = round_state.tool_calls
        logger.info(
            "Agent model call completed id=%s round=%s chunk_count=%s content_deltas=%s reasoning_deltas=%s tool_deltas=%s tool_calls=%s content_length=%s decision=%s",
            state.assistant_id,
            round_state.number,
            round_state.chunk_count,
            round_state.content_delta_count,
            round_state.reasoning_delta_count,
            round_state.tool_delta_count,
            len(tool_calls),
            len(round_state.content),
            "run_tools" if tool_calls else "final_response",
        )
        logger.log(
            TRACE_LEVEL,
            "Agent round tool calls id=%s round=%s tool_calls=%r",
            state.assistant_id,
            round_state.number,
            tool_calls,
        )
        yield output_done_event(round_state.number)

        if not tool_calls:
            if not state.content and not state.thinking:
                raise RuntimeError(EMPTY_MODEL_RESPONSE_ERROR)
            state.append_final_response()
            if conversation_recorder is not None:
                conversation_recorder(state.conversation_copy())
            logger.info(
                "Agent response completed id=%s rounds=%s content_length=%s thinking_length=%s decision=final_response",
                state.assistant_id,
                round_state.number,
                len(state.content),
                len(state.thinking),
            )
            logger.log(
                TRACE_LEVEL,
                "Agent final content id=%s content=%r",
                state.assistant_id,
                state.content,
            )
            yield done_event(
                assistant_id=state.assistant_id,
                content=state.content,
                thinking=state.thinking,
            )
            return

        state.append_tool_calls(round_state)
        for index, tool_call in enumerate(tool_calls):
            execution = AgentToolExecution(
                index=index,
                services=tool_services,
                tool_call=tool_call,
            )
            async for event in execution.stream():
                yield event
            state.append_tool_result(execution.tool_call_id, execution.model_content)

        logger.info(
            "Agent continuing after tools id=%s completed_round=%s tool_results=%s conversation_messages=%s decision=continue",
            state.assistant_id,
            round_state.number,
            len(tool_calls),
            len(state.conversation),
        )

        if context_compactor is not None:
            compaction = await context_compactor(state.conversation)
            if compaction is not None:
                conversation_length_before = len(state.conversation)
                state.replace_conversation(compaction.conversation)
                logger.info(
                    "Agent context optimized id=%s round=%s conversation_messages_before=%s conversation_messages_after=%s",
                    state.assistant_id,
                    round_state.number,
                    conversation_length_before,
                    len(state.conversation),
                )
                yield context_optimized_event(compaction.message)
