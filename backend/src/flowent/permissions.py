from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Literal

from flowent.approval import (
    ApprovalReviewDecision,
    ApprovalReviewer,
    ApprovalReviewRequest,
)
from flowent.patch import affected_paths
from flowent.sandbox import SandboxError, SandboxRunner, path_is_within
from flowent.shell import shell_invocation
from flowent.tools import (
    CommandOutputCollector,
    ToolContext,
    ToolResult,
    command_tool_result,
    number_argument,
    patch_title_from_result,
    run_tool_async,
    text_tool_result,
    tool_failure_content,
    tool_result_model_content,
)

SANDBOX_WITH_ADDITIONAL_PERMISSIONS = "with_additional_permissions"


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
            result=text_tool_result(
                "additional_permissions requires sandbox_permissions to be "
                "with_additional_permissions."
            ),
            ok=False,
            title="Permission request failed",
        )
    return None


def approval_denial_content(
    decision: ApprovalReviewDecision,
    request: ApprovalReviewRequest,
) -> str:
    lines = [
        "Automatic approval review denied this action as high risk.",
        f"Review reason: {decision.reason}",
    ]
    if decision.risk_level is not None and decision.risk_score is not None:
        lines.append(f"Risk: {decision.risk_level} ({decision.risk_score}/100)")
    if request.write_paths:
        lines.append("Affected paths:")
        lines.extend(f"- {path}" for path in request.write_paths)
    if decision.evidence:
        lines.append("Evidence:")
        lines.extend(f"- {item.message}: {item.why}" for item in decision.evidence)
    if decision.reviewer_output:
        lines.append("Reviewer output:")
        lines.append(decision.reviewer_output)
    if request.tool_result:
        lines.append("Tool output:")
        lines.append(request.tool_result)
    lines.append(
        "The agent must not work around this denial; choose a safer alternative "
        "or ask the user for explicit approval after explaining the concrete risk."
    )
    return "\n".join(lines)


def approved_writable_roots(
    context: ToolContext, writable_paths: list[Path]
) -> list[Path]:
    roots = [context.cwd.resolve(strict=False)]
    for path in writable_paths:
        resolved = path.expanduser().resolve(strict=False)
        if not any(resolved == existing for existing in roots):
            roots.append(resolved)
    return roots


async def review_missing_write_paths(
    paths: list[Path],
    context: ToolContext,
    *,
    arguments: dict[str, object],
    action: Literal["additional_permissions", "edit"],
    review_approval: ApprovalReviewer,
    tool_name: str,
    writable_paths: list[Path],
) -> tuple[list[Path], ToolResult | None, dict[str, object] | None]:
    effective_paths = [
        path.expanduser().resolve(strict=False) for path in writable_paths
    ]
    approved_roots = approved_writable_roots(context, effective_paths)
    missing_paths = [
        path.expanduser().resolve(strict=False)
        for path in paths
        if not path_is_within(path, approved_roots)
    ]
    if not missing_paths:
        return effective_paths, None, None
    review_request = ApprovalReviewRequest(
        action=action,
        arguments=arguments,
        cwd=context.cwd,
        tool_name=tool_name,
        write_paths=missing_paths,
    )
    decision = await review_approval(review_request)
    review_data = approval_result_data(review_request, decision)
    if decision.decision == "denied":
        return (
            effective_paths,
            ToolResult(
                result=text_tool_result(
                    approval_denial_content(decision, review_request),
                    **review_data,
                ),
                ok=False,
                title="Denied by reviewer",
            ),
            review_data,
        )
    for approved_path in missing_paths:
        effective_paths.append(approved_path)
        approved_roots.append(approved_path)
    return effective_paths, None, review_data


async def run_tool_with_path_permissions(
    name: str,
    arguments: dict[str, object],
    context: ToolContext,
    *,
    review_approval: ApprovalReviewer,
    writable_paths: list[Path],
) -> ToolResult:
    if name == "shell_command":
        return await run_shell_command_with_permissions(
            arguments,
            context,
            review_approval=review_approval,
            writable_paths=writable_paths,
        )
    if name == "apply_patch":
        return await run_apply_patch_with_permissions(
            arguments,
            context,
            review_approval=review_approval,
            writable_paths=writable_paths,
        )
    return await run_tool_async(name, arguments, context)


