from __future__ import annotations

import asyncio
import os
import shlex
import subprocess
import sys
from pathlib import Path

import pytest
from pydantic_ai import Agent, ModelMessage, ModelResponse, TextPart, ToolFailed
from pydantic_ai.models.function import AgentInfo, FunctionModel

from flowent.tools import CommandTools, SpacePaths
from flowent.tools.commands import MAX_OUTPUT_BYTES


def command_tools(tmp_path: Path) -> tuple[CommandTools, Path, Path]:
    workspace = tmp_path / "workspace"
    home = tmp_path / "home"
    workspace.mkdir()
    home.mkdir()
    return CommandTools(SpacePaths(workspace, home)), workspace, home


def python_command(code: str) -> str:
    arguments = [sys.executable, "-c", code]
    return (
        shlex.join(arguments)
        if os.name == "posix"
        else subprocess.list2cmdline(arguments)
    )


def test_command_tool_requires_approval_and_explicit_space(tmp_path: Path) -> None:
    async def run() -> None:
        tools, _, _ = command_tools(tmp_path)
        definition = None

        def inspect_tools(
            messages: list[ModelMessage],
            info: AgentInfo,
        ) -> ModelResponse:
            nonlocal definition
            assert messages
            definition = info.function_tools[0]
            return ModelResponse(parts=[TextPart("Done")])

        result = await Agent(tools=tools.tools).run(
            "Inspect tools",
            model=FunctionModel(inspect_tools),
        )

        assert result.output == "Done"
        assert definition is not None
        assert definition.name == "run_command"
        assert definition.kind == "unapproved"
        assert definition.sequential
        schema = definition.parameters_json_schema
        assert {"space", "command"}.issubset(schema["required"])
        assert schema["properties"]["space"]["enum"] == ["workspace", "home"]

    asyncio.run(run())


def test_command_tool_runs_inside_the_selected_space(tmp_path: Path) -> None:
    async def run() -> None:
        tools, workspace, home = command_tools(tmp_path)
        nested = workspace / "nested"
        nested.mkdir()
        escaped = tmp_path / "outside"
        escaped.mkdir()
        (home / "escape").symlink_to(escaped, target_is_directory=True)

        result = await tools.run_command(
            "workspace",
            python_command(
                "from pathlib import Path; Path('result.txt').write_text('Flowent')"
            ),
            "nested",
        )

        assert result["exit_code"] == 0
        assert result["path"] == "nested"
        assert (nested / "result.txt").read_text(encoding="utf-8") == "Flowent"
        with pytest.raises(ToolFailed, match="escapes"):
            await tools.run_command("home", "echo Flowent", "escape")

    asyncio.run(run())


def test_command_tool_limits_output_and_time(tmp_path: Path) -> None:
    async def run() -> None:
        tools, workspace, _ = command_tools(tmp_path)
        output = await tools.run_command(
            "workspace",
            python_command(
                "import sys; sys.stdout.write('x' * 40000); sys.stderr.write('y' * 40000)"
            ),
        )
        timed_out = await tools.run_command(
            "workspace",
            python_command(
                "import time; from pathlib import Path; time.sleep(2); Path('late.txt').write_text('late')"
            ),
            timeout=1,
        )
        await asyncio.sleep(1.2)

        assert len(output["stdout"].encode()) == MAX_OUTPUT_BYTES
        assert len(output["stderr"].encode()) == MAX_OUTPUT_BYTES
        assert output["stdout_truncated"]
        assert output["stderr_truncated"]
        assert timed_out["timed_out"]
        assert not (workspace / "late.txt").exists()

    asyncio.run(run())
