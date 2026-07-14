from collections.abc import Mapping, Sequence
from pathlib import Path

import pytest

from flowent.agent import AgentContextUpdate, run_agent_stream
from flowent.llm import ProviderConnection, ProviderFormat
from flowent.tools import ToolContext, ToolResult, text_tool_result


def provider_connection() -> ProviderConnection:
    return ProviderConnection(
        model="gpt-5.1",
        name="Provider",
        provider=ProviderFormat.OPENAI,
        secret_reference="secret",
    )


def tool_call_delta_chunk(
    *,
    arguments: str,
    call_id: str = "",
    content: str = "",
    name: str = "",
    reasoning: str = "",
    usage: dict[str, int] | None = None,
) -> dict[str, object]:
    chunk: dict[str, object] = {
        "choices": [
            {
                "delta": {
                    "content": content or None,
                    "reasoning_content": reasoning or None,
                    "tool_calls": [
                        {
                            "index": 0,
                            "id": call_id,
                            "type": "function",
                            "function": {
                                "name": name,
                                "arguments": arguments,
                            },
                        }
                    ],
                }
            }
        ]
    }
    if usage is not None:
        chunk["usage"] = usage
    return chunk


def text_chunk(content: str) -> dict[str, object]:
    return {"choices": [{"delta": {"content": content}}]}


@pytest.mark.anyio
async def test_agent_loop_preserves_stream_events_tools_and_context_updates(
    tmp_path: Path,
) -> None:
    requests: list[dict[str, object]] = []
    compacted_conversations: list[list[dict[str, object]]] = []
    recorded_conversations: list[list[dict[str, object]]] = []
    tool_calls: list[tuple[str, dict[str, object]]] = []

    async def completion(**request: object) -> object:
        requests.append(request)

        async def chunks() -> object:
            if len(requests) == 1:
                yield tool_call_delta_chunk(
                    arguments='{"value":',
                    call_id="call-1",
                    content="Working ",
                    name="custom_tool",
                    reasoning="Checking context.",
                    usage={
                        "completion_tokens": 3,
                        "prompt_tokens": 5,
                        "total_tokens": 8,
                    },
                )
                yield tool_call_delta_chunk(arguments="1}", content="now.")
            else:
                yield text_chunk("Finished.")

        return chunks()

    async def tool_runner(
        name: str,
        arguments: dict[str, object],
        context: ToolContext,
    ) -> ToolResult:
        tool_calls.append((name, arguments))
        assert context.emit_event is not None
        await context.emit_event(
            {
                "result": {"type": "text", "text": "Still running."},
                "status": "running",
            }
        )
        return ToolResult(
            result=text_tool_result("Tool output."),
            title="Custom tool finished",
        )

    async def context_compactor(
        conversation: Sequence[Mapping[str, object]],
    ) -> AgentContextUpdate:
        compacted_conversations.append([dict(message) for message in conversation])
        return AgentContextUpdate(
            conversation=[{"role": "system", "content": "Compacted context."}],
            message={
                "author": "system",
                "content": "Context compacted",
                "id": "compact-1",
                "usage_info": {"total_tokens": 6},
            },
        )

    def conversation_recorder(
        conversation: Sequence[Mapping[str, object]],
    ) -> None:
        recorded_conversations.append([dict(message) for message in conversation])

    events = [
        event
        async for event in run_agent_stream(
            completion=completion,
            connection=provider_connection(),
            conversation_recorder=conversation_recorder,
            context_compactor=context_compactor,
            cwd=tmp_path,
            extra_tool_title=lambda name: (
                "Custom tool" if name == "custom_tool" else None
            ),
            messages=[{"role": "user", "content": "Run it."}],
            tool_runner=tool_runner,
        )
    ]

    assert [event.event for event in events] == [
        "start",
        "output_start",
        "usage",
        "thinking_delta",
        "delta",
        "delta",
        "output_done",
        "tool_start",
        "tool_update",
        "tool_done",
        "context_optimized",
        "output_start",
        "delta",
        "output_done",
        "done",
    ]
    assert events[2].data == {
        "usage": {
            "cached_input_tokens": 0,
            "input_tokens": 5,
            "output_tokens": 3,
            "reasoning_output_tokens": 0,
            "total_tokens": 8,
        }
    }
    assert events[3].data == {"content": "Checking context."}
    assert events[4].data == {"content": "Working "}
    assert events[5].data == {"content": "now."}
    assert events[7].data["tool"]["arguments"] == {"value": 1}
    assert events[7].data["tool"]["title"] == "Custom tool"
    tool_id = events[7].data["tool"]["id"]
    assert events[8].data == {
        "id": tool_id,
        "result": {"type": "text", "text": "Still running."},
        "status": "running",
    }
    assert events[9].data == {
        "id": tool_id,
        "result": {"type": "text", "text": "Tool output."},
        "status": "success",
        "title": "Custom tool finished",
    }
    assert events[10].data == {
        "message": {
            "author": "system",
            "content": "Context compacted",
            "id": "compact-1",
        },
        "usage_info": {"total_tokens": 6},
    }
    assert tool_calls == [("custom_tool", {"value": 1})]
    assert compacted_conversations[0][-2] == {
        "role": "assistant",
        "content": "Working now.",
        "tool_calls": [
            {
                "id": "call-1",
                "type": "function",
                "function": {
                    "name": "custom_tool",
                    "arguments": '{"value":1}',
                },
            }
        ],
    }
    assert compacted_conversations[0][-1] == {
        "role": "tool",
        "tool_call_id": "call-1",
        "content": "Tool output.",
    }
    assert requests[1]["messages"] == [
        {"role": "system", "content": "Compacted context."}
    ]
    assert recorded_conversations == [
        [
            {"role": "system", "content": "Compacted context."},
            {"role": "assistant", "content": "Working now.Finished."},
        ]
    ]
    assert events[-1].data == {
        "message": {
            "author": "assistant",
            "content": "Working now.Finished.",
            "id": events[0].data["id"],
            "thinking": "Checking context.",
        }
    }


