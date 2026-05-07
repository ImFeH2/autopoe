import base64
from uuid import UUID

from flowent.models import (
    AssistantText,
    ImagePart,
    LLMResponse,
    ReceivedMessage,
    TextPart,
)
from flowent.registry import registry

_ONE_PIXEL_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII="
)


def _get_assistant_id(client) -> str:
    response = client.get("/api/assistant")

    assert response.status_code == 200
    assistant_id = response.json()["id"]
    UUID(assistant_id)
    return assistant_id


def test_help_command_returns_visible_command_feedback(client):
    assistant_id = _get_assistant_id(client)

    response = client.post("/api/assistant/message", json={"content": "/help"})

    assert response.status_code == 200
    assert response.json() == {
        "status": "command_executed",
        "command_name": "/help",
    }

    detail = client.get(f"/api/nodes/{assistant_id}").json()

    assert any(
        entry["type"] == "CommandResultEntry"
        and entry["command_name"] == "/help"
        and "/compact" in entry["content"]
        for entry in detail["history"]
    )
    assert not any(
        entry["type"] == "ReceivedMessage" and entry.get("content") == "/help"
        for entry in detail["history"]
    )


def test_clear_command_clears_history_back_to_empty_state(client):
    assistant_id = _get_assistant_id(client)
    assistant = registry.get(assistant_id)
    assert assistant is not None
    assistant.history.append(ReceivedMessage(content="Old message", from_id="human"))
    assistant.history.append(AssistantText(content="Old reply"))

    response = client.post("/api/assistant/message", json={"content": "/clear"})

    assert response.status_code == 200
    assert response.json() == {
        "status": "command_executed",
        "command_name": "/clear",
    }

    detail = client.get(f"/api/nodes/{assistant_id}").json()

    assert not any(
        entry["type"] in {"ReceivedMessage", "AssistantText"}
        and entry.get("content") in {"Old message", "Old reply"}
        for entry in detail["history"]
    )
    assert not any(
        entry["type"] == "CommandResultEntry" and entry["command_name"] == "/clear"
        for entry in detail["history"]
    )


