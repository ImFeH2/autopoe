import os
import time
from uuid import UUID

from fastapi.testclient import TestClient

from flowent.models import (
    AgentState,
    AssistantText,
    ImagePart,
    LLMResponse,
    ReceivedMessage,
    TextPart,
)
from flowent.registry import registry
from flowent.routes.nodes import router as nodes_router
from flowent.settings import STEWARD_ROLE_INCLUDED_TOOLS
from flowent.tools import MINIMUM_TOOLS

_ONE_PIXEL_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082"
)


def _get_assistant_id(client: TestClient) -> str:
    response = client.get("/api/assistant")

    assert response.status_code == 200
    assistant_id = response.json()["id"]
    UUID(assistant_id)
    return assistant_id


def test_health_check(client: TestClient):
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "healthy"}


def test_list_agents(client: TestClient):
    response = client.get("/api/nodes")

    assert response.status_code == 200
    data = response.json()
    assert "nodes" in data
    assert isinstance(data["nodes"], list)


def test_get_agent_not_found(client: TestClient):
    response = client.get("/api/nodes/non-existent-id")

    assert response.status_code == 404
    assert "Node not found" in response.json()["detail"]


def test_get_node_detail_includes_runtime_config(client: TestClient):
    assistant_id = _get_assistant_id(client)
    response = client.get(f"/api/nodes/{assistant_id}")

    assert response.status_code == 200
    data = response.json()
    assert data["id"] == assistant_id
    assert isinstance(data["contacts"], list)
    assert isinstance(data["history"], list)
    assert isinstance(data["tools"], list)
    assert isinstance(data["write_dirs"], list)
    assert isinstance(data["allow_network"], bool)
    assert data["workflow_permissions"] == {
        "allow_network": data["allow_network"],
        "write_dirs": data["write_dirs"],
    }


def test_worker_and_leader_are_stable_contacts_without_explicit_edge(
    client: TestClient,
):
    tab = client.post(
        "/api/workflows",
        json={"title": "Execution", "allow_network": True, "write_dirs": ["/tmp"]},
    ).json()
    worker = client.post(
        f"/api/workflows/{tab['id']}/nodes",
        json={"role_name": "Worker", "name": "Worker"},
    ).json()

    detail_without_edge = client.get(f"/api/nodes/{worker['id']}")

    assert detail_without_edge.status_code == 200
    worker_detail = detail_without_edge.json()
    assert worker_detail["contacts"] == [tab["leader_id"]]
    assert worker_detail["allow_network"] is True
    assert worker_detail["write_dirs"] == ["/tmp"]
    assert worker_detail["workflow_permissions"] == {
        "allow_network": True,
        "write_dirs": ["/tmp"],
    }
    leader_without_edge = client.get(f"/api/nodes/{tab['leader_id']}")
    assert leader_without_edge.status_code == 200
    assert worker["id"] in leader_without_edge.json()["contacts"]

    edge_response = client.post(
        f"/api/workflows/{tab['id']}/edges",
        json={
            "from_node_id": tab["leader_id"],
            "to_node_id": worker["id"],
        },
    )

    assert edge_response.status_code == 400
    assert edge_response.json()["detail"] == (
        "Workflow Leader does not participate in Workflow Graph edges"
    )


def test_direct_node_message_api_is_not_available(client: TestClient):
    assert not any(
        getattr(route, "path", None) == "/api/nodes/{node_id}/message"
        for route in nodes_router.routes
    )


def test_only_assistant_node_exists_at_startup(client: TestClient):
    list_response = client.get("/api/nodes")

    assert list_response.status_code == 200
    nodes = list_response.json()["nodes"]
    assert len(nodes) == 1
    UUID(nodes[0]["id"])
    assert nodes[0]["node_type"] == "assistant"
    assert nodes[0]["name"] == "Assistant"
    assert nodes[0]["role_name"] == "Steward"


