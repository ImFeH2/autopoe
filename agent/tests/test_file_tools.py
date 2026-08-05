from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
from pydantic_ai import Agent, ModelMessage, ModelResponse, TextPart, ToolFailed
from pydantic_ai.models.function import AgentInfo, FunctionModel

from flowent.tools import FileTools, SpacePaths


def file_tools(tmp_path: Path) -> tuple[FileTools, Path, Path]:
    workspace = tmp_path / "workspace"
    home = tmp_path / "home"
    workspace.mkdir()
    home.mkdir()
    return FileTools(SpacePaths(workspace, home)), workspace, home


def test_file_tools_keep_workspace_and_home_isolated(tmp_path: Path) -> None:
    tools, workspace, home = file_tools(tmp_path)
    (workspace / "shared.txt").write_text("workspace", encoding="utf-8")
    (home / "shared.txt").write_text("home", encoding="utf-8")
    outside = tmp_path / "outside.txt"
    outside.write_text("outside", encoding="utf-8")
    (workspace / "escape.txt").symlink_to(outside)

    assert tools.read_file("workspace", "shared.txt")["content"] == "workspace"
    assert tools.read_file("home", "shared.txt")["content"] == "home"
    with pytest.raises(ToolFailed, match="relative"):
        tools.read_file("workspace", str(outside))
    with pytest.raises(ToolFailed, match="escapes"):
        tools.read_file("workspace", "../outside.txt")
    with pytest.raises(ToolFailed, match="escapes"):
        tools.read_file("workspace", "escape.txt")


def test_file_tools_list_and_search_text_files(tmp_path: Path) -> None:
    tools, workspace, _ = file_tools(tmp_path)
    source = workspace / "src"
    generated = workspace / "node_modules"
    source.mkdir()
    generated.mkdir()
    (source / "main.py").write_text("First\nNeedle here\n", encoding="utf-8")
    (generated / "package.js").write_text("needle generated", encoding="utf-8")
    (workspace / "binary.bin").write_bytes(b"needle\0binary")

    listed = tools.list_files("workspace", depth=3)
    paths = [entry["path"] for entry in listed["entries"]]
    found = tools.search_files("workspace", "needle")
    generated_found = tools.search_files("workspace", "needle", "node_modules")

    assert "src/main.py" in paths
    assert "node_modules" in paths
    assert "node_modules/package.js" not in paths
    assert [match["path"] for match in found["matches"]] == ["src/main.py"]
    assert found["matches"][0]["line"] == 2
    assert found["skipped_files"] == 1
    assert generated_found["matches"][0]["path"] == "node_modules/package.js"


def test_file_tools_write_and_replace_utf8_files(tmp_path: Path) -> None:
    tools, _, home = file_tools(tmp_path)

    created = tools.write_file("home", "notes/memory.md", "one one")
    with pytest.raises(ToolFailed, match="already exists"):
        tools.write_file("home", "notes/memory.md", "two")
    with pytest.raises(ToolFailed, match="occurs 2 times"):
        tools.replace_in_file("home", "notes/memory.md", "one", "two")
    replaced = tools.replace_in_file(
        "home",
        "notes/memory.md",
        "one",
        "two",
        replace_all=True,
    )
    overwritten = tools.write_file(
        "home",
        "notes/memory.md",
        "updated",
        overwrite=True,
    )

    assert created == {"path": "notes/memory.md", "bytes": 7, "created": True}
    assert replaced["replacements"] == 2
    assert overwritten["created"] is False
    assert (home / "notes/memory.md").read_text(encoding="utf-8") == "updated"
    assert list((home / "notes").glob("*.tmp")) == []


def test_file_tool_schemas_require_an_explicit_space(tmp_path: Path) -> None:
    async def run() -> None:
        tools, _, _ = file_tools(tmp_path)
        schemas: dict[str, dict[str, object]] = {}

        def inspect_tools(
            messages: list[ModelMessage],
            info: AgentInfo,
        ) -> ModelResponse:
            assert messages
            for tool in info.function_tools:
                schemas[tool.name] = tool.parameters_json_schema
                assert tool.description
            return ModelResponse(parts=[TextPart("Done")])

        result = await Agent(tools=tools.functions).run(
            "Inspect tools",
            model=FunctionModel(inspect_tools),
        )

        assert result.output == "Done"
        assert set(schemas) == set(tools.names)
        for schema in schemas.values():
            assert "space" in schema["required"]
            assert schema["properties"]["space"]["enum"] == ["workspace", "home"]

    asyncio.run(run())
