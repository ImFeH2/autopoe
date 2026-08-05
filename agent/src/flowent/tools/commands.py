from __future__ import annotations

import asyncio
import os
import signal
import subprocess
from typing import Annotated, Any

from pydantic import Field
from pydantic_ai import Tool, ToolFailed

from flowent.tools.space import Space, SpacePaths

Command = Annotated[str, Field(min_length=1, max_length=4096)]
RelativePath = Annotated[str, Field(min_length=1, max_length=1024)]
Timeout = Annotated[int, Field(ge=1, le=600)]

MAX_OUTPUT_BYTES = 32 * 1024


class CommandTools:
    def __init__(self, spaces: SpacePaths):
        self.spaces = spaces
        self.tools = [
            Tool(
                self.run_command,
                requires_approval=True,
                sequential=True,
            )
        ]

    @property
    def names(self) -> list[str]:
        return [tool.name for tool in self.tools]

    async def run_command(
        self,
        space: Space,
        command: Command,
        path: RelativePath = ".",
        timeout: Timeout = 120,
    ) -> dict[str, Any]:
        """Run an approved shell command in a Workspace or Agent Home directory."""
        if not command.strip() or "\0" in command:
            raise ToolFailed("Command is invalid")
        directory = self.spaces.resolve(space, path)
        if not directory.exists():
            raise ToolFailed(f"Path not found: {path}")
        if not directory.is_dir():
            raise ToolFailed(f"Path is not a directory: {path}")

        options: dict[str, Any] = {}
        if os.name == "posix":
            options["start_new_session"] = True
        elif os.name == "nt":
            options["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP

        try:
            process = await asyncio.create_subprocess_shell(
                command,
                cwd=directory,
                stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                **options,
            )
        except OSError as error:
            raise ToolFailed("Could not start command") from error

        assert process.stdout is not None
        assert process.stderr is not None
        stdout_task = asyncio.create_task(self._read(process.stdout))
        stderr_task = asyncio.create_task(self._read(process.stderr))
        timed_out = False
        try:
            await asyncio.wait_for(process.wait(), timeout)
        except TimeoutError:
            timed_out = True
            await self._kill(process)
        except asyncio.CancelledError:
            await self._kill(process)
            await asyncio.gather(stdout_task, stderr_task, return_exceptions=True)
            raise
        stdout, stdout_truncated = await stdout_task
        stderr, stderr_truncated = await stderr_task

        return {
            "space": space,
            "path": self.spaces.display(space, directory),
            "command": command,
            "exit_code": process.returncode,
            "stdout": stdout,
            "stderr": stderr,
            "stdout_truncated": stdout_truncated,
            "stderr_truncated": stderr_truncated,
            "timed_out": timed_out,
        }

    @staticmethod
    async def _read(stream: asyncio.StreamReader) -> tuple[str, bool]:
        output = bytearray()
        truncated = False
        while chunk := await stream.read(8192):
            remaining = MAX_OUTPUT_BYTES - len(output)
            if remaining > 0:
                output.extend(chunk[:remaining])
            if len(chunk) > remaining:
                truncated = True
        return output.decode("utf-8", errors="replace"), truncated

    @staticmethod
    async def _kill(process: asyncio.subprocess.Process) -> None:
        if process.returncode is not None:
            return
        try:
            if os.name == "posix":
                os.killpg(process.pid, signal.SIGKILL)
            elif os.name == "nt":
                killer = await asyncio.create_subprocess_exec(
                    "taskkill",
                    "/PID",
                    str(process.pid),
                    "/T",
                    "/F",
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.DEVNULL,
                )
                await killer.wait()
            else:
                process.kill()
        except OSError:
            if process.returncode is None:
                try:
                    process.kill()
                except ProcessLookupError:
                    pass
        if process.returncode is None and os.name == "nt":
            try:
                process.kill()
            except ProcessLookupError:
                pass
        await process.wait()