async def run_shell_command_with_permissions(
    arguments: dict[str, object],
    context: ToolContext,
    *,
    review_approval: ApprovalReviewer,
    writable_paths: list[Path],
) -> ToolResult:
    validation_error = validate_additional_permissions(arguments)
    if validation_error is not None:
        return validation_error

    declared_paths = additional_write_paths(arguments, context.cwd)
    effective_paths, denied, approval_data = await review_missing_write_paths(
        declared_paths,
        context,
        action="additional_permissions",
        arguments=arguments,
        review_approval=review_approval,
        tool_name="shell_command",
        writable_paths=writable_paths,
    )
    if denied is not None:
        return denied

    result = await shell_command_with_writable_paths(
        arguments, context, effective_paths
    )
    if approval_data is not None:
        result = tool_result_with_fields(result, approval_data)
    if result.ok or not is_likely_sandbox_denied_result(result):
        return result
    review_request = ApprovalReviewRequest(
        action="sandbox_failure",
        arguments=arguments,
        cwd=context.cwd,
        tool_name="shell_command",
        tool_result=tool_failure_text(result),
    )
    decision = await review_approval(review_request)
    review_data = approval_result_data(review_request, decision)
    if decision.decision == "denied":
        return ToolResult(
            result=text_tool_result(
                approval_denial_content(decision, review_request),
                previous_result=result.result,
                **review_data,
            ),
            ok=False,
            title="Denied by reviewer",
        )
    retry_result = await shell_command_without_sandbox(arguments, context)
    return tool_result_with_fields(retry_result, review_data)


async def run_apply_patch_with_permissions(
    arguments: dict[str, object],
    context: ToolContext,
    *,
    review_approval: ApprovalReviewer,
    writable_paths: list[Path],
) -> ToolResult:
    patch = str(arguments["patch"])
    paths = [
        writable_root_for_path(path) for path in affected_paths(patch, context.cwd)
    ]
    effective_paths, denied, approval_data = await review_missing_write_paths(
        paths,
        context,
        action="edit",
        arguments=arguments,
        review_approval=review_approval,
        tool_name="apply_patch",
        writable_paths=writable_paths,
    )
    if denied is not None:
        return denied

    result = await apply_patch_with_writable_paths(arguments, context, effective_paths)
    if approval_data is not None:
        result = tool_result_with_fields(result, approval_data)
    return result


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
        return ToolResult(
            result=text_tool_result(str(error)), ok=False, title="Edit failed"
        )

    if result.exit_code != 0:
        return ToolResult(
            result=text_tool_result(tool_failure_content(result)),
            ok=False,
            title="Edit failed",
        )
    data = json.loads(result.stdout or "{}")
    return ToolResult(
        result={
            "type": "patch",
            "output": result.stdout,
            **(data if isinstance(data, dict) else {}),
        },
        title=patch_title_from_result(data),
    )


async def shell_command_with_writable_paths(
    arguments: dict[str, object],
    context: ToolContext,
    writable_paths: list[Path],
) -> ToolResult:
    command = str(arguments["command"])
    timeout_seconds = number_argument(arguments, "timeout_seconds", 30)
    invocation = shell_invocation(command)
    collector = CommandOutputCollector(command, context.emit_event)
    result = await SandboxRunner(
        cwd=context.cwd,
        writable_roots=writable_paths,
    ).run_async(
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
    )


def is_likely_sandbox_denied_result(result: ToolResult) -> bool:
    payload = result.result
    exit_code = int_result_field(payload.get("exit_code"))
    if exit_code == 0:
        return False
    output = "\n".join(
        str(payload.get(name, "") or "") for name in ["stderr", "stdout", "output"]
    ).lower()
    return any(
        keyword in output
        for keyword in [
            "operation not permitted",
            "permission denied",
            "read-only file system",
            "seccomp",
            "sandbox",
            "landlock",
            "failed to write file",
        ]
    )


def int_result_field(value: object) -> int:
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        try:
            return int(value)
        except ValueError:
            return 0
    return 0


def tool_failure_text(result: ToolResult) -> str:
    payload = result.result
    stderr = str(payload.get("stderr", "") or "").strip()
    stdout = str(payload.get("stdout", "") or "").strip()
    parts: list[str] = []
    for part in [stderr, stdout]:
        if part and part not in parts:
            parts.append(part)
    if not parts:
        content = tool_result_model_content(result).strip()
        if content:
            parts.append(content)
    return "\n".join(parts)


async def shell_command_without_sandbox(
    arguments: dict[str, object],
    context: ToolContext,
) -> ToolResult:
    command = str(arguments["command"])
    timeout_seconds = number_argument(arguments, "timeout_seconds", 30)
    invocation = shell_invocation(command)
    result = await SandboxRunner(cwd=context.cwd).run_unsandboxed_async(
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
    )


def approval_result_data(
    request: ApprovalReviewRequest,
    decision: ApprovalReviewDecision,
) -> dict[str, object]:
    approval: dict[str, object] = {
        "action": request.action,
        "decision": decision.decision,
        "reason": decision.reason,
        "tool_name": request.tool_name,
        "tool_result": request.tool_result,
        "write_paths": [str(path) for path in request.write_paths],
    }
    if decision.risk_level is not None:
        approval["risk_level"] = decision.risk_level
    if decision.risk_score is not None:
        approval["risk_score"] = decision.risk_score
    if decision.evidence:
        approval["evidence"] = [item.model_dump() for item in decision.evidence]
    if decision.reviewer_output:
        approval["reviewer_output"] = decision.reviewer_output
    return {
        "approval": approval,
    }


def tool_result_with_fields(
    result: ToolResult, extra_fields: dict[str, object]
) -> ToolResult:
    return result.model_copy(update={"result": {**result.result, **extra_fields}})
