from __future__ import annotations

import asyncio
import json
import subprocess
import sys
import urllib.parse
import urllib.request
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

from pydantic import BaseModel, ConfigDict

from flowent.patch import affected_paths
from flowent.sandbox import SandboxError, SandboxRunner
from flowent.shell import shell_invocation


class ToolResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content: str
    data: dict[str, object] = {}
    ok: bool = True
    title: str


@dataclass(frozen=True)
class ToolContext:
    cwd: Path
    web_searcher: Callable[[str], Sequence[dict[str, str]]] | None = None


def tool_specs() -> list[dict[str, object]]:
    return [
        {
            "type": "function",
            "function": {
                "name": "read_file",
                "description": "Read text from a file.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string"},
                        "offset": {"type": "integer", "minimum": 0},
                        "limit": {"type": "integer", "minimum": 1},
                    },
                    "required": ["path"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "list_dir",
                "description": "List directory entries.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string"},
                        "limit": {"type": "integer", "minimum": 1},
                    },
                    "required": ["path"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "grep_files",
                "description": "Search file contents.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "pattern": {"type": "string"},
                        "path": {"type": "string"},
                        "include": {"type": "string"},
                        "limit": {"type": "integer", "minimum": 1},
                    },
                    "required": ["pattern"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "apply_patch",
                "description": "Apply a structured patch to files.",
                "parameters": {
                    "type": "object",
                    "properties": {"patch": {"type": "string"}},
                    "required": ["patch"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "shell_command",
                "description": (
                    "Run a shell command. If the command needs to write outside the "
                    "current workspace, set sandbox_permissions to "
                    "with_additional_permissions and list each needed path in "
                    "additional_permissions.file_system.write."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "command": {"type": "string"},
                        "timeout_seconds": {"type": "integer", "minimum": 1},
                        "sandbox_permissions": {
                            "type": "string",
                            "enum": ["with_additional_permissions"],
                        },
                        "additional_permissions": {
                            "type": "object",
                            "properties": {
                                "file_system": {
                                    "type": "object",
                                    "properties": {
                                        "write": {
                                            "type": "array",
                                            "items": {"type": "string"},
                                        }
                                    },
                                }
                            },
                        },
                    },
                    "required": ["command"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "update_plan",
                "description": "Record current task plan items.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "items": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "step": {"type": "string"},
                                    "status": {"type": "string"},
                                },
                                "required": ["step", "status"],
                            },
                        }
                    },
                    "required": ["items"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "web_search",
                "description": "Search the web for current information.",
                "parameters": {
                    "type": "object",
                    "properties": {"query": {"type": "string"}},
                    "required": ["query"],
                },
            },
        },
    ]


def resolve_tool_path(raw_path: str, cwd: Path) -> Path:
    path = Path(raw_path).expanduser()
    if not path.is_absolute():
        path = cwd / path
    return path.resolve(strict=False)


def tool_call_title(name: str, arguments: dict[str, object]) -> str:
    if name == "read_file":
        return f"Reading {arguments.get('path', 'file')}"
    if name == "list_dir":
        return f"Listing {arguments.get('path', 'directory')}"
    if name == "grep_files":
        return f"Searching {arguments.get('pattern', 'files')}"
    if name == "apply_patch":
        return "Editing files"
    if name == "shell_command":
        return f"Running {arguments.get('command', 'command')}"
    if name == "update_plan":
        return "Updating plan"
    if name == "web_search":
        return f"Searching web for {arguments.get('query', '')}"
    return name


def run_tool(
    name: str, arguments: dict[str, object], context: ToolContext
) -> ToolResult:
    try:
        if name == "read_file":
            return read_file(arguments, context)
        if name == "list_dir":
            return list_dir(arguments, context)
        if name == "grep_files":
            return grep_files(arguments, context)
        if name == "apply_patch":
            return apply_patch_tool(arguments, context)
        if name == "shell_command":
            return shell_command(arguments, context)
        if name == "update_plan":
            return update_plan(arguments)
        if name == "web_search":
            return web_search(arguments, context)
        raise ValueError("Tool is not available.")
    except Exception as error:
        title = (
            "Edit failed" if name == "apply_patch" else tool_call_title(name, arguments)
        )
        return ToolResult(content=str(error), ok=False, title=title)


