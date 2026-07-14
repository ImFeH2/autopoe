from __future__ import annotations

from collections.abc import Mapping
from typing import Literal, TypedDict


class ToolFunctionSpec(TypedDict):
    name: str
    description: str
    parameters: dict[str, object]


class ToolSpec(TypedDict):
    type: Literal["function"]
    function: ToolFunctionSpec


def tool_specs() -> list[ToolSpec]:
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


def tool_call_title(name: str, arguments: Mapping[str, object]) -> str:
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
