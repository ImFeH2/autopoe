from __future__ import annotations

import asyncio
import json
import subprocess
import urllib.parse
import urllib.request
from collections.abc import Callable
from pathlib import Path

from flowent.network import flowent_user_agent
from flowent.patch import affected_paths
from flowent.runtime_commands import flowent_command
from flowent.sandbox import SandboxError, SandboxRunner
from flowent.shell import shell_invocation
from flowent.system_tools import ensure_ripgrep_available
from flowent.tool_catalog import tool_call_title
from flowent.tool_protocol import (
    ToolArguments,
    ToolContext,
    ToolEventEmitter,
    ToolPayload,
    ToolResult,
    WebSearchResult,
    command_tool_result,
    text_tool_result,
)


class CommandOutputCollector:
    def __init__(
        self, command: str, emit_event: ToolEventEmitter | None = None
    ) -> None:
        self.command = command
        self.emit_event = emit_event
        self.output_chunks: list[dict[str, str]] = []

    @property
    def stdout(self) -> str:
        return "".join(
            item["content"] for item in self.output_chunks if item["stream"] == "stdout"
        )

    @property
    def stderr(self) -> str:
        return "".join(
            item["content"] for item in self.output_chunks if item["stream"] == "stderr"
        )

    def result(self) -> ToolPayload:
        return {
            "type": "command",
            "command": self.command,
            "output_chunks": [dict(item) for item in self.output_chunks],
            "stderr": self.stderr,
            "stdout": self.stdout,
            "output": self.stdout or self.stderr,
        }

    async def append(self, stream: str, content: str) -> None:
        if not content:
            return
        self.output_chunks.append({"stream": stream, "content": content})
        if self.emit_event is not None:
            await self.emit_event({"result": self.result(), "status": "running"})

    async def append_stderr(self, content: str) -> None:
        await self.append("stderr", content)

    async def append_stdout(self, content: str) -> None:
        await self.append("stdout", content)


ToolExecutor = Callable[[ToolArguments, ToolContext], ToolResult]


def resolve_tool_path(raw_path: str, cwd: Path) -> Path:
    path = Path(raw_path).expanduser()
    if not path.is_absolute():
        path = cwd / path
    return path.resolve(strict=False)


def run_tool(name: str, arguments: ToolArguments, context: ToolContext) -> ToolResult:
    try:
        executor = tool_executors().get(name)
        if executor is None:
            raise ValueError("Tool is not available.")
        return executor(arguments, context)
    except Exception as error:
        title = (
            "Edit failed" if name == "apply_patch" else tool_call_title(name, arguments)
        )
        return ToolResult(result=text_tool_result(str(error)), ok=False, title=title)


async def run_tool_async(
    name: str, arguments: ToolArguments, context: ToolContext
) -> ToolResult:
    try:
        if name == "shell_command":
            return await shell_command_async(arguments, context)
        if name == "apply_patch":
            return await apply_patch_tool_async(arguments, context)
        return await asyncio.to_thread(run_tool, name, arguments, context)
    except Exception as error:
        title = (
            "Edit failed" if name == "apply_patch" else tool_call_title(name, arguments)
        )
        return ToolResult(result=text_tool_result(str(error)), ok=False, title=title)


def integer_argument(arguments: ToolArguments, name: str, default: int) -> int:
    value = arguments.get(name, default)
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        return int(value)
    return default


def number_argument(arguments: ToolArguments, name: str, default: float) -> float:
    value = arguments.get(name, default)
    if isinstance(value, int | float):
        return float(value)
    if isinstance(value, str):
        return float(value)
    return default


def read_file(arguments: ToolArguments, context: ToolContext) -> ToolResult:
    path = resolve_tool_path(str(arguments["path"]), context.cwd)
    offset = integer_argument(arguments, "offset", 0)
    limit = integer_argument(arguments, "limit", 200)
    lines = path.read_text(errors="replace").splitlines()
    selected = lines[offset : offset + limit]
    content = "\n".join(selected)
    return ToolResult(
        result=text_tool_result(content, path=str(path)),
        title=f"Read {path}",
    )


