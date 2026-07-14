from __future__ import annotations

import json
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field

ToolArguments = dict[str, object]
ToolEventData = dict[str, object]
ToolPayload = dict[str, object]
WebSearchResult = dict[str, str]


class ToolResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    result: ToolPayload = Field(default_factory=dict)
    ok: bool = True
    title: str


ToolEventEmitter = Callable[[ToolEventData], Awaitable[None]]
WebSearcher = Callable[[str], Sequence[WebSearchResult]]


@dataclass(frozen=True)
class ToolContext:
    cwd: Path
    emit_event: ToolEventEmitter | None = None
    web_searcher: WebSearcher | None = None


def text_tool_result(text: str, **metadata: object) -> ToolPayload:
    return {"type": "text", "text": text, **metadata}


def command_tool_result(
    *,
    command: str,
    exit_code: int,
    output_chunks: list[dict[str, str]] | None = None,
    stderr: str,
    stdout: str,
) -> ToolPayload:
    return {
        "type": "command",
        "command": command,
        "exit_code": exit_code,
        "output_chunks": [dict(item) for item in output_chunks or []],
        "stderr": stderr,
        "stdout": stdout,
        "output": stdout or stderr,
    }


def tool_result_model_content(result: ToolResult | Mapping[str, object]) -> str:
    payload = result.result if isinstance(result, ToolResult) else result
    result_type = payload.get("type")
    if result_type == "command":
        output = str(payload.get("output") or "")
        metadata: dict[str, object] = {}
        if "exit_code" in payload:
            metadata["exit_code"] = payload["exit_code"]
        return json.dumps(
            {"output": output, "metadata": metadata},
            ensure_ascii=False,
        )
    if result_type in {"workflow_read", "workflow_conflict"}:
        return json.dumps(
            {
                "workflow_id": payload["workflow_id"],
                "base_revision": payload["base_revision"],
                "workflow": payload["workflow"],
            },
            ensure_ascii=False,
        )
    if result_type in {"workflow_run", "workflow_run_read", "workflow_schedule"}:
        return json.dumps(
            {key: value for key, value in payload.items() if key != "output"},
            ensure_ascii=False,
        )
    for key in ("text", "output"):
        value = payload.get(key)
        if value is not None:
            return tool_result_content_with_review(str(value), payload)
    return json.dumps(payload, ensure_ascii=False)


def tool_result_content_with_review(content: str, payload: Mapping[str, object]) -> str:
    approval_content = approval_model_content(payload.get("approval"))
    if not approval_content or approval_content in content:
        return content
    return f"{content}\n\n{approval_content}"


def approval_model_content(approval: object) -> str:
    if not isinstance(approval, dict):
        return ""
    lines: list[str] = []
    reason = approval.get("reason")
    if isinstance(reason, str) and reason:
        lines.append(f"Review reason: {reason}")
    risk_level = approval.get("risk_level")
    risk_score = approval.get("risk_score")
    if isinstance(risk_level, str) and isinstance(risk_score, int):
        lines.append(f"Risk: {risk_level} ({risk_score}/100)")
    write_paths = approval.get("write_paths")
    if isinstance(write_paths, list):
        paths = [path for path in write_paths if isinstance(path, str)]
        if paths:
            lines.append("Affected paths:")
            lines.extend(f"- {path}" for path in paths)
    evidence = approval.get("evidence")
    if isinstance(evidence, list):
        evidence_lines = []
        for item in evidence:
            if not isinstance(item, dict):
                continue
            message = item.get("message")
            why = item.get("why")
            if isinstance(message, str) and isinstance(why, str):
                evidence_lines.append(f"- {message}: {why}")
        if evidence_lines:
            lines.append("Evidence:")
            lines.extend(evidence_lines)
    reviewer_output = approval.get("reviewer_output")
    if isinstance(reviewer_output, str) and reviewer_output:
        lines.append("Reviewer output:")
        lines.append(reviewer_output)
    return "\n".join(lines)


def parse_tool_arguments(arguments: str) -> ToolArguments:
    if not arguments.strip():
        return {}
    parsed = json.loads(arguments)
    if not isinstance(parsed, dict):
        raise ValueError("Tool arguments must be an object.")
    return parsed
