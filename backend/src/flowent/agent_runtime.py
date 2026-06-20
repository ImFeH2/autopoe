from __future__ import annotations

from collections.abc import (
    AsyncIterator,
    Awaitable,
    Callable,
    Mapping,
    Sequence,
)
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Protocol

from flowent.agent import AgentContextUpdate, AgentStreamEvent, run_agent_stream
from flowent.approval import (
    ApprovalReviewRequest,
    ApprovalTranscriptEntry,
    review_approval_request,
)
from flowent.llm import ChatMessage, CompletionCallable, ProviderConnection
from flowent.permissions import run_tool_with_path_permissions
from flowent.storage import StateStore
from flowent.tools import ToolContext, ToolResult, tool_specs
from flowent.workflow_tools import (
    WorkflowAgentTools,
    workflow_tool_specs,
    workflow_tool_title,
)

if TYPE_CHECKING:
    from flowent.workflow_service import WorkflowService


class AgentMcpManager(Protocol):
    def tool_specs(self) -> Sequence[Mapping[str, object]]: ...

    def tool_title(self, name: str) -> str | None: ...

    async def run_tool(
        self, name: str, arguments: dict[str, object]
    ) -> ToolResult | None: ...


@dataclass(frozen=True)
class AgentRunResult:
    content: str
    history: Sequence[Mapping[str, object]] = ()
    thinking: str = ""


class FlowentAgentRuntime:
    def __init__(
        self,
        *,
        chat_completion: CompletionCallable | None,
        cwd: Path,
        mcp_manager: AgentMcpManager | None,
        store: StateStore,
        workflow_service: WorkflowService | None,
    ) -> None:
        self.chat_completion = chat_completion
        self.cwd = cwd
        self.mcp_manager = mcp_manager
        self.store = store
        self.workflow_service = workflow_service

    def extra_tool_specs(
        self, *, include_workflow_tools: bool = True
    ) -> list[Mapping[str, object]]:
        return [
            *(
                workflow_tool_specs()
                if include_workflow_tools and self.workflow_service is not None
                else []
            ),
            *list(
                self.mcp_manager.tool_specs() if self.mcp_manager is not None else []
            ),
        ]

    def model_tool_specs(
        self, *, include_workflow_tools: bool = True
    ) -> list[Mapping[str, object]]:
        return [
            *tool_specs(),
            *self.extra_tool_specs(include_workflow_tools=include_workflow_tools),
        ]

    def extra_tool_title(self, name: str) -> str | None:
        return (
            workflow_tool_title(name) if self.workflow_service is not None else None
        ) or (
            self.mcp_manager.tool_title(name) if self.mcp_manager is not None else None
        )

    def workflow_tools(self, workflow_depth: int = 0) -> WorkflowAgentTools | None:
        if self.workflow_service is None:
            return None
        return WorkflowAgentTools(
            self.workflow_service,
            workflow_depth=workflow_depth,
        )

    async def run_extra_tool(
        self,
        name: str,
        arguments: dict[str, object],
        *,
        include_workflow_tools: bool = True,
        workflow_depth: int = 0,
    ) -> ToolResult | None:
        workflow_tools = (
            self.workflow_tools(workflow_depth) if include_workflow_tools else None
        )
        if workflow_tools is not None:
            workflow_result = await workflow_tools.run_tool(name, arguments)
            if workflow_result is not None:
                return workflow_result
        if self.mcp_manager is None:
            return None
        return await self.mcp_manager.run_tool(name, arguments)

    async def stream(
        self,
        *,
        approval_transcript: Sequence[ApprovalTranscriptEntry] = (),
        connection: ProviderConnection,
        conversation_recorder: Callable[[Sequence[Mapping[str, object]]], None]
        | None = None,
        context_compactor: Callable[
            [Sequence[Mapping[str, object]]], Awaitable[AgentContextUpdate | None]
        ]
        | None = None,
        include_workflow_tools: bool = True,
        messages: Sequence[ChatMessage | Mapping[str, object]],
        user_request: str,
        workflow_depth: int = 0,
    ) -> AsyncIterator[AgentStreamEvent]:
        transcript = list(approval_transcript)
        request_messages = [
            message.model_dump() if isinstance(message, ChatMessage) else dict(message)
            for message in messages
        ]

        async def review_tool_approval(request: ApprovalReviewRequest):
            return await review_approval_request(
                connection,
                request.model_copy(
                    update={
                        "transcript": transcript,
                        "user_request": user_request,
                    }
                ),
                completion=self.chat_completion,
            )

        async def tool_runner(
            name: str,
            arguments: dict[str, object],
            context: ToolContext,
        ) -> ToolResult:
            return await run_tool_with_path_permissions(
                name,
                arguments,
                context,
                review_approval=review_tool_approval,
                writable_paths=[
                    Path(path.path) for path in self.store.read_writable_paths()
                ],
            )

        async def extra_tool_runner(
            name: str, arguments: dict[str, object]
        ) -> ToolResult | None:
            return await self.run_extra_tool(
                name,
                arguments,
                include_workflow_tools=include_workflow_tools,
                workflow_depth=workflow_depth,
            )

        async for event in run_agent_stream(
            completion=self.chat_completion,
            connection=connection,
            conversation_recorder=conversation_recorder,
            context_compactor=context_compactor,
            cwd=self.cwd,
            extra_tool_runner=extra_tool_runner,
            extra_tool_specs=self.extra_tool_specs(
                include_workflow_tools=include_workflow_tools
            ),
            extra_tool_title=self.extra_tool_title,
            messages=request_messages,
            tool_runner=tool_runner,
        ):
            yield event

    async def complete(
        self,
        *,
        approval_transcript: Sequence[ApprovalTranscriptEntry] = (),
        connection: ProviderConnection,
        include_workflow_tools: bool = True,
        history_start_index: int = 0,
        messages: Sequence[ChatMessage | Mapping[str, object]],
        user_request: str,
        workflow_depth: int = 0,
    ) -> AgentRunResult:
        recorded_conversation: list[Mapping[str, object]] = []

        def record_conversation(
            conversation: Sequence[Mapping[str, object]],
        ) -> None:
            recorded_conversation[:] = [dict(message) for message in conversation]

        async for event in self.stream(
            approval_transcript=approval_transcript,
            connection=connection,
            conversation_recorder=record_conversation,
            include_workflow_tools=include_workflow_tools,
            messages=messages,
            user_request=user_request,
            workflow_depth=workflow_depth,
        ):
            if event.event != "done":
                continue
            message = event.data.get("message")
            if isinstance(message, Mapping):
                return AgentRunResult(
                    content=str(message.get("content") or ""),
                    history=recorded_conversation[history_start_index:],
                    thinking=str(message.get("thinking") or ""),
                )
        raise RuntimeError("Agent did not return a final response.")
