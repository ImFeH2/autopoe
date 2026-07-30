import asyncio
import os
import shlex
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4

from pydantic_ai import FunctionToolset, RunContext

from flowent_agent.approval import ApprovalCoordinator, ApprovalScope
from flowent_agent.tools.workspace import Workspace, sanitized_environment

MAX_FILE_BYTES = 512 * 1024
MAX_TOOL_OUTPUT = 64 * 1024
SKIPPED_DIRECTORIES = {
    ".git",
    ".idea",
    ".next",
    ".venv",
    "dist",
    "node_modules",
    "target",
}


@dataclass
class AgentDependencies:
    workspace: Workspace | None
    approvals: ApprovalCoordinator | None
    approval_scope: ApprovalScope
    emit: Any


class CommandPolicy:
    denied_executables = frozenset(
        {
            "bash",
            "cmd",
            "dd",
            "env",
            "fish",
            "kill",
            "mkfs",
            "mount",
            "powershell",
            "pwsh",
            "rm",
            "rmdir",
            "sh",
            "shutdown",
            "su",
            "sudo",
            "xargs",
            "zsh",
        }
    )
    safe_git = frozenset({"diff", "log", "ls-files", "rev-parse", "show", "status"})
    unsafe_git_options = frozenset({"--ext-diff", "--output", "--textconv", "-C", "-c"})

    def classify(self, command: list[str]) -> Literal["allow", "approve", "deny"]:
        if not command or len(command) > 64:
            return "deny"
        if any(not argument or len(argument) > 4096 for argument in command):
            return "deny"
        executable = Path(command[0]).name.lower().removesuffix(".exe")
        if executable in self.denied_executables:
            return "deny"
        if self.has_external_path(command[1:]):
            return "approve"
        if executable == "git" and len(command) > 1:
            if command[1] not in self.safe_git:
                return "approve"
            if any(
                argument in self.unsafe_git_options
                or any(
                    argument.startswith(f"{option}=")
                    for option in self.unsafe_git_options
                )
                for argument in command[2:]
            ):
                return "approve"
            return "allow"
        return "approve"

    @staticmethod
    def has_external_path(arguments: list[str]) -> bool:
        for argument in arguments:
            value = argument
            if argument.startswith("-") and "=" in argument:
                value = argument.split("=", 1)[1]
            elif argument.startswith("-"):
                if "../" in argument or "..\\" in argument:
                    return True
                continue
            value = value.removeprefix("@")
            path = Path(value)
            if path.is_absolute() or ".." in path.parts:
                return True
        return False


