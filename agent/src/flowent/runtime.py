from __future__ import annotations

from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from pydantic_ai import (
    Agent,
    AgentRunResultEvent,
    FunctionToolCallEvent,
    FunctionToolResultEvent,
    PartDeltaEvent,
    PartStartEvent,
    TextPart,
    TextPartDelta,
)
from pydantic_ai.messages import ModelMessage
from pydantic_ai.models import Model
from pydantic_core import to_jsonable_python

from flowent.collaboration import CollaborationSnapshot, CollaborationStore
from flowent.project import Project

Emit = Callable[[dict[str, Any]], None]
ResolveModel = Callable[[], Awaitable[Model]]


class AgentRuntime:
    def __init__(
        self,
        data_dir: Path,
        project: Project,
        emit: Emit,
        model_name: str | None,
        resolve_model: ResolveModel,
        store: CollaborationStore,
        snapshot: CollaborationSnapshot,
    ):
        self.project = project
        self.emit = emit
        self.model_name = model_name
        self.resolve_model = resolve_model
        self.store = store
        self.record = snapshot.agent
        self.chat = snapshot.chat
        self.home = (
            data_dir / "projects" / project.id / "agents" / self.record.id / "home"
        )
        self.home.mkdir(parents=True, exist_ok=True)
        self.instructions_path = self.home / "AGENTS.md"
        self.instructions_path.touch(exist_ok=True)
        self.agent = Agent()
        self.agent.tool_plain(self.read_home_file)
        self.history = snapshot.history
        self.messages = [message.to_dict() for message in snapshot.messages]
        self.last_turn = snapshot.last_turn
        self.status = (
            "failed"
            if self.last_turn and self.last_turn["status"] in {"failed", "interrupted"}
            else "idle"
        )

    def read_home_file(self, path: str = "AGENTS.md") -> str:
        home = self.home.resolve()
        target = (home / path).resolve()
        if not target.is_relative_to(home):
            raise ValueError("path escapes agent home")
        return target.read_text()

    def set_model(self, model_name: str | None) -> None:
        self.model_name = model_name

    def agent_info(self) -> dict[str, str | None]:
        return {
            "id": self.record.id,
            "name": self.record.name,
            "role": self.record.role,
            "status": self.status,
            "model": self.model_name,
            "home": str(self.home),
        }

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
            ["read_home_file"],
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
            async with self.agent.run_stream_events(
                content,
                message_history=self.history,
                model=model,
                instructions=instructions or None,
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

            output = str(result.output)
            history = result.all_messages()
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