def test_get_assistant_detail_includes_tools_and_permissions(client: TestClient):
    assistant_id = _get_assistant_id(client)
    response = client.get(f"/api/nodes/{assistant_id}")

    assert response.status_code == 200
    data = response.json()
    assert data["id"] == assistant_id
    assert set(data["tools"]) == set(MINIMUM_TOOLS) | set(STEWARD_ROLE_INCLUDED_TOOLS)
    assert data["write_dirs"] == [os.getcwd()]
    assert data["allow_network"] is True
    assert data["workflow_permissions"] == {
        "allow_network": True,
        "write_dirs": [os.getcwd()],
    }


def test_get_node_detail_includes_state_entries_in_history(client: TestClient):
    assistant_id = _get_assistant_id(client)
    assistant = registry.get(assistant_id)
    assert assistant is not None
    assistant.set_state(AgentState.RUNNING, "processing")

    response = client.get(f"/api/nodes/{assistant_id}")

    assert response.status_code == 200
    history = response.json()["history"]
    assert any(
        entry["type"] == "StateEntry" and entry["state"] == "running"
        for entry in history
    )


def test_assistant_cannot_be_terminated_via_nodes_api(client: TestClient):
    assistant_id = _get_assistant_id(client)
    response = client.post(f"/api/nodes/{assistant_id}/terminate")

    assert response.status_code == 400
    assert response.json() == {"detail": "Cannot terminate assistant"}


def test_tab_leader_cannot_be_terminated_directly(client: TestClient):
    created_tab = client.post(
        "/api/workflows",
        json={"title": "Execution"},
    ).json()

    response = client.post(f"/api/nodes/{created_tab['leader_id']}/terminate")

    assert response.status_code == 400
    assert response.json() == {"detail": "Cannot terminate a workflow Leader directly"}


def test_assistant_retry_is_not_available_via_nodes_api(client: TestClient):
    assistant_id = _get_assistant_id(client)

    response = client.post(f"/api/nodes/{assistant_id}/messages/msg-1/retry")

    assert response.status_code == 400
    assert response.json() == {
        "detail": "Use /api/assistant/messages/{message_id}/retry for Assistant retry"
    }


def test_assistant_can_be_interrupted_via_nodes_api_when_running(client: TestClient):
    assistant_id = _get_assistant_id(client)
    assistant = registry.get(assistant_id)
    assert assistant is not None
    assistant.set_state(AgentState.RUNNING, "processing")

    response = client.post(f"/api/nodes/{assistant_id}/interrupt")

    assert response.status_code == 200
    assert response.json() == {"status": "interrupting"}
    assert assistant._interrupt_requested.is_set()


def test_assistant_can_be_interrupted_via_nodes_api_when_sleeping(client: TestClient):
    assistant_id = _get_assistant_id(client)
    assistant = registry.get(assistant_id)
    assert assistant is not None
    assistant.set_state(AgentState.SLEEPING, "waiting for reply")

    response = client.post(f"/api/nodes/{assistant_id}/interrupt")

    assert response.status_code == 200
    assert response.json() == {"status": "interrupting"}
    assert assistant._interrupt_requested.is_set()


def test_interrupt_ignores_idle_node(client: TestClient):
    assistant_id = _get_assistant_id(client)
    response = client.post(f"/api/nodes/{assistant_id}/interrupt")

    assert response.status_code == 200
    assert response.json() == {"status": "ignored"}


def test_assistant_chat_can_be_cleared_via_nodes_api(client: TestClient):
    assistant_id = _get_assistant_id(client)
    assistant = registry.get(assistant_id)
    assert assistant is not None
    assistant.history.append(ReceivedMessage(content="Old message", from_id="human"))
    assistant.history.append(AssistantText(content="Old reply"))

    response = client.post(f"/api/nodes/{assistant_id}/clear-chat")

    assert response.status_code == 200
    assert response.json() == {"status": "cleared"}

    detail = client.get(f"/api/nodes/{assistant_id}").json()
    assert not any(
        entry["type"] in {"ReceivedMessage", "AssistantText"}
        for entry in detail["history"]
    )


