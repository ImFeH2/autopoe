import pytest

from flowent.sandboxing import SandboxFailureKind
from flowent.tool_catalog import tool_call_title, tool_specs
from flowent.tool_protocol import ToolResult

EXPECTED_TOOL_SPECS = [
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


def test_builtin_tool_specs_match_agent_contract() -> None:
    assert tool_specs() == EXPECTED_TOOL_SPECS


@pytest.mark.parametrize(
    ("name", "arguments", "title"),
    [
        ("read_file", {}, "Reading file"),
        ("read_file", {"path": "notes.txt"}, "Reading notes.txt"),
        ("list_dir", {}, "Listing directory"),
        ("grep_files", {"pattern": "Flowent"}, "Searching Flowent"),
        ("apply_patch", {}, "Editing files"),
        ("shell_command", {"command": "pwd"}, "Running pwd"),
        ("update_plan", {}, "Updating plan"),
        ("web_search", {"query": "current docs"}, "Searching web for current docs"),
        ("custom_tool", {}, "custom_tool"),
    ],
)
def test_builtin_tool_titles_match_agent_contract(
    name: str, arguments: dict[str, object], title: str
) -> None:
    assert tool_call_title(name, arguments) == title


def test_tool_result_serialization_matches_agent_event_contract() -> None:
    result = ToolResult(
        title="Read notes.txt",
        sandbox_failure_kind=SandboxFailureKind.BACKEND_UNAVAILABLE,
    )

    assert result.model_dump() == {
        "result": {},
        "ok": True,
        "title": "Read notes.txt",
    }
    assert result.sandbox_failure_kind == SandboxFailureKind.BACKEND_UNAVAILABLE