class ToolRegistry:
    def __init__(self) -> None:
        self.command_policy = CommandPolicy()
        self.registrations = {
            "read_file": (
                self.read_file,
                "Read a UTF-8 text file inside the workspace with line numbers.",
                False,
            ),
            "list_files": (
                self.list_files,
                "List files inside a workspace directory.",
                False,
            ),
            "search_text": (
                self.search_text,
                "Search text across workspace files and return matching lines.",
                False,
            ),
            "write_file": (
                self.write_file,
                "Create or replace a UTF-8 text file inside the workspace.",
                True,
            ),
            "replace_text": (
                self.replace_text,
                "Replace one exact text occurrence in a workspace file.",
                True,
            ),
            "run_command": (
                self.run_command,
                "Run an argument-vector command inside the workspace under the command policy.",
                True,
            ),
            "git_status": (
                self.git_status,
                "Show concise Git status for the workspace.",
                False,
            ),
            "git_diff": (
                self.git_diff,
                "Show the unstaged or staged Git diff for the workspace.",
                False,
            ),
        }

    def build(self, names: list[str]) -> FunctionToolset[AgentDependencies] | None:
        if not names:
            return None
        unknown = set(names) - set(self.registrations)
        if unknown:
            values = ", ".join(sorted(unknown))
            raise ValueError(f"Unknown Agent tools: {values}")
        toolset = FunctionToolset[AgentDependencies](
            instructions=(
                "All paths are relative to the active workspace. Inspect existing files before "
                "editing them and use argument arrays rather than shell syntax for commands."
            )
        )
        for name in dict.fromkeys(names):
            function, description, sequential = self.registrations[name]
            toolset.add_function(
                function,
                takes_ctx=True,
                name=name,
                description=description,
                sequential=sequential,
            )
        return toolset

    async def read_file(
        self,
        context: RunContext[AgentDependencies],
        path: str,
        start_line: int = 1,
        max_lines: int = 400,
    ) -> str:
        workspace = self.require_workspace(context)
        if start_line < 1 or max_lines < 1 or max_lines > 2000:
            raise ValueError("Invalid line range")
        target = workspace.resolve_path(path)
        if not target.is_file():
            raise ValueError(f"File not found: {path}")
        if target.stat().st_size > MAX_FILE_BYTES:
            raise ValueError("File exceeds the read limit")
        content = await asyncio.to_thread(target.read_text, encoding="utf-8")
        lines = content.splitlines()
        selected = lines[start_line - 1 : start_line - 1 + max_lines]
        return "\n".join(
            f"{index}: {line}" for index, line in enumerate(selected, start=start_line)
        )

    async def list_files(
        self,
        context: RunContext[AgentDependencies],
        path: str = ".",
        max_entries: int = 400,
    ) -> list[str]:
        workspace = self.require_workspace(context)
        if max_entries < 1 or max_entries > 2000:
            raise ValueError("Invalid file limit")
        root = workspace.resolve_path(path)
        if not root.is_dir():
            raise ValueError(f"Directory not found: {path}")
        return await asyncio.to_thread(
            self.walk_files,
            workspace,
            root,
            max_entries,
        )

    async def search_text(
        self,
        context: RunContext[AgentDependencies],
        query: str,
        path: str = ".",
        glob: str | None = None,
        max_results: int = 200,
    ) -> str:
        workspace = self.require_workspace(context)
        if not query or max_results < 1 or max_results > 1000:
            raise ValueError("Invalid search request")
        target = workspace.resolve_path(path)
        if not target.exists():
            raise ValueError(f"Search path not found: {path}")
        if shutil.which("rg") is not None:
            command = [
                "rg",
                "--line-number",
                "--no-heading",
                "--color",
                "never",
                "--max-count",
                str(max_results),
            ]
            if glob:
                command.extend(["--glob", glob])
            command.extend(["--", query, str(target)])
            return await self.capture_command(command, workspace.root, 30, {0, 1})
        return await asyncio.to_thread(
            self.search_files,
            workspace,
            target,
            query,
            glob,
            max_results,
        )

    async def write_file(
        self,
        context: RunContext[AgentDependencies],
        path: str,
        content: str,
    ) -> dict[str, Any]:
        workspace = self.require_workspace(context)
        target = workspace.resolve_path(path)
        encoded = content.encode("utf-8")
        if len(encoded) > MAX_FILE_BYTES:
            raise ValueError("File exceeds the write limit")
        async with workspace.write_lock:
            await asyncio.to_thread(self.write_atomic, target, content)
        return {"path": path, "bytes": len(encoded)}

    async def replace_text(
        self,
        context: RunContext[AgentDependencies],
        path: str,
        old_text: str,
        new_text: str,
    ) -> dict[str, Any]:
        workspace = self.require_workspace(context)
        if not old_text:
            raise ValueError("old_text must not be empty")
        target = workspace.resolve_path(path)
        async with workspace.write_lock:
            if not target.is_file():
                raise ValueError(f"File not found: {path}")
            content = await asyncio.to_thread(target.read_text, encoding="utf-8")
            count = content.count(old_text)
            if count != 1:
                raise ValueError(f"Expected one occurrence, found {count}")
            updated = content.replace(old_text, new_text, 1)
            if len(updated.encode("utf-8")) > MAX_FILE_BYTES:
                raise ValueError("File exceeds the write limit")
            await asyncio.to_thread(self.write_atomic, target, updated)
        return {"path": path, "replacements": 1}

    async def run_command(
        self,
        context: RunContext[AgentDependencies],
        command: list[str],
        cwd: str = ".",
        timeout_seconds: float = 120,
    ) -> dict[str, Any]:
        workspace = self.require_workspace(context)
        if timeout_seconds <= 0 or timeout_seconds > 300:
            raise ValueError("Invalid command timeout")
        directory = workspace.resolve_path(cwd)
        if not directory.is_dir():
            raise ValueError(f"Command directory not found: {cwd}")
        classification = self.command_policy.classify(command)
        if classification == "deny":
            raise PermissionError("Command is denied by policy")
        if classification == "approve":
            approvals = context.deps.approvals
            if approvals is None:
                raise PermissionError("Command requires approval")
            scope = context.deps.approval_scope.model_copy(
                update={"tool_call_id": context.tool_call_id}
            )
            prompt = f"Run command in {cwd}: {shlex.join(command)}"
            decision = await approvals.request(
                scope,
                "command",
                prompt,
                {"command": command, "cwd": cwd},
                context.deps.emit,
            )
            if not decision.approved:
                raise PermissionError("Command approval was rejected")
        async with workspace.write_lock:
            output, exit_code, truncated = await self.execute_command(
                command,
                directory,
                timeout_seconds,
            )
        return {
            "command": command,
            "exit_code": exit_code,
            "output": output,
            "truncated": truncated,
        }

    async def git_status(
        self,
        context: RunContext[AgentDependencies],
    ) -> str:
        return await self.require_workspace(context).git_status()

    async def git_diff(
        self,
        context: RunContext[AgentDependencies],
        staged: bool = False,
    ) -> str:
        return await self.require_workspace(context).git_diff(staged)

    @staticmethod
    def require_workspace(context: RunContext[AgentDependencies]) -> Workspace:
        if context.deps.workspace is None:
            raise ValueError("Agent has no active workspace")
        return context.deps.workspace

    @staticmethod
    def walk_files(
        workspace: Workspace,
        root: Path,
        max_entries: int,
    ) -> list[str]:
        results: list[str] = []
        for current, directories, files in os.walk(root, followlinks=False):
            directories[:] = sorted(
                directory
                for directory in directories
                if directory not in SKIPPED_DIRECTORIES
            )
            for name in sorted(files):
                path = Path(current) / name
                results.append(path.relative_to(workspace.root).as_posix())
                if len(results) >= max_entries:
                    return results
        return results

    @staticmethod
    def search_files(
        workspace: Workspace,
        target: Path,
        query: str,
        glob: str | None,
        max_results: int,
    ) -> str:
        roots = [target] if target.is_file() else None
        paths = roots or [
            workspace.root / path
            for path in ToolRegistry.walk_files(workspace, target, 10000)
        ]
        matches: list[str] = []
        for path in paths:
            if glob and not path.match(glob):
                continue
            try:
                if path.stat().st_size > MAX_FILE_BYTES:
                    continue
                content = path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue
            for line_number, line in enumerate(content.splitlines(), start=1):
                if query in line:
                    relative = path.relative_to(workspace.root).as_posix()
                    matches.append(f"{relative}:{line_number}:{line}")
                    if len(matches) >= max_results:
                        return "\n".join(matches)
        return "\n".join(matches)

    @staticmethod
    def write_atomic(path: Path, content: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
        temporary.write_text(content, encoding="utf-8")
        os.replace(temporary, path)

    async def capture_command(
        self,
        command: list[str],
        cwd: Path,
        timeout_seconds: float,
        accepted_codes: set[int],
    ) -> str:
        output, exit_code, _ = await self.execute_command(
            command,
            cwd,
            timeout_seconds,
        )
        if exit_code not in accepted_codes:
            raise RuntimeError(output or f"Command failed with exit code {exit_code}")
        return output

    @staticmethod
    async def execute_command(
        command: list[str],
        cwd: Path,
        timeout_seconds: float,
    ) -> tuple[str, int, bool]:
        process = await asyncio.create_subprocess_exec(
            *command,
            cwd=cwd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            env=sanitized_environment(),
        )
        try:
            async with asyncio.timeout(timeout_seconds):
                stdout, _ = await process.communicate()
        except TimeoutError:
            process.kill()
            await process.wait()
            raise RuntimeError(
                f"Command timed out after {timeout_seconds:g}s"
            ) from None
        truncated = len(stdout) > MAX_TOOL_OUTPUT
        output = stdout[:MAX_TOOL_OUTPUT].decode(errors="replace")
        if truncated:
            output += "\n… output truncated"
        return output, int(process.returncode or 0), truncated