@pytest.mark.anyio
async def test_agent_loop_reports_invalid_tool_arguments_and_continues(
    tmp_path: Path,
) -> None:
    requests: list[dict[str, object]] = []
    runner_called = False

    async def completion(**request: object) -> object:
        requests.append(request)

        async def chunks() -> object:
            if len(requests) == 1:
                yield tool_call_delta_chunk(
                    arguments="[",
                    call_id="call-invalid",
                    name="custom_tool",
                )
            else:
                yield text_chunk("The tool arguments were invalid.")

        return chunks()

    async def tool_runner(
        name: str,
        arguments: dict[str, object],
        context: ToolContext,
    ) -> ToolResult:
        nonlocal runner_called
        runner_called = True
        return ToolResult(result=text_tool_result("Unexpected"), title="Unexpected")

    events = [
        event
        async for event in run_agent_stream(
            completion=completion,
            connection=provider_connection(),
            cwd=tmp_path,
            messages=[{"role": "user", "content": "Run it."}],
            tool_runner=tool_runner,
        )
    ]

    assert [event.event for event in events] == [
        "start",
        "output_start",
        "output_done",
        "tool_start",
        "tool_error",
        "output_start",
        "delta",
        "output_done",
        "done",
    ]
    assert runner_called is False
    tool_id = events[3].data["tool"]["id"]
    assert events[3].data["tool"]["arguments"] == {}
    assert events[4].data == {
        "id": tool_id,
        "result": {
            "type": "text",
            "text": "Expecting value: line 1 column 2 (char 1)",
        },
        "status": "failed",
        "title": "custom_tool",
    }
    assert requests[1]["messages"][-1] == {
        "role": "tool",
        "tool_call_id": "call-invalid",
        "content": "Expecting value: line 1 column 2 (char 1)",
    }
    assert events[-1].data["message"]["content"] == ("The tool arguments were invalid.")
