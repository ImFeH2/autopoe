from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from flowent.assistant_commands import (
    ConversationCommandError,
    execute_conversation_command_input,
)
from flowent.image_assets import require_image_asset
from flowent.models import (
    AgentState,
    Message,
    content_parts_to_text,
    has_image_parts,
    parse_content_parts_payload,
)
from flowent.models import TextPart as ModelTextPart
from flowent.providers.errors import LLMProviderError
from flowent.registry import registry

router = APIRouter()


def _get_assistant():
    return registry.get_assistant()


@router.get("/api/assistant")
async def get_assistant() -> dict:
    assistant = _get_assistant()
    if assistant is None:
        raise HTTPException(status_code=404, detail="Assistant not found")
    return {
        "id": assistant.uuid,
        "name": assistant.config.name,
        "role_name": assistant.config.role_name,
        "state": assistant.state.value,
        "connections": assistant.get_connections_snapshot(),
    }


class AssistantMessageRequest(BaseModel):
    content: str | None = None
    parts: list[AssistantMessagePart] | None = None


class AssistantMessagePart(BaseModel):
    type: Literal["text", "image"]
    text: str | None = None
    asset_id: str | None = None
    mime_type: str | None = None
    width: int | None = None
    height: int | None = None
    alt: str | None = None


AssistantMessageRequest.model_rebuild()


class AssistantRetryResponse(BaseModel):
    status: Literal["retried"]
    message_id: str


def _parse_request_parts(req: AssistantMessageRequest):
    if req.parts:
        parts = parse_content_parts_payload(
            [part.model_dump(exclude_none=True) for part in req.parts]
        )
    elif isinstance(req.content, str):
        parts = [ModelTextPart(text=req.content)]
    else:
        parts = []
    if not parts:
        raise HTTPException(status_code=400, detail="Assistant message cannot be empty")
    if not has_image_parts(parts) and not content_parts_to_text(parts).strip():
        raise HTTPException(status_code=400, detail="Assistant message cannot be empty")
    for part in parts:
        asset_id = getattr(part, "asset_id", None)
        if isinstance(asset_id, str):
            require_image_asset(asset_id)
    return parts


@router.post("/api/assistant/message")
async def send_assistant_message(req: AssistantMessageRequest) -> dict:
    assistant = _get_assistant()
    if assistant is None:
        raise HTTPException(status_code=404, detail="Assistant not found")
    if assistant.state == AgentState.TERMINATED:
        raise HTTPException(status_code=409, detail="Assistant is no longer available")

    try:
        parts = _parse_request_parts(req)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if has_image_parts(parts) and not assistant.supports_input_image():
        raise HTTPException(
            status_code=409,
            detail="Assistant current model does not support `input_image`.",
        )

    command_input = (
        parts[0].text
        if len(parts) == 1 and isinstance(parts[0], ModelTextPart)
        else None
    )

    try:
        executed_command = (
            execute_conversation_command_input(assistant, command_input)
            if isinstance(command_input, str)
            else None
        )
    except ConversationCommandError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except (RuntimeError, TimeoutError, LLMProviderError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    if executed_command is not None:
        return {
            "status": "command_executed",
            "command_name": executed_command.command_name,
        }

    message_id = str(uuid.uuid4())
    msg = Message(
        from_id="human",
        to_id=assistant.uuid,
        parts=parts,
        message_id=message_id,
    )
    assistant.enqueue_message(msg)
    return {"status": "sent", "message_id": message_id}


@router.post(
    "/api/assistant/messages/{message_id}/retry",
    response_model=AssistantRetryResponse,
)
async def retry_assistant_message(message_id: str) -> AssistantRetryResponse:
    assistant = _get_assistant()
    if assistant is None:
        raise HTTPException(status_code=404, detail="Assistant not found")

    try:
        retried_message_id = assistant.retry_human_message(message_id=message_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (RuntimeError, TimeoutError, ValueError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    return AssistantRetryResponse(status="retried", message_id=retried_message_id)