def test_compact_command_replaces_history_with_summary(monkeypatch, client):
    assistant_id = _get_assistant_id(client)
    assistant = registry.get(assistant_id)
    assert assistant is not None
    assistant.history.extend(
        [
            ReceivedMessage(content="Need a concise recap", from_id="human"),
            AssistantText(content="I will summarize the open work."),
        ]
    )

    monkeypatch.setattr(
        "flowent.agent.gateway.chat",
        lambda *args, **kwargs: LLMResponse(
            content=(
                "## Current Goal\nShip the slash commands.\n\n"
                "## Active Task Boundary\nKeep the fix limited to Assistant chat.\n\n"
                "## Key Constraints\nDo not lose persisted context.\n\n"
                "## Confirmed Decisions\nUse built-in commands only.\n\n"
                "## Open Questions\nNone.\n\n"
                "## Next Actions\nWire the UI and tests."
            )
        ),
    )

    response = client.post(
        "/api/assistant/message",
        json={"content": "/compact slash command rollout"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "status": "command_executed",
        "command_name": "/compact",
    }

    detail = client.get(f"/api/nodes/{assistant_id}").json()

    assert any(
        entry["type"] == "ReceivedMessage"
        and entry.get("content") == "Need a concise recap"
        for entry in detail["history"]
    )
    assert any(
        entry["type"] == "AssistantText"
        and entry.get("content") == "I will summarize the open work."
        for entry in detail["history"]
    )
    assert any(
        entry["type"] == "CommandResultEntry"
        and entry["command_name"] == "/compact"
        and entry.get("include_in_context") is False
        and "Compacted this chat for future replies." in entry["content"]
        and "Focus: slash command rollout" in entry["content"]
        and "Ship the slash commands." not in entry["content"]
        for entry in detail["history"]
    )


def test_retry_message_rewrites_tail_and_reuses_image_parts(monkeypatch, client):
    assistant_id = _get_assistant_id(client)
    assistant = registry.get(assistant_id)
    assert assistant is not None
    queued_messages = []

    upload_response = client.post(
        "/api/image-assets",
        files={"file": ("pixel.png", _ONE_PIXEL_PNG, "image/png")},
    )
    assert upload_response.status_code == 200
    asset_id = upload_response.json()["id"]

    assistant.history.extend(
        [
            ReceivedMessage(
                content="Keep this turn",
                from_id="human",
                message_id="msg-1",
            ),
            AssistantText(content="Keep this reply"),
            ReceivedMessage(
                from_id="human",
                parts=[
                    TextPart(text="Retry this image request"),
                    ImagePart(
                        asset_id=asset_id,
                        mime_type="image/png",
                        width=1,
                        height=1,
                    ),
                ],
                message_id="msg-2",
            ),
            AssistantText(content="Discard this reply"),
        ]
    )

    monkeypatch.setattr(assistant, "supports_input_image", lambda: True)
    monkeypatch.setattr(
        assistant,
        "enqueue_message",
        lambda message: queued_messages.append(message),
    )

    response = client.post("/api/assistant/messages/msg-2/retry")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "retried"
    assert payload["message_id"] != "msg-2"

    detail = client.get(f"/api/nodes/{assistant_id}").json()

    assert any(
        entry["type"] == "ReceivedMessage"
        and entry.get("message_id") == "msg-1"
        and entry.get("content") == "Keep this turn"
        for entry in detail["history"]
    )
    assert not any(
        entry["type"] == "ReceivedMessage" and entry.get("message_id") == "msg-2"
        for entry in detail["history"]
    )
    assert not any(
        entry["type"] == "AssistantText"
        and entry.get("content") == "Discard this reply"
        for entry in detail["history"]
    )
    assert any(
        entry["type"] == "ReceivedMessage"
        and entry.get("message_id") == payload["message_id"]
        and entry.get("content") == "Retry this image request[image]"
        for entry in detail["history"]
    )
    assert len(queued_messages) == 1
    assert queued_messages[0].message_id == payload["message_id"]
    assert queued_messages[0].parts[0].text == "Retry this image request"
    assert queued_messages[0].parts[1].asset_id == asset_id


def test_retry_message_returns_404_for_missing_anchor(client):
    response = client.post("/api/assistant/messages/missing/retry")

    assert response.status_code == 404
    assert "was not found" in response.json()["detail"]


def test_retry_message_returns_409_when_image_input_is_unsupported(monkeypatch, client):
    assistant_id = _get_assistant_id(client)
    assistant = registry.get(assistant_id)
    assert assistant is not None

    upload_response = client.post(
        "/api/image-assets",
        files={"file": ("pixel.png", _ONE_PIXEL_PNG, "image/png")},
    )
    assert upload_response.status_code == 200
    asset_id = upload_response.json()["id"]

    assistant.history.append(
        ReceivedMessage(
            from_id="human",
            parts=[
                ImagePart(asset_id=asset_id, mime_type="image/png", width=1, height=1)
            ],
            message_id="msg-image",
        )
    )
    monkeypatch.setattr(assistant, "supports_input_image", lambda: False)

    response = client.post("/api/assistant/messages/msg-image/retry")

    assert response.status_code == 409
    assert response.json()["detail"] == (
        "Assistant current model does not support `input_image`."
    )


def test_upload_image_asset_returns_metadata_and_serves_bytes(client):
    response = client.post(
        "/api/image-assets",
        files={"file": ("pixel.png", _ONE_PIXEL_PNG, "image/png")},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["mime_type"] == "image/png"
    assert payload["width"] == 1
    assert payload["height"] == 1

    image_response = client.get(f"/api/image-assets/{payload['id']}")

    assert image_response.status_code == 200
    assert image_response.headers["content-type"].startswith("image/png")
    assert image_response.content == _ONE_PIXEL_PNG


def test_image_message_bypasses_assistant_commands(monkeypatch, client):
    assistant_id = _get_assistant_id(client)
    assistant = registry.get(assistant_id)
    assert assistant is not None
    queued_messages = []

    upload_response = client.post(
        "/api/image-assets",
        files={"file": ("pixel.png", _ONE_PIXEL_PNG, "image/png")},
    )
    assert upload_response.status_code == 200
    asset_id = upload_response.json()["id"]

    monkeypatch.setattr(assistant, "supports_input_image", lambda: True)
    monkeypatch.setattr(
        assistant, "enqueue_message", lambda message: queued_messages.append(message)
    )

    response = client.post(
        "/api/assistant/message",
        json={
            "parts": [
                {"type": "text", "text": "/help"},
                {
                    "type": "image",
                    "asset_id": asset_id,
                    "mime_type": "image/png",
                    "width": 1,
                    "height": 1,
                    "alt": "Pixel",
                },
            ]
        },
    )

    assert response.status_code == 200
    assert response.json()["status"] == "sent"
    assert len(queued_messages) == 1
    assert queued_messages[0].parts[0].text == "/help"
    assert queued_messages[0].parts[1].asset_id == asset_id


def test_image_message_is_rejected_when_assistant_lacks_input_image_support(
    monkeypatch, client
):
    assistant_id = _get_assistant_id(client)
    assistant = registry.get(assistant_id)
    assert assistant is not None

    upload_response = client.post(
        "/api/image-assets",
        files={"file": ("pixel.png", _ONE_PIXEL_PNG, "image/png")},
    )
    assert upload_response.status_code == 200
    asset_id = upload_response.json()["id"]

    monkeypatch.setattr(assistant, "supports_input_image", lambda: False)

    response = client.post(
        "/api/assistant/message",
        json={
            "parts": [
                {
                    "type": "image",
                    "asset_id": asset_id,
                    "mime_type": "image/png",
                    "width": 1,
                    "height": 1,
                }
            ]
        },
    )

    assert response.status_code == 409
    assert (
        response.json()["detail"]
        == "Assistant current model does not support `input_image`."
    )