def test_unknown_slash_input_can_be_sent_directly_to_workflow_leader(
    client: TestClient,
):
    tab = client.post(
        "/api/workflows",
        json={"title": "Execution", "allow_network": True},
    ).json()

    response = client.post(
        f"/api/nodes/{tab['leader_id']}/messages",
        json={"content": "/unknown investigate the failure"},
    )

    assert response.status_code == 200
    message_id = response.json()["message_id"]
    assert isinstance(message_id, str)

    history = []
    for _ in range(20):
        detail = client.get(f"/api/nodes/{tab['leader_id']}").json()
        history = detail["history"]
        if any(
            entry["type"] == "ReceivedMessage"
            and entry["from_id"] == "human"
            and entry["message_id"] == message_id
            and entry["content"] == "/unknown investigate the failure"
            for entry in history
        ):
            break
        time.sleep(0.01)

    assert any(
        entry["type"] == "ReceivedMessage"
        and entry["from_id"] == "human"
        and entry["message_id"] == message_id
        and entry["content"] == "/unknown investigate the failure"
        for entry in history
    )


def test_leader_help_command_returns_visible_command_feedback(client: TestClient):
    tab = client.post(
        "/api/workflows",
        json={"title": "Execution"},
    ).json()

    response = client.post(
        f"/api/nodes/{tab['leader_id']}/messages",
        json={"content": "/help"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "status": "command_executed",
        "command_name": "/help",
    }

    detail = client.get(f"/api/nodes/{tab['leader_id']}").json()

    assert any(
        entry["type"] == "CommandResultEntry"
        and entry["command_name"] == "/help"
        and "Available commands" in entry["content"]
        and "/compact" in entry["content"]
        for entry in detail["history"]
    )
    assert not any(
        entry["type"] == "ReceivedMessage" and entry.get("content") == "/help"
        for entry in detail["history"]
    )


def test_leader_clear_command_clears_only_workflow_chat(client: TestClient):
    assistant_id = _get_assistant_id(client)
    assistant = registry.get(assistant_id)
    assert assistant is not None
    assistant.history.append(
        ReceivedMessage(content="Assistant stays", from_id="human")
    )
    tab = client.post(
        "/api/workflows",
        json={"title": "Execution"},
    ).json()
    worker = client.post(
        f"/api/workflows/{tab['id']}/nodes",
        json={"role_name": "Worker", "name": "Worker"},
    ).json()
    leader = registry.get(tab["leader_id"])
    assert leader is not None
    leader.history.append(ReceivedMessage(content="Old workflow chat", from_id="human"))
    leader.history.append(AssistantText(content="Old workflow reply"))

    response = client.post(
        f"/api/nodes/{tab['leader_id']}/messages",
        json={"content": "/clear"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "status": "command_executed",
        "command_name": "/clear",
    }

    leader_detail = client.get(f"/api/nodes/{tab['leader_id']}").json()
    assistant_detail = client.get(f"/api/nodes/{assistant_id}").json()
    workflow = client.get(f"/api/workflows/{tab['id']}").json()

    assert not any(
        entry["type"] in {"ReceivedMessage", "AssistantText"}
        and entry.get("content") in {"Old workflow chat", "Old workflow reply"}
        for entry in leader_detail["history"]
    )
    assert not any(
        entry["type"] == "CommandResultEntry" and entry["command_name"] == "/clear"
        for entry in leader_detail["history"]
    )
    assert any(
        entry["type"] == "ReceivedMessage" and entry.get("content") == "Assistant stays"
        for entry in assistant_detail["history"]
    )
    assert any(node["id"] == worker["id"] for node in workflow["nodes"])


def test_leader_compact_command_keeps_history_and_adds_system_feedback(
    monkeypatch,
    client: TestClient,
):
    tab = client.post(
        "/api/workflows",
        json={"title": "Execution", "allow_network": True},
    ).json()
    leader = registry.get(tab["leader_id"])
    assert leader is not None
    leader.history.extend(
        [
            ReceivedMessage(content="Need a concise recap", from_id="human"),
            AssistantText(content="I will summarize the workflow."),
        ]
    )

    monkeypatch.setattr(
        "flowent.agent.gateway.chat",
        lambda *args, **kwargs: LLMResponse(
            content=(
                "## Current Goal\nShip the shared commands.\n\n"
                "## Active Task Boundary\nKeep it in the workflow chat.\n\n"
                "## Key Constraints\nDo not clear visible history.\n\n"
                "## Confirmed Decisions\nUse shared commands.\n\n"
                "## Open Questions\nNone.\n\n"
                "## Next Actions\nVerify the workflow panel."
            )
        ),
    )

    response = client.post(
        f"/api/nodes/{tab['leader_id']}/messages",
        json={"content": "/compact workflow command rollout"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "status": "command_executed",
        "command_name": "/compact",
    }

    detail = client.get(f"/api/nodes/{tab['leader_id']}").json()

    assert any(
        entry["type"] == "ReceivedMessage"
        and entry.get("content") == "Need a concise recap"
        for entry in detail["history"]
    )
    assert any(
        entry["type"] == "AssistantText"
        and entry.get("content") == "I will summarize the workflow."
        for entry in detail["history"]
    )
    assert any(
        entry["type"] == "CommandResultEntry"
        and entry["command_name"] == "/compact"
        and entry.get("include_in_context") is False
        and "Compacted this chat for future replies." in entry["content"]
        and "Focus: workflow command rollout" in entry["content"]
        for entry in detail["history"]
    )


def test_leader_image_message_bypasses_conversation_commands(
    client: TestClient,
    monkeypatch,
):
    tab = client.post(
        "/api/workflows",
        json={"title": "Execution"},
    ).json()
    leader = registry.get(tab["leader_id"])
    assert leader is not None
    monkeypatch.setattr(leader, "supports_input_image", lambda: True)

    upload_response = client.post(
        "/api/image-assets",
        files={"file": ("pixel.png", _ONE_PIXEL_PNG, "image/png")},
    )
    assert upload_response.status_code == 200
    asset_id = upload_response.json()["id"]

    response = client.post(
        f"/api/nodes/{tab['leader_id']}/messages",
        json={
            "parts": [
                {"type": "text", "text": "/help"},
                {
                    "type": "image",
                    "asset_id": asset_id,
                    "mime_type": "image/png",
                    "width": 1,
                    "height": 1,
                },
            ]
        },
    )

    assert response.status_code == 200
    assert response.json()["status"] == "sent"

    detail = client.get(f"/api/nodes/{tab['leader_id']}").json()

    assert any(
        entry["type"] == "ReceivedMessage"
        and entry["from_id"] == "human"
        and entry["content"] == "/help[image]"
        for entry in detail["history"]
    )
    assert not any(
        entry["type"] == "CommandResultEntry" and entry["command_name"] == "/help"
        for entry in detail["history"]
    )


def test_leader_retry_rewrites_tail_and_reuses_image_parts(monkeypatch, client):
    assistant_id = _get_assistant_id(client)
    tab = client.post(
        "/api/workflows",
        json={"title": "Execution"},
    ).json()
    leader = registry.get(tab["leader_id"])
    assert leader is not None
    queued_messages = []

    upload_response = client.post(
        "/api/image-assets",
        files={"file": ("pixel.png", _ONE_PIXEL_PNG, "image/png")},
    )
    assert upload_response.status_code == 200
    asset_id = upload_response.json()["id"]

    leader.history.extend(
        [
            ReceivedMessage(
                content="Initial brief",
                from_id=assistant_id,
                message_id="brief-1",
            ),
            AssistantText(content="Leader summary"),
            ReceivedMessage(
                from_id="human",
                parts=[
                    TextPart(text="Retry this leader request"),
                    ImagePart(
                        asset_id=asset_id,
                        mime_type="image/png",
                        width=1,
                        height=1,
                    ),
                ],
                message_id="msg-2",
            ),
            AssistantText(content="Discard this leader reply"),
        ]
    )

    monkeypatch.setattr(leader, "supports_input_image", lambda: True)
    monkeypatch.setattr(
        leader,
        "enqueue_message",
        lambda message: queued_messages.append(message),
    )

    response = client.post(f"/api/nodes/{tab['leader_id']}/messages/msg-2/retry")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "retried"
    assert payload["message_id"] != "msg-2"

    detail = client.get(f"/api/nodes/{tab['leader_id']}").json()

    assert any(
        entry["type"] == "ReceivedMessage"
        and entry.get("message_id") == "brief-1"
        and entry.get("from_id") == assistant_id
        for entry in detail["history"]
    )
    assert not any(
        entry["type"] == "ReceivedMessage" and entry.get("message_id") == "msg-2"
        for entry in detail["history"]
    )
    assert not any(
        entry["type"] == "AssistantText"
        and entry.get("content") == "Discard this leader reply"
        for entry in detail["history"]
    )
    assert any(
        entry["type"] == "ReceivedMessage"
        and entry.get("message_id") == payload["message_id"]
        and entry.get("content") == "Retry this leader request[image]"
        for entry in detail["history"]
    )
    assert len(queued_messages) == 1
    assert queued_messages[0].message_id == payload["message_id"]
    assert queued_messages[0].parts[0].text == "Retry this leader request"
    assert queued_messages[0].parts[1].asset_id == asset_id


def test_leader_retry_rejects_non_human_anchor(client: TestClient):
    assistant_id = _get_assistant_id(client)
    tab = client.post(
        "/api/workflows",
        json={"title": "Execution"},
    ).json()
    leader = registry.get(tab["leader_id"])
    assert leader is not None
    leader.history.append(
        ReceivedMessage(
            content="Initial brief",
            from_id=assistant_id,
            message_id="brief-1",
        )
    )

    response = client.post(f"/api/nodes/{tab['leader_id']}/messages/brief-1/retry")

    assert response.status_code == 404
    assert response.json()["detail"] == "Leader human message `brief-1` was not found."


def test_regular_worker_retry_is_not_available_via_nodes_api(client: TestClient):
    tab = client.post(
        "/api/workflows",
        json={"title": "Execution"},
    ).json()
    worker = client.post(
        f"/api/workflows/{tab['id']}/nodes",
        json={"role_name": "Worker", "name": "Worker"},
    ).json()

    response = client.post(f"/api/nodes/{worker['id']}/messages/msg-1/retry")

    assert response.status_code == 400
    assert response.json() == {
        "detail": "Only a Workflow Leader can retry chat history"
    }


def test_human_input_cannot_target_regular_worker(client: TestClient):
    tab = client.post(
        "/api/workflows",
        json={"title": "Execution"},
    ).json()
    worker = client.post(
        f"/api/workflows/{tab['id']}/nodes",
        json={"role_name": "Worker", "name": "Worker"},
    ).json()

    response = client.post(
        f"/api/nodes/{worker['id']}/messages",
        json={"content": "Do the work"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == (
        "Human input can only target Assistant or a Workflow Leader"
    )


def test_browser_cannot_spoof_non_human_sender_for_node_messages(client: TestClient):
    tab = client.post(
        "/api/workflows",
        json={"title": "Execution"},
    ).json()
    worker = client.post(
        f"/api/workflows/{tab['id']}/nodes",
        json={"role_name": "Worker", "name": "Worker"},
    ).json()

    response = client.post(
        f"/api/nodes/{worker['id']}/messages",
        json={"content": "Do the work", "from_id": "assistant"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == (
        "Web UI node messages must originate from `human`"
    )


def test_leader_message_supports_structured_parts_and_image_validation(
    monkeypatch, client: TestClient
):
    tab = client.post(
        "/api/workflows",
        json={"title": "Execution"},
    ).json()
    leader = registry.get(tab["leader_id"])
    assert leader is not None

    upload_response = client.post(
        "/api/image-assets",
        files={"file": ("pixel.png", _ONE_PIXEL_PNG, "image/png")},
    )
    assert upload_response.status_code == 200
    asset_id = upload_response.json()["id"]

    monkeypatch.setattr(leader, "supports_input_image", lambda: True)

    response = client.post(
        f"/api/nodes/{tab['leader_id']}/messages",
        json={
            "parts": [
                {"type": "text", "text": "Inspect this screenshot"},
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
    detail = client.get(f"/api/nodes/{tab['leader_id']}").json()
    entry = next(
        history_entry
        for history_entry in detail["history"]
        if history_entry["type"] == "ReceivedMessage"
        and history_entry["message_id"] == response.json()["message_id"]
    )
    assert entry["parts"][0]["text"] == "Inspect this screenshot"
    assert entry["parts"][1]["asset_id"] == asset_id