def list_dir(arguments: ToolArguments, context: ToolContext) -> ToolResult:
    path = resolve_tool_path(str(arguments["path"]), context.cwd)
    limit = integer_argument(arguments, "limit", 200)
    entries = sorted(
        path.iterdir(), key=lambda item: (not item.is_dir(), item.name.lower())
    )
    rendered = [
        f"{entry.name}/" if entry.is_dir() else entry.name for entry in entries[:limit]
    ]
    return ToolResult(
        result=text_tool_result("\n".join(rendered), path=str(path)),
        title=f"Listed {path}",
    )


def grep_files(arguments: ToolArguments, context: ToolContext) -> ToolResult:
    pattern = str(arguments["pattern"])
    path = resolve_tool_path(str(arguments.get("path", ".") or "."), context.cwd)
    limit = integer_argument(arguments, "limit", 100)
    command = [ensure_ripgrep_available(), "--line-number", "--max-count", str(limit)]
    include = arguments.get("include")
    if include:
        command.extend(["--glob", str(include)])
    command.extend([pattern, str(path)])
    completed = subprocess.run(
        command, check=False, capture_output=True, text=True, timeout=15
    )
    output = completed.stdout or completed.stderr
    return ToolResult(
        result=text_tool_result(output[:20000], path=str(path), pattern=pattern),
        title=f"Searched {pattern}",
    )


def apply_patch_tool(arguments: ToolArguments, context: ToolContext) -> ToolResult:
    patch = str(arguments["patch"])
    paths = affected_paths(patch, context.cwd)
    runner = SandboxRunner(cwd=context.cwd)
    for path in paths:
        runner.ensure_writable_path(path)
    result = runner.run(
        flowent_command("apply-patch", "--cwd", str(context.cwd)),
        input_text=patch,
    )
    if result.exit_code != 0:
        raise SandboxError(tool_failure_content(result))
    data = json.loads(result.stdout or "{}")
    return ToolResult(
        result={
            "type": "patch",
            "output": result.stdout,
            **(data if isinstance(data, dict) else {}),
        },
        title=patch_title_from_result(data),
    )


async def apply_patch_tool_async(
    arguments: ToolArguments, context: ToolContext
) -> ToolResult:
    patch = str(arguments["patch"])
    paths = affected_paths(patch, context.cwd)
    runner = SandboxRunner(cwd=context.cwd)
    for path in paths:
        runner.ensure_writable_path(path)
    result = await runner.run_async(
        flowent_command("apply-patch", "--cwd", str(context.cwd)),
        input_text=patch,
    )
    if result.exit_code != 0:
        raise SandboxError(tool_failure_content(result))
    data = json.loads(result.stdout or "{}")
    return ToolResult(
        result={
            "type": "patch",
            "output": result.stdout,
            **(data if isinstance(data, dict) else {}),
        },
        title=patch_title_from_result(data),
    )


def patch_title_from_result(data: object) -> str:
    if not isinstance(data, dict):
        return "Edited files"
    files = data.get("files")
    if not isinstance(files, list) or not files:
        return "Edited files"
    if len(files) > 1:
        return f"Edited {len(files)} files"
    file_info = files[0]
    if not isinstance(file_info, dict):
        return "Edited files"
    raw_path = file_info.get("path")
    name = Path(str(raw_path)).name if raw_path else "file"
    status = file_info.get("status")
    if status == "added":
        return f"Added {name}"
    if status == "deleted":
        return f"Deleted {name}"
    return f"Edited {name}"


def tool_failure_content(result: object) -> str:
    stdout = str(getattr(result, "stdout", "") or "").strip()
    stderr = str(getattr(result, "stderr", "") or "").strip()
    if stdout:
        try:
            payload = json.loads(stdout)
        except json.JSONDecodeError:
            payload = None
        if isinstance(payload, dict) and isinstance(payload.get("error"), str):
            return payload["error"]
    parts = [part for part in [stderr, stdout] if part]
    return "\n".join(parts) or "Tool failed."


