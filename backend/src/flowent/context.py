from __future__ import annotations

import os
from pathlib import Path

from flowent.llm import ChatMessage
from flowent.shell import shell_invocation_description
from flowent.tools import tool_specs

DEFAULT_PROJECT_INSTRUCTIONS_MAX_BYTES = 32768
PROJECT_DOC_FILENAME = "AGENTS.md"
PROJECT_DOC_OVERRIDE_FILENAME = "AGENTS.override.md"


def project_instructions_max_bytes() -> int:
    raw_limit = os.environ.get("FLOWENT_PROJECT_INSTRUCTIONS_MAX_BYTES", "")
    try:
        return max(0, int(raw_limit))
    except ValueError:
        return DEFAULT_PROJECT_INSTRUCTIONS_MAX_BYTES


def project_root(cwd: Path) -> Path:
    resolved_cwd = cwd.resolve(strict=False)
    for ancestor in (resolved_cwd, *resolved_cwd.parents):
        if (ancestor / ".git").exists():
            return ancestor
    return resolved_cwd


def project_doc_path(directory: Path) -> Path | None:
    override = directory / PROJECT_DOC_OVERRIDE_FILENAME
    if override.is_file() or override.is_symlink():
        return override
    project_doc = directory / PROJECT_DOC_FILENAME
    if project_doc.is_file() or project_doc.is_symlink():
        return project_doc
    return None


def project_doc_paths(cwd: Path) -> list[Path]:
    root = project_root(cwd)
    resolved_cwd = cwd.resolve(strict=False)
    directories: list[Path] = []
    current = resolved_cwd
    while True:
        directories.append(current)
        if current == root:
            break
        parent = current.parent
        if parent == current:
            break
        current = parent

    return [
        doc_path
        for directory in reversed(directories)
        if (doc_path := project_doc_path(directory)) is not None
    ]


def read_project_instructions(cwd: Path) -> str:
    remaining_bytes = project_instructions_max_bytes()
    if remaining_bytes <= 0:
        return ""

    sections: list[str] = []
    for path in project_doc_paths(cwd):
        if remaining_bytes <= 0:
            break
        try:
            content = path.read_bytes()[:remaining_bytes]
        except OSError:
            continue
        text = content.decode(errors="replace")
        if text.strip():
            sections.append(text)
            remaining_bytes -= len(content)

    return "\n\n".join(sections)


def project_instructions_message(cwd: Path) -> ChatMessage | None:
    instructions = read_project_instructions(cwd)
    if not instructions:
        return None
    return ChatMessage(
        role="user",
        content=(
            f"# AGENTS.md instructions for {cwd.resolve(strict=False)}\n\n"
            f"<INSTRUCTIONS>\n{instructions}\n</INSTRUCTIONS>"
        ),
    )


def tool_names() -> list[str]:
    names: list[str] = []
    for spec in tool_specs():
        function = spec.get("function")
        if isinstance(function, dict) and isinstance(function.get("name"), str):
            names.append(function["name"])
    return names


def environment_context_message(cwd: Path) -> ChatMessage:
    rendered_tools = "\n".join(f"  <tool>{name}</tool>" for name in tool_names())
    return ChatMessage(
        role="user",
        content=(
            "<environment_context>\n"
            f"  <cwd>{cwd.resolve(strict=False)}</cwd>\n"
            f"  <shell>{shell_invocation_description()}</shell>\n"
            "  <filesystem>workspace-write</filesystem>\n"
            "  <network>enabled</network>\n"
            "  <tools>\n"
            f"{rendered_tools}\n"
            "  </tools>\n"
            "</environment_context>"
        ),
    )


def runtime_context_messages(cwd: Path, agent_prompt: str = "") -> list[ChatMessage]:
    messages: list[ChatMessage] = []
    configured_message = configured_agent_prompt_message(agent_prompt)
    if configured_message is not None:
        messages.append(configured_message)
    project_message = project_instructions_message(cwd)
    if project_message is not None:
        messages.append(project_message)
    messages.append(environment_context_message(cwd))
    return messages


def configured_agent_prompt_message(prompt: str) -> ChatMessage | None:
    prompt = prompt.strip()
    if not prompt:
        return None
    return ChatMessage(
        role="system",
        content=(
            "# Flowent configured agent prompt\n\n"
            "These instructions were configured in the Flowent interface. "
            "Apply them before any AGENTS.md project instructions.\n\n"
            f"<INSTRUCTIONS>\n{prompt}\n</INSTRUCTIONS>"
        ),
    )
