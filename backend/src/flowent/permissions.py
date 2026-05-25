from __future__ import annotations

import json
import sys
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict

from flowent.patch import affected_paths
from flowent.sandbox import SandboxError, SandboxRunner, path_is_within
from flowent.tools import (
    ToolContext,
    ToolResult,
    number_argument,
    patch_title_from_result,
    run_tool_async,
    tool_failure_content,
)

SANDBOX_WITH_ADDITIONAL_PERMISSIONS = "with_additional_permissions"


class WritablePathDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")

    decision: Literal["allow_once", "always_allow", "deny"]
    path: Path


WritablePathRequest = Callable[[Path, str], Awaitable[WritablePathDecision]]


def normalize_path(path: Path | str, cwd: Path) -> Path:
    resolved = Path(path).expanduser()
    if not resolved.is_absolute():
        resolved = cwd / resolved
    return resolved.resolve(strict=False)


def writable_root_for_path(path: Path) -> Path:
    if path.exists() and path.is_dir():
        return path.resolve(strict=False)
    if path.suffix:
        return path.parent.resolve(strict=False)
    return path.resolve(strict=False)


def additional_write_paths(arguments: dict[str, object], cwd: Path) -> list[Path]:
    additional_permissions = arguments.get("additional_permissions")
    if not isinstance(additional_permissions, dict):
        return []
    file_system = additional_permissions.get("file_system")
    if not isinstance(file_system, dict):
        return []
    write_paths = file_system.get("write")
    if not isinstance(write_paths, list):
        return []
    paths: list[Path] = []
    for raw_path in write_paths:
        if not isinstance(raw_path, str) or not raw_path.strip():
            continue
        path = normalize_path(raw_path, cwd)
        paths.append(path.parent.resolve(strict=False) if path.is_file() else path)
    return paths


def validate_additional_permissions(arguments: dict[str, object]) -> ToolResult | None:
    sandbox_permissions = arguments.get("sandbox_permissions")
    has_additional_permissions = arguments.get("additional_permissions") is not None
    if sandbox_permissions is None and not has_additional_permissions:
        return None
    if sandbox_permissions != SANDBOX_WITH_ADDITIONAL_PERMISSIONS:
        return ToolResult(
            content=(
                "additional_permissions requires sandbox_permissions to be "
                "with_additional_permissions."
            ),
            ok=False,
            title="Permission request failed",
        )
    return None


def approved_writable_roots(
    context: ToolContext, writable_paths: list[Path]
) -> list[Path]:
    roots = [context.cwd.resolve(strict=False)]
    for path in writable_paths:
        resolved = path.expanduser().resolve(strict=False)
        if not any(resolved == existing for existing in roots):
            roots.append(resolved)
    return roots


async def request_missing_write_paths(
    paths: list[Path],
    context: ToolContext,
    *,
    request_writable_path: WritablePathRequest,
    writable_paths: list[Path],
    reason: str,
) -> tuple[list[Path], ToolResult | None]:
    effective_paths = [
        path.expanduser().resolve(strict=False) for path in writable_paths
    ]
    approved_roots = approved_writable_roots(context, effective_paths)
    for path in paths:
        if path_is_within(path, approved_roots):
            continue
        decision = await request_writable_path(path, reason)
        if decision.decision == "deny":
            return effective_paths, ToolResult(
                content=f"Permission denied for {decision.path}",
                data={"path": str(decision.path)},
                ok=False,
                title=f"Denied {decision.path}",
            )
        approved_path = decision.path.expanduser().resolve(strict=False)
        effective_paths.append(approved_path)
        approved_roots.append(approved_path)
    return effective_paths, None


async def run_tool_with_path_permissions(
    name: str,
    arguments: dict[str, object],
    context: ToolContext,
    *,
    request_writable_path: WritablePathRequest,
    writable_paths: list[Path],
) -> ToolResult:
    if name == "shell_command":
        return await run_shell_command_with_permissions(
            arguments,
            context,
            request_writable_path=request_writable_path,
            writable_paths=writable_paths,
        )
    if name == "apply_patch":
        return await run_apply_patch_with_permissions(
            arguments,
            context,
            request_writable_path=request_writable_path,
            writable_paths=writable_paths,
        )
    return await run_tool_async(name, arguments, context)


async def run_shell_command_with_permissions(
    arguments: dict[str, object],
    context: ToolContext,
    *,
    request_writable_path: WritablePathRequest,
    writable_paths: list[Path],
) -> ToolResult:
    validation_error = validate_additional_permissions(arguments)
    if validation_error is not None:
        return validation_error

    declared_paths = additional_write_paths(arguments, context.cwd)
    effective_paths, denied = await request_missing_write_paths(
        declared_paths,
        context,
        request_writable_path=request_writable_path,
        writable_paths=writable_paths,
        reason="The shell command needs to write this path.",
    )
    if denied is not None:
        return denied

    return await shell_command_with_writable_paths(arguments, context, effective_paths)


async def run_apply_patch_with_permissions(
    arguments: dict[str, object],
    context: ToolContext,
    *,
    request_writable_path: WritablePathRequest,
    writable_paths: list[Path],
) -> ToolResult:
    patch = str(arguments["patch"])
    paths = [
        writable_root_for_path(path) for path in affected_paths(patch, context.cwd)
    ]
    effective_paths, denied = await request_missing_write_paths(
        paths,
        context,
        request_writable_path=request_writable_path,
        writable_paths=writable_paths,
        reason="The edit needs to write this path.",
    )
    if denied is not None:
        return denied

    return await apply_patch_with_writable_paths(arguments, context, effective_paths)


async def apply_patch_with_writable_paths(
    arguments: dict[str, object],
    context: ToolContext,
    writable_paths: list[Path],
) -> ToolResult:
    patch = str(arguments["patch"])
    runner = SandboxRunner(cwd=context.cwd, writable_roots=writable_paths)
    try:
        result = await runner.run_async(
            [
                sys.executable,
                "-m",
                "flowent.cli",
                "apply-patch",
                "--cwd",
                str(context.cwd),
            ],
            input_text=patch,
        )
    except SandboxError as error:
        return ToolResult(content=str(error), ok=False, title="Edit failed")

    if result.exit_code != 0:
        return ToolResult(
            content=tool_failure_content(result),
            ok=False,
            title="Edit failed",
        )
    data = json.loads(result.stdout or "{}")
    return ToolResult(
        content=result.stdout,
        data=data if isinstance(data, dict) else {},
        title=patch_title_from_result(data),
    )


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
