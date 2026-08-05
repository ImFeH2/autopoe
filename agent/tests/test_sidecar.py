from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from queue import Queue
from threading import Thread


def run_sidecar(
    data_dir: Path,
    messages: list[dict[str, object]],
) -> list[dict[str, object]]:
    env = {**os.environ, "FLOWENT_DATA_DIR": str(data_dir)}
    result = subprocess.run(
        [sys.executable, "-m", "flowent"],
        input="".join(f"{json.dumps(message)}\n" for message in messages),
        text=True,
        capture_output=True,
        timeout=10,
        check=True,
        env=env,
    )
    return [json.loads(line) for line in result.stdout.splitlines()]


def test_sidecar_requires_a_configured_model(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    messages = run_sidecar(
        tmp_path,
        [
            {
                "id": "project",
                "method": "project/open",
                "params": {"workspace": str(workspace)},
            },
            {"id": "initial", "method": "state/get"},
            {"method": "chat/send", "params": {"content": "Hello"}},
            {"id": "final", "method": "state/get"},
            {"id": "shutdown", "method": "runtime/shutdown"},
        ],
    )

    assert messages[0]["method"] == "runtime/ready"
    assert messages[0]["params"]["project"] is None
    assert messages[1]["result"]["project"]["workspace"] == str(workspace)
    assert messages[2]["result"]["agent"]["status"] == "idle"
    assert messages[3]["method"] == "turn/started"

    failed = next(
        message for message in messages if message.get("method") == "turn/failed"
    )
    assert failed["params"]["agent"]["status"] == "failed"
    assert failed["params"]["message"]["status"] == "failed"
    assert failed["params"]["turn"]["error"] == "model is not configured"
    assert failed["params"]["turn"]["context"]["tools"] == [
        "list_files",
        "read_file",
        "search_files",
        "write_file",
        "replace_in_file",
        "run_command",
        "list_agents",
        "list_chats",
        "create_chat",
        "read_chat",
        "send_message",
        "mark_processed",
        "list_workers",
        "create_worker",
    ]
    final = next(message for message in messages if message.get("id") == "final")
    assert len(final["result"]["messages"]) == 2
    assert final["result"]["last_turn"]["status"] == "failed"
    project_id = final["result"]["project"]["id"]
    assert (
        tmp_path / "projects" / project_id / "agents/leader/home/AGENTS.md"
    ).is_file()


def test_sidecar_restores_latest_project(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    opened = run_sidecar(
        tmp_path,
        [
            {
                "id": "project",
                "method": "project/open",
                "params": {"workspace": str(workspace)},
            },
            {"id": "shutdown", "method": "runtime/shutdown"},
        ],
    )
    project = opened[1]["result"]["project"]

    restored = run_sidecar(
        tmp_path,
        [
            {"id": "state", "method": "state/get"},
            {"id": "shutdown", "method": "runtime/shutdown"},
        ],
    )

    assert restored[0]["params"]["project"] == project
    assert restored[1]["result"]["project"] == project
    assert restored[1]["result"]["agent"]["home"].startswith(
        str(tmp_path / "projects" / project["id"])
    )
    assert restored[1]["result"]["messages"] == []


def test_sidecar_restores_chat_messages_and_failed_turns(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    run_sidecar(
        tmp_path,
        [
            {
                "id": "project",
                "method": "project/open",
                "params": {"workspace": str(workspace)},
            },
            {"method": "chat/send", "params": {"content": "Hello"}},
            {"id": "shutdown", "method": "runtime/shutdown"},
        ],
    )

    restored = run_sidecar(
        tmp_path,
        [
            {"id": "state", "method": "state/get"},
            {"id": "shutdown", "method": "runtime/shutdown"},
        ],
    )
    state = restored[1]["result"]

    assert restored[0]["params"]["chat"]["title"] == "General"
    assert state["agent"]["status"] == "failed"
    assert state["chat"]["title"] == "General"
    assert [message["content"] for message in state["messages"]] == [
        "Hello",
        "model is not configured",
    ]
    assert state["last_turn"]["status"] == "failed"


def test_sidecar_manages_project_workers(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    messages = run_sidecar(
        tmp_path,
        [
            {
                "id": "project",
                "method": "project/open",
                "params": {"workspace": str(workspace)},
            },
            {
                "id": "create",
                "method": "agents/create",
                "params": {"name": "Backend Engineer", "role": "Backend"},
            },
            {"id": "shutdown", "method": "runtime/shutdown"},
        ],
    )
    created = next(message for message in messages if message.get("id") == "create")[
        "result"
    ]
    worker_id = created["id"]

    updated_messages = run_sidecar(
        tmp_path,
        [
            {
                "id": "update",
                "method": "agents/update",
                "params": {
                    "id": worker_id,
                    "name": "API Engineer",
                    "role": "API",
                },
            },
            {"id": "list", "method": "agents/list"},
            {
                "id": "archive",
                "method": "agents/archive",
                "params": {"id": worker_id},
            },
            {"id": "final", "method": "agents/list"},
            {"id": "shutdown", "method": "runtime/shutdown"},
        ],
    )
    updated = next(
        message for message in updated_messages if message.get("id") == "update"
    )["result"]
    listed = next(
        message for message in updated_messages if message.get("id") == "list"
    )["result"]
    final = next(
        message for message in updated_messages if message.get("id") == "final"
    )["result"]

    assert created["kind"] == "worker"
    assert Path(created["home"]).is_dir()
    assert updated["name"] == "API Engineer"
    assert [agent["id"] for agent in listed] == ["leader", worker_id]
    assert [agent["id"] for agent in final] == ["leader"]


def test_sidecar_manages_project_chats(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    setup = run_sidecar(
        tmp_path,
        [
            {
                "id": "project",
                "method": "project/open",
                "params": {"workspace": str(workspace)},
            },
            {
                "id": "worker",
                "method": "agents/create",
                "params": {"name": "Reviewer", "role": "Review"},
            },
            {"id": "shutdown", "method": "runtime/shutdown"},
        ],
    )
    worker = next(message for message in setup if message.get("id") == "worker")[
        "result"
    ]
    created_messages = run_sidecar(
        tmp_path,
        [
            {
                "id": "create",
                "method": "chats/create",
                "params": {
                    "title": "Review",
                    "purpose": "Code review",
                    "members": ["leader", worker["id"]],
                },
            },
            {"id": "shutdown", "method": "runtime/shutdown"},
        ],
    )
    chat = next(
        message for message in created_messages if message.get("id") == "create"
    )["result"]

    messages = run_sidecar(
        tmp_path,
        [
            {
                "id": "send",
                "method": "chats/send",
                "params": {"id": chat["id"], "content": "Review the change"},
            },
            {
                "id": "messages",
                "method": "chats/messages",
                "params": {"id": chat["id"]},
            },
            {
                "id": "update",
                "method": "chats/update",
                "params": {
                    "id": chat["id"],
                    "title": "Final review",
                    "purpose": "Approval",
                    "members": ["leader"],
                },
            },
            {
                "id": "close",
                "method": "chats/close",
                "params": {"id": chat["id"]},
            },
            {"id": "list", "method": "chats/list"},
            {"id": "shutdown", "method": "runtime/shutdown"},
        ],
    )
    sent = next(message for message in messages if message.get("id") == "send")[
        "result"
    ]
    listed_messages = next(
        message for message in messages if message.get("id") == "messages"
    )["result"]
    updated = next(message for message in messages if message.get("id") == "update")[
        "result"
    ]
    chats = next(message for message in messages if message.get("id") == "list")[
        "result"
    ]

    assert chat["members"] == ["leader", worker["id"]]
    assert sent["author"] == "user"
    assert listed_messages == [sent]
    assert updated["members"] == ["leader"]
    assert [item["kind"] for item in chats] == ["general"]


def test_sidecar_rejects_invalid_workspace(tmp_path: Path) -> None:
    messages = run_sidecar(
        tmp_path,
        [
            {
                "id": "project",
                "method": "project/open",
                "params": {"workspace": str(tmp_path / "missing")},
            },
            {"id": "shutdown", "method": "runtime/shutdown"},
        ],
    )

    assert messages[1]["id"] == "project"
    assert messages[1]["error"]["message"]


def test_sidecar_manages_providers(tmp_path: Path) -> None:
    messages = run_sidecar(
        tmp_path,
        [
            {
                "id": "save",
                "method": "providers/save",
                "params": {
                    "name": "Anthropic",
                    "type": "anthropic",
                    "base_url": "https://api.anthropic.com",
                },
            },
            {"id": "list", "method": "providers/list"},
            {"id": "shutdown", "method": "runtime/shutdown"},
        ],
    )

    provider = next(message for message in messages if message.get("id") == "save")[
        "result"
    ]
    providers = next(message for message in messages if message.get("id") == "list")[
        "result"
    ]

    assert provider["type"] == "anthropic"
    assert providers == [provider]
    assert "api_key" not in provider


def test_sidecar_persists_the_default_model(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    provider_messages = run_sidecar(
        tmp_path,
        [
            {
                "id": "provider",
                "method": "providers/save",
                "params": {
                    "name": "Local",
                    "type": "openai-compatible",
                    "base_url": "http://localhost:11434/v1",
                },
            },
            {"id": "shutdown", "method": "runtime/shutdown"},
        ],
    )
    provider_id = provider_messages[1]["result"]["id"]

    configured = run_sidecar(
        tmp_path,
        [
            {
                "id": "model",
                "method": "model/set",
                "params": {
                    "provider_id": provider_id,
                    "model_id": "local-model",
                },
            },
            {
                "id": "project",
                "method": "project/open",
                "params": {"workspace": str(workspace)},
            },
            {"id": "shutdown", "method": "runtime/shutdown"},
        ],
    )

    assert configured[1]["result"] == {
        "provider_id": provider_id,
        "model_id": "local-model",
    }
    assert configured[2]["result"]["agent"]["model"] == "local-model"

    restored = run_sidecar(
        tmp_path,
        [
            {"id": "state", "method": "state/get"},
            {"id": "model", "method": "model/get"},
            {"id": "shutdown", "method": "runtime/shutdown"},
        ],
    )

    assert restored[1]["result"]["agent"]["model"] == "local-model"
    assert restored[2]["result"]["model_id"] == "local-model"


def test_sidecar_requests_provider_secrets(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    process = subprocess.Popen(
        [sys.executable, "-m", "flowent"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env={**os.environ, "FLOWENT_DATA_DIR": str(tmp_path)},
    )
    messages: Queue[dict[str, object]] = Queue()

    def read_messages() -> None:
        assert process.stdout
        for line in process.stdout:
            messages.put(json.loads(line))

    Thread(target=read_messages, daemon=True).start()

    def send(message: dict[str, object]) -> None:
        assert process.stdin
        process.stdin.write(f"{json.dumps(message)}\n")
        process.stdin.flush()

    try:
        assert messages.get(timeout=5)["method"] == "runtime/ready"
        send(
            {
                "id": "provider",
                "method": "providers/save",
                "params": {
                    "name": "OpenAI",
                    "type": "openai",
                    "base_url": "https://api.openai.com/v1",
                },
            }
        )
        provider_id = messages.get(timeout=5)["result"]["id"]
        send(
            {
                "id": "models",
                "method": "providers/models",
                "params": {"id": provider_id},
            }
        )

        secret_request = messages.get(timeout=5)
        assert secret_request["method"] == "providers/secret"
        assert secret_request["params"] == {"id": provider_id}
        send({"id": secret_request["id"], "result": None})

        response = messages.get(timeout=5)
        assert response["id"] == "models"
        assert response["error"]["message"] == "API key is required"

        send(
            {
                "id": "model",
                "method": "model/set",
                "params": {"provider_id": provider_id, "model_id": "gpt-5.4"},
            }
        )
        assert messages.get(timeout=5)["result"]["model_id"] == "gpt-5.4"
        send(
            {
                "id": "project",
                "method": "project/open",
                "params": {"workspace": str(workspace)},
            }
        )
        assert messages.get(timeout=5)["result"]["agent"]["model"] == "gpt-5.4"
        send({"method": "chat/send", "params": {"content": "Hello"}})
        assert messages.get(timeout=5)["method"] == "turn/started"

        secret_request = messages.get(timeout=5)
        assert secret_request["method"] == "providers/secret"
        send({"id": secret_request["id"], "result": None})
        failed = messages.get(timeout=5)
        assert failed["method"] == "turn/failed"
        assert failed["params"]["turn"]["error"] == "API key is required"

        send({"id": "shutdown", "method": "runtime/shutdown"})
        assert messages.get(timeout=5)["result"] == {"stopping": True}
        assert process.wait(timeout=5) == 0
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=5)
