from __future__ import annotations

from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from pydantic_ai import (
    Agent,
    AgentRunResultEvent,
    DeferredToolRequests,
    DeferredToolResults,
    FunctionToolCallEvent,
    FunctionToolResultEvent,
    PartDeltaEvent,
    PartStartEvent,
    RunUsage,
    TextPart,
    TextPartDelta,
    ToolDenied,
)
from pydantic_ai.messages import ModelMessage
from pydantic_ai.models import Model
from pydantic_core import to_jsonable_python

from flowent.collaboration import AgentRecord, CollaborationSnapshot, CollaborationStore
from flowent.project import Project
from flowent.tools import CommandTools, FileTools, SpacePaths

Emit = Callable[[dict[str, Any]], None]
ResolveModel = Callable[[], Awaitable[Model]]
RequestApproval = Callable[[dict[str, Any]], Awaitable[bool]]
RoleTool = Callable[..., Any]


class AgentRuntime:
    def __init__(
        self,
        data_dir: Path,
        project: Project,
        emit: Emit,
        model_name: str | None,
        resolve_model: ResolveModel,
        request_approval: RequestApproval,
        store: CollaborationStore,
        snapshot: CollaborationSnapshot,
        role_tools: list[RoleTool] | None = None,
    ):
        self.project = project
        self.emit = emit
        self.model_name = model_name
        self.resolve_model = resolve_model
        self.request_approval = request_approval
        self.store = store
        self.record = snapshot.agent
        self.chat = snapshot.chat
        self.home = (
            data_dir / "projects" / project.id / "agents" / self.record.id / "home"
        )
        self.home.mkdir(parents=True, exist_ok=True)
        self.instructions_path = self.home / "AGENTS.md"
        self.instructions_path.touch(exist_ok=True)
        self.spaces = SpacePaths(project.workspace, self.home)
        self.file_tools = FileTools(self.spaces)
        self.command_tools = CommandTools(self.spaces)
        self.role_tools = role_tools or []
        self.tool_names = [
            *self.file_tools.names,
            *self.command_tools.names,
            *(tool.__name__ for tool in self.role_tools),
        ]
        self.agent = Agent(
            tools=[
                *self.file_tools.functions,
                *self.command_tools.tools,
                *self.role_tools,
            ],
            output_type=[str, DeferredToolRequests],
        )
        self.history = snapshot.history
        self.messages = [message.to_dict() for message in snapshot.messages]
        self.last_turn = snapshot.last_turn
        self.status = (
            "failed"
            if self.last_turn and self.last_turn["status"] in {"failed", "interrupted"}
            else "idle"
        )

    def set_model(self, model_name: str | None) -> None:
        self.model_name = model_name

    def agent_info(self) -> dict[str, str | None]:
        return {
            "id": self.record.id,
            "name": self.record.name,
            "role": self.record.role,
            "kind": self.record.kind,
            "status": self.status,
            "model": self.model_name,
            "home": str(self.home),
        }

    def update_record(self, record: AgentRecord) -> None:
        if record.id != self.record.id:
            raise ValueError("agent ID does not match runtime")
        self.record = record

    def state(self) -> dict[str, Any]:
        return {
            "agent": self.agent_info(),
            "chat": self.chat.to_dict(),
            "messages": self.messages,
            "last_turn": self.last_turn,
        }

    async def run_turn(self, content: str) -> None:
        instructions = self.instructions_path.read_text()
        start = await self.store.start_turn(
            self.project.id,
            self.record.id,
            self.chat.id,
            content,
            instructions,
            self._public_messages(self.history),
            self.tool_names,
        )
        turn_id = start.id
        user_message = start.user_message.to_dict()
        agent_message = start.agent_message.to_dict()
        self.status = "running"
        self.messages.extend([user_message, agent_message])
        self.last_turn = start.snapshot
        self.emit(
            {
                "method": "turn/started",
                "params": {
                    "agent": self.agent_info(),
                    "user_message": user_message,
                    "agent_message": agent_message,
                    "turn": self.last_turn,
                },
            }
        )

        result = None
        try:
            model = await self.resolve_model()
            history = self.history
            user_prompt: str | None = content
            deferred_results: DeferredToolResults | None = None
            usage = RunUsage()
            while True:
                result = None
                async with self.agent.run_stream_events(
                    user_prompt,
                    message_history=history,
                    deferred_tool_results=deferred_results,
                    model=model,
                    instructions=instructions or None,
                    usage=usage,
                ) as events:
                    async for event in events:
                        if isinstance(event, PartStartEvent) and isinstance(
                            event.part, TextPart
                        ):
                            if event.part.content:
                                self._record_event(
                                    turn_id,
                                    {
                                        "kind": "text_delta",
                                        "content": event.part.content,
                                    },
                                )
                        elif isinstance(event, PartDeltaEvent) and isinstance(
                            event.delta, TextPartDelta
                        ):
                            if event.delta.content_delta:
                                self._record_event(
                                    turn_id,
                                    {
                                        "kind": "text_delta",
                                        "content": event.delta.content_delta,
                                    },
                                )
                        elif isinstance(event, FunctionToolCallEvent):
                            self._record_event(
                                turn_id,
                                {
                                    "kind": "tool_call",
                                    "name": event.part.tool_name,
                                    "input": to_jsonable_python(event.part.args),
                                },
                            )
                        elif isinstance(event, FunctionToolResultEvent):
                            self._record_event(
                                turn_id,
                                {
                                    "kind": "tool_result",
                                    "name": event.part.tool_name,
                                    "output": to_jsonable_python(event.part.content),
                                },
                            )
                        elif isinstance(event, AgentRunResultEvent):
                            result = event.result

                if result is None:
                    raise RuntimeError("agent turn ended without a result")
                history = result.all_messages()
                if not isinstance(result.output, DeferredToolRequests):
                    break
                deferred_results = await self._resolve_approvals(
                    turn_id,
                    result.output,
                )
                user_prompt = None

            output = str(result.output)
            agent_message["content"] = output
            agent_message["status"] = "complete"
            self.last_turn["status"] = "completed"
            self.last_turn["context"]["messages"] = self._public_messages(history)
            self.last_turn["usage"] = to_jsonable_python(result.usage)
            self.last_turn["events"].append({"kind": "completed"})
            await self.store.complete_turn(
                self.project.id,
                self.record.id,
                agent_message["id"],
                output,
                self.last_turn,
                history,
            )
            self.history = history
            self.status = "idle"
        except Exception as error:
            message = str(error) or type(error).__name__
            agent_message["content"] = message
            agent_message["status"] = "failed"
            self.status = "failed"
            self.last_turn["status"] = "failed"
            self.last_turn["error"] = message
            self.last_turn["events"].append({"kind": "failed", "message": message})
            await self.store.fail_turn(
                agent_message["id"],
                message,
                self.last_turn,
            )
            self.emit(
                {
                    "method": "turn/failed",
                    "params": {
                        "agent": self.agent_info(),
                        "message": agent_message,
                        "turn": self.last_turn,
                    },
                }
            )
            return

        self.emit(
            {
                "method": "turn/completed",
                "params": {
                    "agent": self.agent_info(),
                    "message": agent_message,
                    "turn": self.last_turn,
                },
            }
        )

    async def _resolve_approvals(
        self,
        turn_id: str,
        requests: DeferredToolRequests,
    ) -> DeferredToolResults:
        if requests.calls:
            raise RuntimeError("external deferred tools are not supported")
        if not requests.approvals:
            raise RuntimeError("approval request is empty")
        approvals: dict[str, bool | ToolDenied] = {}
        for call in requests.approvals:
            tool_call_id = call.tool_call_id
            if not tool_call_id:
                raise RuntimeError("approval request is missing a tool call ID")
            params = {
                "turn_id": turn_id,
                "agent_id": self.record.id,
                "tool_call_id": tool_call_id,
                "tool": call.tool_name,
                "input": call.args_as_dict(),
            }
            self.status = "waiting"
            self._record_event(
                turn_id,
                {
                    "kind": "approval_requested",
                    "tool_call_id": tool_call_id,
                    "name": call.tool_name,
                    "input": params["input"],
                },
            )
            self.emit({"method": "agent/updated", "params": self.agent_info()})
            try:
                approved = await self.request_approval(params)
            finally:
                self.status = "running"
                self.emit({"method": "agent/updated", "params": self.agent_info()})
            approvals[tool_call_id] = (
                True if approved else ToolDenied("User denied command")
            )
            self._record_event(
                turn_id,
                {
                    "kind": "approval_resolved",
                    "tool_call_id": tool_call_id,
                    "approved": approved,
                },
            )
        return requests.build_results(approvals=approvals)

    def _record_event(self, turn_id: str, event: dict[str, Any]) -> None:
        if self.last_turn is None:
            return
        self.last_turn["events"].append(event)
        self.emit(
            {
                "method": "turn/event",
                "params": {"turn_id": turn_id, "event": event},
            }
        )

    @staticmethod
    def _public_messages(messages: list[ModelMessage]) -> list[dict[str, Any]]:
        serialized = to_jsonable_python(messages)
        if not isinstance(serialized, list):
            return []
        for message in serialized:
            if not isinstance(message, dict):
                continue
            parts = message.get("parts")
            if not isinstance(parts, list):
                continue
            message["parts"] = [
                part
                for part in parts
                if not isinstance(part, dict) or part.get("part_kind") != "thinking"
            ]
        return serialized
