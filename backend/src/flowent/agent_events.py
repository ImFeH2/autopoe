from collections.abc import Mapping

from pydantic import BaseModel, ConfigDict

from flowent.tools import ToolResult
from flowent.usage import TokenUsage


class AgentStreamEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: dict[str, object]
    event: str


def start_event(assistant_id: str) -> AgentStreamEvent:
    return AgentStreamEvent(event="start", data={"id": assistant_id})


def output_start_event(round_number: int) -> AgentStreamEvent:
    return AgentStreamEvent(event="output_start", data={"index": round_number})


def usage_event(usage: TokenUsage) -> AgentStreamEvent:
    return AgentStreamEvent(event="usage", data={"usage": usage.model_dump()})


def thinking_delta_event(content: str) -> AgentStreamEvent:
    return AgentStreamEvent(event="thinking_delta", data={"content": content})


def content_delta_event(content: str) -> AgentStreamEvent:
    return AgentStreamEvent(event="delta", data={"content": content})


def output_done_event(round_number: int) -> AgentStreamEvent:
    return AgentStreamEvent(event="output_done", data={"index": round_number})


def tool_start_event(tool_item: dict[str, object]) -> AgentStreamEvent:
    return AgentStreamEvent(event="tool_start", data={"tool": tool_item})


def tool_update_event(data: dict[str, object]) -> AgentStreamEvent:
    return AgentStreamEvent(event="tool_update", data=data)


def tool_result_event(tool_id: object, result: ToolResult) -> AgentStreamEvent:
    return AgentStreamEvent(
        event="tool_done" if result.ok else "tool_error",
        data={
            "id": tool_id,
            "result": result.result,
            "status": "success" if result.ok else "failed",
            "title": result.title,
        },
    )


def context_optimized_event(message: Mapping[str, object]) -> AgentStreamEvent:
    event_message = dict(message)
    usage_info = event_message.pop("usage_info", None)
    data: dict[str, object] = {"message": event_message}
    if isinstance(usage_info, dict):
        data["usage_info"] = usage_info
    return AgentStreamEvent(event="context_optimized", data=data)


def done_event(
    *,
    assistant_id: str,
    content: str,
    thinking: str,
) -> AgentStreamEvent:
    return AgentStreamEvent(
        event="done",
        data={
            "message": {
                "author": "assistant",
                "content": content,
                "id": assistant_id,
                "thinking": thinking,
            }
        },
    )
