from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator, Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import cast

from flowent.agent_events import (
    AgentStreamEvent,
    tool_result_event,
    tool_start_event,
    tool_update_event,
)
from flowent.agent_loop_state import PendingToolCall
from flowent.logging import TRACE_LEVEL
from flowent.tools import (
    ToolContext,
    ToolResult,
    new_tool_item,
    parse_tool_arguments,
    run_tool_async,
    text_tool_result,
    tool_result_model_content,
)

logger = logging.getLogger("flowent.agent")

ExtraToolRunner = Callable[[str, dict[str, object]], Awaitable[ToolResult | None]]
ExtraToolTitle = Callable[[str], str | None]
ToolRunner = Callable[[str, dict[str, object], ToolContext], Awaitable[ToolResult]]
WebSearcher = Callable[[str], Sequence[dict[str, str]]]


@dataclass(frozen=True)
class AgentToolServices:
    cwd: Path
    extra_tool_runner: ExtraToolRunner | None = None
    extra_tool_title: ExtraToolTitle | None = None
    tool_runner: ToolRunner | None = None
    web_searcher: WebSearcher | None = None


@dataclass
class AgentToolExecution:
    index: int
    services: AgentToolServices
    tool_call: PendingToolCall
    model_content: str = field(init=False, default="")
    tool_result: ToolResult | None = field(init=False, default=None)

    @property
    def tool_call_id(self) -> str:
        return self.tool_call.id or f"call_{self.index}"

    async def stream(self) -> AsyncIterator[AgentStreamEvent]:
        try:
            arguments = parse_tool_arguments(self.tool_call.arguments)
        except Exception as error:
            result = ToolResult(
                result=text_tool_result(str(error)),
                ok=False,
                title=self.tool_call.name or "Tool failed",
            )
            self.model_content = tool_result_model_content(result)
            tool_item = new_tool_item(self.tool_call.name, {})
            logger.debug("Tool call argument parse failed name=%s", self.tool_call.name)
            logger.log(TRACE_LEVEL, "Tool start item=%r", tool_item)
            yield tool_start_event(tool_item)
            logger.log(
                TRACE_LEVEL,
                "Tool error id=%s content=%r",
                tool_item["id"],
                self.model_content,
            )
            yield tool_result_event(tool_item["id"], result)
            return

        title = (
            self.services.extra_tool_title(self.tool_call.name)
            if self.services.extra_tool_title
            else None
        )
        tool_item = new_tool_item(self.tool_call.name, arguments, title)
        logger.debug(
            "Tool call started name=%s id=%s",
            self.tool_call.name,
            tool_item["id"],
        )
        logger.log(TRACE_LEVEL, "Tool start item=%r", tool_item)
        yield tool_start_event(tool_item)

        extra_result = (
            await self.services.extra_tool_runner(self.tool_call.name, arguments)
            if self.services.extra_tool_runner is not None
            else None
        )
        if isinstance(extra_result, ToolResult):
            tool_result = extra_result
        else:
            async for event in self._stream_tool(arguments, str(tool_item["id"])):
                yield event
            tool_result = cast(ToolResult, self.tool_result)
        self.model_content = tool_result_model_content(tool_result)
        logger.debug(
            "Tool call finished name=%s id=%s ok=%s",
            self.tool_call.name,
            tool_item["id"],
            tool_result.ok,
        )
        logger.log(
            TRACE_LEVEL,
            "Tool result id=%s result=%r",
            tool_item["id"],
            tool_result.model_dump(),
        )
        yield tool_result_event(tool_item["id"], tool_result)

    async def _stream_tool(
        self,
        arguments: dict[str, object],
        tool_id: str,
    ) -> AsyncIterator[AgentStreamEvent]:
        event_queue: asyncio.Queue[dict[str, object]] = asyncio.Queue()

        async def emit_tool_event(data: dict[str, object]) -> None:
            await event_queue.put({"id": tool_id, **data})

        context = ToolContext(
            cwd=self.services.cwd,
            emit_event=emit_tool_event,
            web_searcher=self.services.web_searcher,
        )
        tool_task: asyncio.Future[ToolResult] = asyncio.ensure_future(
            self.services.tool_runner(self.tool_call.name, arguments, context)
            if self.services.tool_runner is not None
            else run_tool_async(self.tool_call.name, arguments, context)
        )
        pending_event_task: asyncio.Future[dict[str, object]] | None = None
        try:
            while True:
                if pending_event_task is None:
                    pending_event_task = asyncio.create_task(event_queue.get())
                done, _ = await asyncio.wait(
                    {
                        cast(asyncio.Future[object], tool_task),
                        cast(asyncio.Future[object], pending_event_task),
                    },
                    return_when=asyncio.FIRST_COMPLETED,
                )
                if pending_event_task in done:
                    yield tool_update_event(pending_event_task.result())
                    pending_event_task = None
                if tool_task in done:
                    if pending_event_task is not None:
                        pending_event_task.cancel()
                    break
        except asyncio.CancelledError:
            tool_task.cancel()
            if pending_event_task is not None:
                pending_event_task.cancel()
            raise
        self.tool_result = await tool_task
        while not event_queue.empty():
            yield tool_update_event(event_queue.get_nowait())
