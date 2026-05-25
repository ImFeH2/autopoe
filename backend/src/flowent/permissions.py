from __future__ import annotations

import re
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict

from flowent.sandbox import SandboxRunner
from flowent.tools import ToolContext, ToolResult, number_argument, run_tool_async


class WritablePathDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")

    decision: Literal["allow_once", "always_allow", "deny"]
    path: Path


WritablePathRequest = Callable[[Path, str], Awaitable[WritablePathDecision]]


def extract_blocked_writable_path(output: str) -> Path | None:
    patterns = [
        r"cannot create directory ['\"]?([^'\":\n]+)['\"]?: Read-only file system",
        r"cannot create ['\"]?([^'\":\n]+)['\"]?: Read-only file system",
        r"cannot create ([^:\n]+): Read-only file system",
        r"mkdir ['\"]?([^'\":\n]+)['\"]?: Read-only file system",
        r"open ['\"]?([^'\":\n]+)['\"]?: read-only file system",
        r"EROFS[^'\n]*['\"]([^'\"]+)['\"]",
        r"ENOENT: no such file or directory, mkdir ['\"]([^'\"]+)['\"]",
        r"EROFS: read-only file system, symlink [^'\n]* -> ['\"]([^'\"]+)['\"]",
    ]
    for pattern in patterns:
        match = re.search(pattern, output, re.IGNORECASE)
        if match:
            return writable_root_for_blocked_path(Path(match.group(1).strip()))
    return None


def writable_root_for_blocked_path(path: Path) -> Path:
    if path.suffix:
        return path.parent.expanduser().resolve(strict=False)
    return path.expanduser().resolve(strict=False)


async def run_tool_with_path_permissions(
    name: str,
    arguments: dict[str, object],
    context: ToolContext,
    *,
    request_writable_path: WritablePathRequest,
    writable_paths: list[Path],
) -> ToolResult:
    if name != "shell_command":
        return await run_tool_async(name, arguments, context)

    result = await shell_command_with_writable_paths(arguments, context, writable_paths)
    if result.ok:
        return result

    blocked_path = extract_blocked_writable_path(result.content)
    if blocked_path is None:
        return result

    decision = await request_writable_path(
        blocked_path,
        "The shell command needs to write this path.",
    )
    if decision.decision == "deny":
        return ToolResult(
            content=f"Permission denied for {decision.path}",
            data={"path": str(decision.path)},
            ok=False,
            title=f"Denied {decision.path}",
        )

    retry_paths = [*writable_paths, decision.path]
    return await shell_command_with_writable_paths(arguments, context, retry_paths)


async def shell_command_with_writable_paths(
    arguments: dict[str, object],
    context: ToolContext,
    writable_paths: list[Path],
) -> ToolResult:
    command = str(arguments["command"])
    timeout_seconds = number_argument(arguments, "timeout_seconds", 30)
    result = await SandboxRunner(
        cwd=context.cwd,
        writable_roots=writable_paths,
    ).run_async(["/bin/sh", "-c", command], timeout_seconds=timeout_seconds)
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
