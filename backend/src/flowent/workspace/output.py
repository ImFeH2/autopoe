from collections.abc import Sequence
from typing import Literal

from flowent.approval import ApprovalTranscriptEntry
from flowent.logging import redact_diagnostic_value
from flowent.storage import (
    StoredAssistantOutputGroup,
    StoredErrorOutputItem,
    StoredMessage,
    StoredTextOutputItem,
    StoredThinkingOutputItem,
    StoredToolItem,
    StoredToolOutputItem,
)

APPROVAL_TRANSCRIPT_MESSAGE_LIMIT = 12
APPROVAL_TRANSCRIPT_TEXT_LIMIT = 2_000
USER_VISIBLE_RUN_ERROR_TITLE = "Request failed"
USER_VISIBLE_RUN_ERROR_MESSAGE = "Check the model connection settings and try again."
USER_VISIBLE_CONTEXT_OPTIMIZATION_ERROR_MESSAGE = "Context could not be optimized."
EMPTY_MODEL_RESPONSE_DETAIL = "The model did not return a response."


def user_visible_run_error_message(detail: str) -> str:
    if detail.strip() == USER_VISIBLE_CONTEXT_OPTIMIZATION_ERROR_MESSAGE:
        return USER_VISIBLE_CONTEXT_OPTIMIZATION_ERROR_MESSAGE
    return USER_VISIBLE_RUN_ERROR_MESSAGE


def run_error_output_item(
    assistant_id: str,
    detail: str,
    index: int = 1,
) -> StoredErrorOutputItem:
    redacted_detail = redact_diagnostic_value(detail.strip())
    message = user_visible_run_error_message(redacted_detail)
    return StoredErrorOutputItem(
        detail="" if redacted_detail == message else redacted_detail,
        id=f"{assistant_id}-error-{index}",
        message=message,
        title=USER_VISIBLE_RUN_ERROR_TITLE,
        type="error",
    )


def run_error_event_data(error: StoredErrorOutputItem) -> dict[str, object]:
    return {
        "error": error.model_dump(exclude_none=True),
        "message": error.message,
    }


def message_error_items(message: StoredMessage) -> list[StoredErrorOutputItem]:
    return [
        item for group in message.groups for item in group.items if item.type == "error"
    ]


def error_context_summary(error: StoredErrorOutputItem) -> str:
    parts = [f"Previous response failed: {error.title}.", error.message]
    if error.detail and error.detail != error.message:
        parts.append(f"Detail: {error.detail}")
    return " ".join(part.strip() for part in parts if part.strip())


def approval_transcript_text(content: str | None) -> str:
    text = (content or "").strip()
    if len(text) <= APPROVAL_TRANSCRIPT_TEXT_LIMIT:
        return text
    return f"{text[:APPROVAL_TRANSCRIPT_TEXT_LIMIT]}\n[truncated]"


def approval_transcript(
    messages: Sequence[StoredMessage],
) -> list[ApprovalTranscriptEntry]:
    entries: list[ApprovalTranscriptEntry] = []
    for message in messages[-APPROVAL_TRANSCRIPT_MESSAGE_LIMIT:]:
        if message.author in ("user", "assistant"):
            role: Literal["user", "assistant"] = (
                "user" if message.author == "user" else "assistant"
            )
            content = approval_transcript_text(message.content)
            if content:
                entries.append(ApprovalTranscriptEntry(role=role, content=content))
            for tool in message.tools:
                tool_content = approval_transcript_text(tool.content)
                if tool_content:
                    entries.append(
                        ApprovalTranscriptEntry(
                            role="tool",
                            content=tool_content,
                            name=tool.name,
                        )
                    )
    return entries