def shell_command(arguments: ToolArguments, context: ToolContext) -> ToolResult:
    command = str(arguments["command"])
    timeout_seconds = number_argument(arguments, "timeout_seconds", 30)
    invocation = shell_invocation(command)
    result = SandboxRunner(cwd=context.cwd).run(
        invocation.args, env=invocation.env, timeout_seconds=timeout_seconds
    )
    ok = result.exit_code == 0
    return ToolResult(
        result=command_tool_result(
            command=command,
            exit_code=result.exit_code,
            stderr=result.stderr,
            stdout=result.stdout,
        ),
        ok=ok,
        title=f"Ran {command}",
        sandbox_failure_kind=(
            result.failure.kind if result.failure is not None else None
        ),
    )


async def shell_command_async(
    arguments: ToolArguments, context: ToolContext
) -> ToolResult:
    command = str(arguments["command"])
    timeout_seconds = number_argument(arguments, "timeout_seconds", 30)
    invocation = shell_invocation(command)
    collector = CommandOutputCollector(command, context.emit_event)
    result = await SandboxRunner(cwd=context.cwd).run_async(
        invocation.args,
        env=invocation.env,
        on_stderr=collector.append_stderr,
        on_stdout=collector.append_stdout,
        timeout_seconds=timeout_seconds,
    )
    ok = result.exit_code == 0
    return ToolResult(
        result=command_tool_result(
            command=command,
            exit_code=result.exit_code,
            output_chunks=collector.output_chunks,
            stderr=result.stderr or collector.stderr,
            stdout=result.stdout or collector.stdout,
        ),
        ok=ok,
        title=f"Ran {command}",
        sandbox_failure_kind=(
            result.failure.kind if result.failure is not None else None
        ),
    )


def update_plan(arguments: ToolArguments, context: ToolContext) -> ToolResult:
    del context
    items = arguments.get("items", [])
    content = json.dumps(items, ensure_ascii=False)
    return ToolResult(
        result={
            "type": "plan",
            "items": items if isinstance(items, list) else [],
            "output": content,
        },
        title="Updated plan",
    )


def default_web_search(query: str) -> list[WebSearchResult]:
    encoded_query = urllib.parse.urlencode({"q": query})
    request = urllib.request.Request(
        f"https://duckduckgo.com/html/?{encoded_query}",
        headers={"User-Agent": flowent_user_agent()},
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        body = response.read().decode(errors="replace")
    results: list[WebSearchResult] = []
    for marker in body.split('class="result__a"')[1:6]:
        href_marker = 'href="'
        href_start = marker.find(href_marker)
        title_start = marker.find(">", href_start)
        title_end = marker.find("</a>", title_start)
        if href_start == -1 or title_start == -1 or title_end == -1:
            continue
        href = marker[
            href_start + len(href_marker) : marker.find(
                '"', href_start + len(href_marker)
            )
        ]
        title = marker[title_start + 1 : title_end]
        results.append({"title": title, "url": href, "snippet": ""})
    return results


def web_search(arguments: ToolArguments, context: ToolContext) -> ToolResult:
    query = str(arguments["query"])
    if context.web_searcher is not None:
        results = list(context.web_searcher(query))
    else:
        results = default_web_search(query)
    content = "\n".join(
        f"{result.get('title', '')}: {result.get('url', '')} {result.get('snippet', '')}"
        for result in results
    )
    return ToolResult(
        result={
            "type": "web_search",
            "output": content or "No results.",
            "query": query,
            "results": results,
        },
        title=f"Searched web for {query}",
    )


def tool_executors() -> dict[str, ToolExecutor]:
    return {
        "read_file": read_file,
        "list_dir": list_dir,
        "grep_files": grep_files,
        "apply_patch": apply_patch_tool,
        "shell_command": shell_command,
        "update_plan": update_plan,
        "web_search": web_search,
    }
