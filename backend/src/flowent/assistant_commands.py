from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class ConversationCommandDefinition:
    name: str
    description: str
    usage: str
    accepts_argument: bool = False


@dataclass(frozen=True)
class ConversationCommandInvocation:
    name: str
    argument: str = ""


class ConversationCommandError(ValueError):
    pass


@dataclass(frozen=True)
class ExecutedConversationCommand:
    command_name: str
    feedback: str


COMMAND_DEFINITIONS: tuple[ConversationCommandDefinition, ...] = (
    ConversationCommandDefinition(
        name="/clear",
        description="Clear the current chat.",
        usage="/clear",
    ),
    ConversationCommandDefinition(
        name="/compact",
        description="Compress this chat for future replies.",
        usage="/compact [focus]",
        accepts_argument=True,
    ),
    ConversationCommandDefinition(
        name="/help",
        description="Show available commands and usage.",
        usage="/help",
    ),
)

COMMANDS_BY_NAME = {definition.name: definition for definition in COMMAND_DEFINITIONS}


def parse_conversation_command(content: str) -> ConversationCommandInvocation | None:
    stripped = content.lstrip()
    if not stripped.startswith("/"):
        return None

    parts = stripped.split(maxsplit=1)
    token = parts[0] if parts else stripped
    definition = COMMANDS_BY_NAME.get(token)
    if definition is None:
        return None

    argument = parts[1].lstrip() if len(parts) > 1 else ""
    if not definition.accepts_argument and argument.strip():
        raise ConversationCommandError(f"{definition.name} does not accept arguments")

    return ConversationCommandInvocation(
        name=definition.name,
        argument=argument if definition.accepts_argument else "",
    )


def build_conversation_help_text() -> str:
    lines = ["Available commands:", ""]
    for definition in COMMAND_DEFINITIONS:
        lines.extend(
            [
                f"`{definition.name}`",
                definition.description,
                f"Usage: `{definition.usage}`",
                "",
            ]
        )
    return "\n".join(lines).strip()


def execute_conversation_command_input(
    target: Any,
    content: str,
    *,
    interrupt_timeout: float = 5.0,
) -> ExecutedConversationCommand | None:
    invocation = parse_conversation_command(content)
    if invocation is None:
        return None

    entry = target.execute_conversation_command(
        command_name=invocation.name,
        argument=invocation.argument,
        interrupt_timeout=interrupt_timeout,
    )
    return ExecutedConversationCommand(
        command_name=entry.command_name,
        feedback=entry.content,
    )


AssistantCommandDefinition = ConversationCommandDefinition
AssistantCommandInvocation = ConversationCommandInvocation
AssistantCommandError = ConversationCommandError
ExecutedAssistantCommand = ExecutedConversationCommand
parse_assistant_command = parse_conversation_command
build_assistant_help_text = build_conversation_help_text
execute_assistant_command_input = execute_conversation_command_input