class AssistantOutputBuilder:
    def __init__(self, assistant_id: str = "") -> None:
        self.assistant_id = assistant_id
        self.content = ""
        self.groups: list[StoredAssistantOutputGroup] = []
        self.text_item_index = 0
        self.text_item_id = ""
        self.thinking = ""
        self.thinking_item_index = 0
        self.thinking_item_id = ""
        self.error_item_index = 0
        self.tools: dict[str, StoredToolItem] = {}

    def set_assistant_id(self, assistant_id: str) -> None:
        self.assistant_id = assistant_id

    def start_group(self, index: int) -> None:
        group_id = f"{self.assistant_id or 'assistant'}-group-{index}"
        if self.groups and self.groups[-1].id == group_id:
            return
        self.text_item_id = ""
        self.thinking_item_id = ""
        self.groups.append(StoredAssistantOutputGroup(id=group_id, items=[]))

    def append_text(self, content: str) -> None:
        if not content:
            return
        self._ensure_group()
        if not self.text_item_id:
            self.text_item_index += 1
            self.text_item_id = f"{self.assistant_id}-text-{self.text_item_index}"
            self._append_current_item(
                StoredTextOutputItem(content="", id=self.text_item_id, type="text")
            )
        self.content += content
        self.groups[-1] = self.groups[-1].model_copy(
            update={
                "items": [
                    item.model_copy(update={"content": item.content + content})
                    if item.type == "text" and item.id == self.text_item_id
                    else item
                    for item in self.groups[-1].items
                ]
            }
        )

    def append_thinking(self, content: str) -> None:
        if not content:
            return
        self._ensure_group()
        if not self.thinking_item_id:
            self.thinking_item_index += 1
            self.thinking_item_id = (
                f"{self.assistant_id}-thinking-{self.thinking_item_index}"
            )
            self._append_current_item(
                StoredThinkingOutputItem(
                    content="", id=self.thinking_item_id, type="thinking"
                )
            )
        self.thinking += content
        self.groups[-1] = self.groups[-1].model_copy(
            update={
                "items": [
                    item.model_copy(update={"content": item.content + content})
                    if item.type == "thinking" and item.id == self.thinking_item_id
                    else item
                    for item in self.groups[-1].items
                ]
            }
        )

    def start_tool(self, tool: StoredToolItem) -> None:
        self._ensure_group()
        self.text_item_id = ""
        self.thinking_item_id = ""
        self.tools[tool.id] = tool
        self._append_current_item(
            StoredToolOutputItem(id=f"tool-{tool.id}", tool=tool, type="tool")
        )

    def update_tool(self, tool_id: str, data: dict[str, object]) -> None:
        current_tool = self.tools.get(tool_id)
        if current_tool is None:
            return
        updated_tool = StoredToolItem.model_validate(
            {**current_tool.model_dump(exclude_none=True), **data}
        )
        self.tools[tool_id] = updated_tool
        self.groups = [
            group.model_copy(
                update={
                    "items": [
                        item.model_copy(update={"tool": updated_tool})
                        if item.type == "tool" and item.tool.id == tool_id
                        else item
                        for item in group.items
                    ]
                }
            )
            for group in self.groups
        ]

    def append_error(self, error: StoredErrorOutputItem) -> StoredErrorOutputItem:
        self.error_item_index += 1
        if not error.id:
            error = error.model_copy(
                update={"id": f"{self.assistant_id}-error-{self.error_item_index}"}
            )
        error_group_id = f"{self.assistant_id}-errors"
        if self.groups and self.groups[-1].id == error_group_id:
            self.groups[-1] = self.groups[-1].model_copy(
                update={"items": [*self.groups[-1].items, error]}
            )
        else:
            self.groups.append(
                StoredAssistantOutputGroup(id=error_group_id, items=[error])
            )
        return error

    def has_output(self) -> bool:
        return any(group.items for group in self.groups)

    def apply_done_message(self, message: dict[str, object]) -> None:
        final_content = str(message.get("content") or self.content)
        final_thinking = str(message.get("thinking") or self.thinking)
        self._append_missing_done_text(final_content)
        self._append_missing_done_thinking(final_thinking)
        self.content = final_content
        self.thinking = final_thinking

    def _append_missing_done_text(self, final_content: str) -> None:
        streamed_text = "".join(
            item.content
            for group in self.groups
            for item in group.items
            if item.type == "text"
        )
        if not final_content or streamed_text == final_content:
            return
        missing_text = (
            final_content[len(streamed_text) :]
            if final_content.startswith(streamed_text)
            else final_content
        )
        self.append_text(missing_text)

    def _append_missing_done_thinking(self, final_thinking: str) -> None:
        streamed_thinking = "".join(
            item.content
            for group in self.groups
            for item in group.items
            if item.type == "thinking"
        )
        if not final_thinking or streamed_thinking == final_thinking:
            return
        missing_thinking = (
            final_thinking[len(streamed_thinking) :]
            if final_thinking.startswith(streamed_thinking)
            else final_thinking
        )
        self.append_thinking(missing_thinking)

    def _ensure_group(self) -> None:
        if not self.groups:
            self.start_group(1)

    def _append_current_item(
        self,
        item: StoredTextOutputItem
        | StoredThinkingOutputItem
        | StoredErrorOutputItem
        | StoredToolOutputItem,
    ) -> None:
        self.groups[-1] = self.groups[-1].model_copy(
            update={"items": [*self.groups[-1].items, item]}
        )