async def run_tool_async(
    name: str, arguments: dict[str, object], context: ToolContext
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
        return ToolResult(content=str(error), ok=False, title=title)


def integer_argument(arguments: dict[str, object], name: str, default: int) -> int:
    value = arguments.get(name, default)
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        return int(value)
    return default


def number_argument(arguments: dict[str, object], name: str, default: float) -> float:
    value = arguments.get(name, default)
    if isinstance(value, int | float):
        return float(value)
    if isinstance(value, str):
        return float(value)
    return default


def read_file(arguments: dict[str, object], context: ToolContext) -> ToolResult:
    path = resolve_tool_path(str(arguments["path"]), context.cwd)
    offset = integer_argument(arguments, "offset", 0)
    limit = integer_argument(arguments, "limit", 200)
    lines = path.read_text(errors="replace").splitlines()
    selected = lines[offset : offset + limit]
    content = "\n".join(selected)
    return ToolResult(content=content, data={"path": str(path)}, title=f"Read {path}")


def list_dir(arguments: dict[str, object], context: ToolContext) -> ToolResult:
    path = resolve_tool_path(str(arguments["path"]), context.cwd)
    limit = integer_argument(arguments, "limit", 200)
    entries = sorted(
        path.iterdir(), key=lambda item: (not item.is_dir(), item.name.lower())
    )
    rendered = [
        f"{entry.name}/" if entry.is_dir() else entry.name for entry in entries[:limit]
    ]
    return ToolResult(
        content="\n".join(rendered), data={"path": str(path)}, title=f"Listed {path}"
    )


def grep_files(arguments: dict[str, object], context: ToolContext) -> ToolResult:
    pattern = str(arguments["pattern"])
    path = resolve_tool_path(str(arguments.get("path", ".") or "."), context.cwd)
    limit = integer_argument(arguments, "limit", 100)
    command = ["rg", "--line-number", "--max-count", str(limit)]
    include = arguments.get("include")
    if include:
        command.extend(["--glob", str(include)])
    command.extend([pattern, str(path)])
    completed = subprocess.run(
        command, check=False, capture_output=True, text=True, timeout=15
    )
    output = completed.stdout or completed.stderr
    return ToolResult(
        content=output[:20000],
        data={"path": str(path), "pattern": pattern},
        title=f"Searched {pattern}",
    )


def apply_patch_tool(arguments: dict[str, object], context: ToolContext) -> ToolResult:
    patch = str(arguments["patch"])
    paths = affected_paths(patch, context.cwd)
    runner = SandboxRunner(cwd=context.cwd)
    for path in paths:
        runner.ensure_writable_path(path)
    result = runner.run(
        [sys.executable, "-m", "flowent.cli", "apply-patch", "--cwd", str(context.cwd)],
        input_text=patch,
    )
    if result.exit_code != 0:
        raise SandboxError(tool_failure_content(result))
    data = json.loads(result.stdout or "{}")
    return ToolResult(
        content=result.stdout,
        data=data if isinstance(data, dict) else {},
        title=patch_title_from_result(data),
    )


async def apply_patch_tool_async(
    arguments: dict[str, object], context: ToolContext
) -> ToolResult:
    patch = str(arguments["patch"])
    paths = affected_paths(patch, context.cwd)
    runner = SandboxRunner(cwd=context.cwd)
    for path in paths:
        runner.ensure_writable_path(path)
    result = await runner.run_async(
        [sys.executable, "-m", "flowent.cli", "apply-patch", "--cwd", str(context.cwd)],
        input_text=patch,
    )
    if result.exit_code != 0:
        raise SandboxError(tool_failure_content(result))
    data = json.loads(result.stdout or "{}")
    return ToolResult(
        content=result.stdout,
        data=data if isinstance(data, dict) else {},
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


def shell_command(arguments: dict[str, object], context: ToolContext) -> ToolResult:
    command = str(arguments["command"])
    timeout_seconds = number_argument(arguments, "timeout_seconds", 30)
    invocation = shell_invocation(command)
    result = SandboxRunner(cwd=context.cwd).run(
        invocation.args, env=invocation.env, timeout_seconds=timeout_seconds
    )
    ok = result.exit_code == 0
    content = result.stdout or result.stderr
    return ToolResult(
        content=content,
        data={
            "command": command,
            "exit_code": result.exit_code,
            "stderr": result.stderr,
            "stdout": result.stdout,
        },
        ok=ok,
        title=f"Ran {command}",
    )


async def shell_command_async(
    arguments: dict[str, object], context: ToolContext
) -> ToolResult:
    command = str(arguments["command"])
    timeout_seconds = number_argument(arguments, "timeout_seconds", 30)
    invocation = shell_invocation(command)
    result = await SandboxRunner(cwd=context.cwd).run_async(
        invocation.args, env=invocation.env, timeout_seconds=timeout_seconds
    )
    ok = result.exit_code == 0
    content = result.stdout or result.stderr
    return ToolResult(
        content=content,
        data={
            "command": command,
            "exit_code": result.exit_code,
            "stderr": result.stderr,
            "stdout": result.stdout,
        },
        ok=ok,
        title=f"Ran {command}",
    )


def update_plan(arguments: dict[str, object]) -> ToolResult:
    items = arguments.get("items", [])
    content = json.dumps(items, ensure_ascii=False)
    return ToolResult(
        content=content,
        data={"items": items if isinstance(items, list) else []},
        title="Updated plan",
    )


def default_web_search(query: str) -> list[dict[str, str]]:
    encoded_query = urllib.parse.urlencode({"q": query})
    request = urllib.request.Request(
        f"https://duckduckgo.com/html/?{encoded_query}",
        headers={"User-Agent": "Flowent/0.1"},
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        body = response.read().decode(errors="replace")
    results: list[dict[str, str]] = []
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


def web_search(arguments: dict[str, object], context: ToolContext) -> ToolResult:
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
        content=content or "No results.",
        data={"query": query, "results": results},
        title=f"Searched web for {query}",
    )


def parse_tool_arguments(arguments: str) -> dict[str, object]:
    if not arguments.strip():
        return {}
    parsed = json.loads(arguments)
    if not isinstance(parsed, dict):
        raise ValueError("Tool arguments must be an object.")
    return parsed


def new_tool_item(
    name: str,
    arguments: dict[str, object],
    title: str | None = None,
) -> dict[str, object]:
    return {
        "id": str(uuid4()),
        "arguments": arguments,
        "name": name,
        "status": "running",
        "title": title or tool_call_title(name, arguments),
    }
