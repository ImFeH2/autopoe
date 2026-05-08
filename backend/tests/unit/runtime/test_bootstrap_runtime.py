import json
from uuid import UUID

import pytest

import flowent.settings as settings_module
from flowent.agent import Agent
from flowent.models import AgentState, AssistantText, ReceivedMessage
from flowent.registry import registry
from flowent.runtime import bootstrap_runtime, shutdown_runtime
from flowent.settings import (
    CONDUCTOR_ROLE_DESCRIPTION,
    CONDUCTOR_ROLE_INCLUDED_TOOLS,
    CONDUCTOR_ROLE_NAME,
    CONDUCTOR_ROLE_SYSTEM_PROMPT,
    DESIGNER_ROLE_DESCRIPTION,
    DESIGNER_ROLE_INCLUDED_TOOLS,
    DESIGNER_ROLE_NAME,
    DESIGNER_ROLE_SYSTEM_PROMPT,
    STEWARD_ROLE_DESCRIPTION,
    STEWARD_ROLE_INCLUDED_TOOLS,
    STEWARD_ROLE_NAME,
    STEWARD_ROLE_SYSTEM_PROMPT,
    WORKER_ROLE_DESCRIPTION,
    WORKER_ROLE_INCLUDED_TOOLS,
    WORKER_ROLE_NAME,
    WORKER_ROLE_SYSTEM_PROMPT,
    RoleConfig,
    build_default_assistant_write_dirs,
)
from flowent.tools import MINIMUM_TOOLS
from flowent.workspace_store import workspace_store


def test_bootstrap_runtime_creates_only_assistant(
    monkeypatch,
    tmp_path,
):
    registry.reset()
    settings_file = tmp_path / "settings.json"
    settings_file.write_text(
        json.dumps(
            {
                "event_log": {"timestamp_format": "absolute"},
                "model": {"active_provider_id": "", "active_model": ""},
                "providers": [],
                "roles": [],
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(Agent, "start", lambda self: None)
    monkeypatch.setattr(settings_module, "_SETTINGS_FILE", settings_file)
    monkeypatch.setattr(settings_module, "_cached_settings", None)

    bootstrap_runtime()

    try:
        nodes = registry.get_all()
        assistant = registry.get_assistant()

        assert len(nodes) == 1
        assert assistant is not None
        assert str(UUID(assistant.uuid)) == assistant.uuid
        assert assistant.config.node_type.value == "assistant"
        assert assistant.config.name == "Assistant"
        assert assistant.config.role_name == STEWARD_ROLE_NAME
        assert set(MINIMUM_TOOLS).issubset(set(assistant.config.tools))
        assert set(STEWARD_ROLE_INCLUDED_TOOLS).issubset(set(assistant.config.tools))
        assert assistant.config.write_dirs == build_default_assistant_write_dirs()
        assert assistant.config.allow_network is True
    finally:
        registry.reset()


def test_bootstrap_runtime_restores_assistant_history(monkeypatch, tmp_path):
    settings_file = tmp_path / "settings.json"
    workspace_file = tmp_path / "workspace.json"
    assistant_id = "00000000-0000-0000-0000-000000000001"
    settings_file.write_text(
        json.dumps(
            {
                "event_log": {"timestamp_format": "absolute"},
                "model": {"active_provider_id": "", "active_model": ""},
                "providers": [],
                "roles": [],
            }
        ),
        encoding="utf-8",
    )
    workspace_file.write_text(
        json.dumps(
            {
                "tabs": [],
                "nodes": [
                    {
                        "id": assistant_id,
                        "config": {
                            "node_type": "assistant",
                            "role_name": "Steward",
                            "tab_id": None,
                            "name": "Assistant",
                            "tools": [],
                            "write_dirs": [str(tmp_path)],
                            "allow_network": True,
                        },
                        "state": "idle",
                        "todos": [],
                        "history": [
                            {
                                "type": "ReceivedMessage",
                                "content": "hello",
                                "from_id": "human",
                                "timestamp": 1,
                            },
                            {
                                "type": "AssistantText",
                                "content": "hi there",
                                "timestamp": 2,
                            },
                        ],
                        "position": None,
                        "created_at": 1,
                        "updated_at": 1,
                    }
                ],
                "edges": [],
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(Agent, "start", lambda self: None)
    monkeypatch.setattr(settings_module, "_SETTINGS_FILE", settings_file)
    monkeypatch.setattr(settings_module, "_cached_settings", None)

    bootstrap_runtime()

    try:
        assistant = registry.get_assistant()
        assert assistant is not None
        assert assistant.uuid == assistant_id
        assert assistant.state == AgentState.IDLE
        assert any(
            isinstance(entry, ReceivedMessage) and entry.content == "hello"
            for entry in assistant.history
        )
        assert any(
            isinstance(entry, AssistantText) and entry.content == "hi there"
            for entry in assistant.history
        )
    finally:
        registry.reset()


def _stop_all_agents(timeout: float = 1.0) -> None:
    for node in list(registry.get_all()):
        node.request_termination("test cleanup")
    for node in list(registry.get_all()):
        node.wait_for_termination(timeout=timeout)
    registry.reset()


def test_bootstrap_runtime_creates_builtin_roles(
    monkeypatch,
    tmp_path,
):
    registry.reset()
    settings_file = tmp_path / "settings.json"
    settings_file.write_text(
        json.dumps(
            {
                "event_log": {"timestamp_format": "absolute"},
                "model": {"active_provider_id": "", "active_model": ""},
                "providers": [],
                "roles": [],
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(Agent, "start", lambda self: None)
    monkeypatch.setattr(settings_module, "_SETTINGS_FILE", settings_file)
    monkeypatch.setattr(settings_module, "_cached_settings", None)

    bootstrap_runtime()

    try:
        settings = settings_module.get_settings()

        assert settings.roles == [
            RoleConfig(
                name=STEWARD_ROLE_NAME,
                description=STEWARD_ROLE_DESCRIPTION,
                system_prompt=STEWARD_ROLE_SYSTEM_PROMPT,
                included_tools=STEWARD_ROLE_INCLUDED_TOOLS,
            ),
            RoleConfig(
                name=WORKER_ROLE_NAME,
                description=WORKER_ROLE_DESCRIPTION,
                system_prompt=WORKER_ROLE_SYSTEM_PROMPT,
                included_tools=WORKER_ROLE_INCLUDED_TOOLS,
            ),
            RoleConfig(
                name=CONDUCTOR_ROLE_NAME,
                description=CONDUCTOR_ROLE_DESCRIPTION,
                system_prompt=CONDUCTOR_ROLE_SYSTEM_PROMPT,
                included_tools=CONDUCTOR_ROLE_INCLUDED_TOOLS,
            ),
            RoleConfig(
                name=DESIGNER_ROLE_NAME,
                description=DESIGNER_ROLE_DESCRIPTION,
                system_prompt=DESIGNER_ROLE_SYSTEM_PROMPT,
                included_tools=DESIGNER_ROLE_INCLUDED_TOOLS,
            ),
        ]
    finally:
        registry.reset()


def test_bootstrap_runtime_reconciles_existing_builtin_roles(monkeypatch, tmp_path):
    registry.reset()
    settings_file = tmp_path / "settings.json"
    settings_file.write_text(
        json.dumps(
            {
                "event_log": {"timestamp_format": "absolute"},
                "model": {"active_provider_id": "", "active_model": ""},
                "providers": [],
                "roles": [
                    {
                        "name": WORKER_ROLE_NAME,
                        "system_prompt": "Custom worker prompt.",
                        "included_tools": [],
                        "excluded_tools": ["fetch"],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(Agent, "start", lambda self: None)
    monkeypatch.setattr(settings_module, "_SETTINGS_FILE", settings_file)
    monkeypatch.setattr(settings_module, "_cached_settings", None)

    bootstrap_runtime()

    try:
        settings = settings_module.get_settings()

        assert settings.roles == [
            RoleConfig(
                name=STEWARD_ROLE_NAME,
                description=STEWARD_ROLE_DESCRIPTION,
                system_prompt=STEWARD_ROLE_SYSTEM_PROMPT,
                included_tools=STEWARD_ROLE_INCLUDED_TOOLS,
            ),
            RoleConfig(
                name=WORKER_ROLE_NAME,
                description=WORKER_ROLE_DESCRIPTION,
                system_prompt=WORKER_ROLE_SYSTEM_PROMPT,
                included_tools=WORKER_ROLE_INCLUDED_TOOLS,
            ),
            RoleConfig(
                name=CONDUCTOR_ROLE_NAME,
                description=CONDUCTOR_ROLE_DESCRIPTION,
                system_prompt=CONDUCTOR_ROLE_SYSTEM_PROMPT,
                included_tools=CONDUCTOR_ROLE_INCLUDED_TOOLS,
            ),
            RoleConfig(
                name=DESIGNER_ROLE_NAME,
                description=DESIGNER_ROLE_DESCRIPTION,
                system_prompt=DESIGNER_ROLE_SYSTEM_PROMPT,
                included_tools=DESIGNER_ROLE_INCLUDED_TOOLS,
            ),
        ]
    finally:
        registry.reset()


def test_bootstrap_runtime_uses_configured_assistant_role(monkeypatch, tmp_path):
    registry.reset()
    settings_file = tmp_path / "settings.json"
    settings_file.write_text(
        json.dumps(
            {
                "assistant": {"role_name": "Reviewer"},
                "event_log": {"timestamp_format": "absolute"},
                "model": {"active_provider_id": "", "active_model": ""},
                "providers": [],
                "roles": [
                    {
                        "name": "Reviewer",
                        "system_prompt": "Review everything.",
                        "included_tools": [],
                        "excluded_tools": [],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(Agent, "start", lambda self: None)
    monkeypatch.setattr(settings_module, "_SETTINGS_FILE", settings_file)
    monkeypatch.setattr(settings_module, "_cached_settings", None)

    bootstrap_runtime()

    try:
        assistant = registry.get_assistant()
        assert assistant is not None
        assert assistant.config.role_name == "Reviewer"
        assert settings_module.get_settings().assistant.role_name == "Reviewer"
    finally:
        registry.reset()


def test_bootstrap_runtime_preserves_steward_tools_for_non_steward_assistant_role(
    monkeypatch,
    tmp_path,
):
    registry.reset()
    settings_file = tmp_path / "settings.json"
    settings_file.write_text(
        json.dumps(
            {
                "assistant": {"role_name": WORKER_ROLE_NAME},
                "event_log": {"timestamp_format": "absolute"},
                "model": {"active_provider_id": "", "active_model": ""},
                "providers": [],
                "roles": [],
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(Agent, "start", lambda self: None)
    monkeypatch.setattr(settings_module, "_SETTINGS_FILE", settings_file)
    monkeypatch.setattr(settings_module, "_cached_settings", None)

    bootstrap_runtime()

    try:
        assistant = registry.get_assistant()
        assert assistant is not None
        assert assistant.config.role_name == WORKER_ROLE_NAME
        assert "create_workflow" in assistant.config.tools
        assert "delete_workflow" in assistant.config.tools
        assert "set_permissions" in assistant.config.tools
        assert "manage_settings" in assistant.config.tools
        assert "read" in assistant.config.tools
        assert "exec" in assistant.config.tools
    finally:
        registry.reset()


def test_bootstrap_runtime_uses_configured_assistant_permissions(
    monkeypatch,
    tmp_path,
):
    registry.reset()
    allowed_dir = tmp_path / "assistant-write"
    settings_file = tmp_path / "settings.json"
    settings_file.write_text(
        json.dumps(
            {
                "assistant": {
                    "role_name": "Reviewer",
                    "allow_network": False,
                    "write_dirs": [str(allowed_dir)],
                },
                "event_log": {"timestamp_format": "absolute"},
                "model": {"active_provider_id": "", "active_model": ""},
                "providers": [],
                "roles": [
                    {
                        "name": "Reviewer",
                        "system_prompt": "Review everything.",
                        "included_tools": [],
                        "excluded_tools": [],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(Agent, "start", lambda self: None)
    monkeypatch.setattr(settings_module, "_SETTINGS_FILE", settings_file)
    monkeypatch.setattr(settings_module, "_cached_settings", None)

    bootstrap_runtime()

    try:
        assistant = registry.get_assistant()
        assert assistant is not None
        assert assistant.config.allow_network is False
        assert assistant.config.write_dirs == [str(allowed_dir.resolve())]
    finally:
        registry.reset()


def test_bootstrap_runtime_falls_back_to_steward_when_assistant_role_missing(
    monkeypatch,
    tmp_path,
):
    registry.reset()
    settings_file = tmp_path / "settings.json"
    settings_file.write_text(
        json.dumps(
            {
                "assistant": {"role_name": "Ghost"},
                "event_log": {"timestamp_format": "absolute"},
                "model": {"active_provider_id": "", "active_model": ""},
                "providers": [],
                "roles": [],
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(Agent, "start", lambda self: None)
    monkeypatch.setattr(settings_module, "_SETTINGS_FILE", settings_file)
    monkeypatch.setattr(settings_module, "_cached_settings", None)

    bootstrap_runtime()

    try:
        assistant = registry.get_assistant()
        assert assistant is not None
        assert assistant.config.role_name == STEWARD_ROLE_NAME
        assert settings_module.get_settings().assistant.role_name == STEWARD_ROLE_NAME
    finally:
        registry.reset()


def test_bootstrap_runtime_backfills_state_history_for_restored_nodes(
    monkeypatch,
    tmp_path,
):
    registry.reset()
    settings_file = tmp_path / "settings.json"
    workspace_file = tmp_path / "workspace.json"
    settings_file.write_text(
        json.dumps(
            {
                "event_log": {"timestamp_format": "absolute"},
                "model": {"active_provider_id": "", "active_model": ""},
                "providers": [],
                "roles": [],
            }
        ),
        encoding="utf-8",
    )
    workspace_file.write_text(
        json.dumps(
            {
                "tabs": [
                    {
                        "id": "tab-1",
                        "title": "Restore",
                        "created_at": 1,
                        "updated_at": 1,
                    }
                ],
                "nodes": [
                    {
                        "id": "node-1",
                        "config": {
                            "node_type": "agent",
                            "role_name": "Worker",
                            "tab_id": "tab-1",
                            "name": "Restored Worker",
                            "tools": [],
                            "write_dirs": [],
                            "allow_network": False,
                        },
                        "state": "idle",
                        "todos": [],
                        "history": [],
                        "position": None,
                        "created_at": 1,
                        "updated_at": 1,
                    }
                ],
                "edges": [],
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(Agent, "start", lambda self: None)
    monkeypatch.setattr(settings_module, "_SETTINGS_FILE", settings_file)
    monkeypatch.setattr(settings_module, "_cached_settings", None)

    bootstrap_runtime()

    try:
        restored = registry.get("node-1")
        assert restored is not None
        assert restored.state == AgentState.IDLE
        assert restored.history == []
    finally:
        registry.reset()


@pytest.mark.parametrize("restored_state", ["running", "sleeping"])
def test_bootstrap_runtime_restores_active_nodes_as_idle(
    monkeypatch,
    tmp_path,
    restored_state,
):
    settings_file = tmp_path / "settings.json"
    workspace_file = tmp_path / "workspace.json"
    registry.reset()
    settings_file.write_text(
        json.dumps(
            {
                "event_log": {"timestamp_format": "absolute"},
                "model": {"active_provider_id": "", "active_model": ""},
                "providers": [],
                "roles": [],
            }
        ),
        encoding="utf-8",
    )
    workspace_file.write_text(
        json.dumps(
            {
                "tabs": [
                    {
                        "id": "tab-1",
                        "title": "Restore",
                        "created_at": 1,
                        "updated_at": 1,
                    }
                ],
                "nodes": [
                    {
                        "id": "node-1",
                        "config": {
                            "node_type": "agent",
                            "role_name": "Worker",
                            "tab_id": "tab-1",
                            "name": "Restored Worker",
                            "tools": [],
                            "write_dirs": [],
                            "allow_network": False,
                        },
                        "state": restored_state,
                        "todos": [{"text": "resume me"}],
                        "history": [
                            {
                                "type": "StateEntry",
                                "state": restored_state,
                                "reason": "before restart",
                            }
                        ],
                        "position": None,
                        "created_at": 1,
                        "updated_at": 1,
                    }
                ],
                "edges": [],
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(settings_module, "_SETTINGS_FILE", settings_file)
    monkeypatch.setattr(settings_module, "_cached_settings", None)

    bootstrap_runtime()

    try:
        restored = registry.get("node-1")
        assert restored is not None
        assert restored.wait_until_idle(timeout=1.0) is True
        assert restored.state == AgentState.IDLE
        assert restored.uuid == "node-1"
        assert [todo.text for todo in restored.todos] == ["resume me"]
        assert all(
            entry.__class__.__name__ != "StateEntry" for entry in restored.history
        )
        persisted = workspace_store.get_node_record("node-1")
        assert persisted is not None
        assert persisted.state == AgentState.IDLE
    finally:
        _stop_all_agents()


def test_bootstrap_runtime_restores_workflow_definition_without_runtime_connections(
    monkeypatch,
    tmp_path,
):
    settings_file = tmp_path / "settings.json"
    workspace_file = tmp_path / "workspace.json"
    registry.reset()
    settings_file.write_text(
        json.dumps(
            {
                "event_log": {"timestamp_format": "absolute"},
                "model": {"active_provider_id": "", "active_model": ""},
                "providers": [],
                "roles": [],
            }
        ),
        encoding="utf-8",
    )
    workspace_file.write_text(
        json.dumps(
            {
                "tabs": [
                    {
                        "id": "tab-1",
                        "title": "Restore",
                        "leader_id": "leader-1",
                        "created_at": 1,
                        "updated_at": 1,
                    }
                ],
                "nodes": [
                    {
                        "id": "leader-1",
                        "config": {
                            "node_type": "agent",
                            "role_name": "Conductor",
                            "tab_id": "tab-1",
                            "name": "Leader",
                            "tools": [],
                            "write_dirs": [],
                            "allow_network": False,
                        },
                        "state": "idle",
                        "todos": [],
                        "history": [],
                        "position": None,
                        "created_at": 1,
                        "updated_at": 1,
                    },
                    {
                        "id": "node-a",
                        "config": {
                            "node_type": "agent",
                            "role_name": "Worker",
                            "tab_id": "tab-1",
                            "name": "Worker A",
                            "tools": [],
                            "write_dirs": [],
                            "allow_network": False,
                        },
                        "state": "idle",
                        "todos": [],
                        "history": [],
                        "position": None,
                        "created_at": 1,
                        "updated_at": 1,
                    },
                    {
                        "id": "node-b",
                        "config": {
                            "node_type": "agent",
                            "role_name": "Worker",
                            "tab_id": "tab-1",
                            "name": "Worker B",
                            "tools": [],
                            "write_dirs": [],
                            "allow_network": False,
                        },
                        "state": "idle",
                        "todos": [],
                        "history": [],
                        "position": None,
                        "created_at": 1,
                        "updated_at": 1,
                    },
                ],
                "edges": [
                    {
                        "id": "edge-1",
                        "tab_id": "tab-1",
                        "from_node_id": "leader-1",
                        "to_node_id": "node-a",
                    },
                    {
                        "id": "edge-2",
                        "tab_id": "tab-1",
                        "from_node_id": "node-a",
                        "to_node_id": "node-b",
                    },
                    {
                        "id": "edge-3",
                        "tab_id": "tab-1",
                        "from_node_id": "node-b",
                        "to_node_id": "node-a",
                    },
                ],
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(Agent, "start", lambda self: None)
    monkeypatch.setattr(settings_module, "_SETTINGS_FILE", settings_file)
    monkeypatch.setattr(settings_module, "_cached_settings", None)

    bootstrap_runtime()

    try:
        leader = registry.get("leader-1")
        left = registry.get("node-a")
        right = registry.get("node-b")
        restored_tab = workspace_store.get_tab("tab-1")

        assert leader is not None
        assert left is not None
        assert right is not None
        assert restored_tab is not None
        assert leader.get_connections_snapshot() == []
        assert left.get_connections_snapshot() == []
        assert right.get_connections_snapshot() == []
        assert {node.id for node in restored_tab.definition.nodes} == {
            "node-a",
            "node-b",
        }
        assert {
            (edge.from_node_id, edge.to_node_id)
            for edge in restored_tab.definition.edges
        } == {
            ("node-a", "node-b"),
            ("node-b", "node-a"),
        }
    finally:
        registry.reset()


def test_bootstrap_runtime_preserves_error_state_for_restored_nodes(
    monkeypatch,
    tmp_path,
):
    settings_file = tmp_path / "settings.json"
    workspace_file = tmp_path / "workspace.json"
    registry.reset()
    settings_file.write_text(
        json.dumps(
            {
                "event_log": {"timestamp_format": "absolute"},
                "model": {"active_provider_id": "", "active_model": ""},
                "providers": [],
                "roles": [],
            }
        ),
        encoding="utf-8",
    )
    workspace_file.write_text(
        json.dumps(
            {
                "tabs": [
                    {
                        "id": "tab-1",
                        "title": "Restore",
                        "created_at": 1,
                        "updated_at": 1,
                    }
                ],
                "nodes": [
                    {
                        "id": "node-1",
                        "config": {
                            "node_type": "agent",
                            "role_name": "Worker",
                            "tab_id": "tab-1",
                            "name": "Broken Worker",
                            "tools": [],
                            "write_dirs": [],
                            "allow_network": False,
                        },
                        "state": "error",
                        "todos": [],
                        "history": [
                            {
                                "type": "StateEntry",
                                "state": "error",
                                "reason": "provider failure",
                            }
                        ],
                        "position": None,
                        "created_at": 1,
                        "updated_at": 1,
                    }
                ],
                "edges": [],
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(settings_module, "_SETTINGS_FILE", settings_file)
    monkeypatch.setattr(settings_module, "_cached_settings", None)

    bootstrap_runtime()

    try:
        restored = registry.get("node-1")
        assert restored is not None
        assert restored.state == AgentState.ERROR
        assert restored.wait_until_idle(timeout=0.05) is False
        assert all(
            entry.__class__.__name__ != "StateEntry" for entry in restored.history
        )
        persisted = workspace_store.get_node_record("node-1")
        assert persisted is not None
        assert persisted.state == AgentState.ERROR
    finally:
        _stop_all_agents()


def test_bootstrap_runtime_skips_terminated_restored_nodes(monkeypatch, tmp_path):
    settings_file = tmp_path / "settings.json"
    workspace_file = tmp_path / "workspace.json"
    registry.reset()
    settings_file.write_text(
        json.dumps(
            {
                "event_log": {"timestamp_format": "absolute"},
                "model": {"active_provider_id": "", "active_model": ""},
                "providers": [],
                "roles": [],
            }
        ),
        encoding="utf-8",
    )
    workspace_file.write_text(
        json.dumps(
            {
                "tabs": [
                    {
                        "id": "tab-1",
                        "title": "Restore",
                        "created_at": 1,
                        "updated_at": 1,
                    }
                ],
                "nodes": [
                    {
                        "id": "node-1",
                        "config": {
                            "node_type": "agent",
                            "role_name": "Worker",
                            "tab_id": "tab-1",
                            "name": "Finished Worker",
                            "tools": [],
                            "write_dirs": [],
                            "allow_network": False,
                        },
                        "state": "terminated",
                        "todos": [],
                        "history": [
                            {
                                "type": "StateEntry",
                                "state": "terminated",
                                "reason": "done",
                            }
                        ],
                        "position": None,
                        "created_at": 1,
                        "updated_at": 1,
                    }
                ],
                "edges": [],
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(settings_module, "_SETTINGS_FILE", settings_file)
    monkeypatch.setattr(settings_module, "_cached_settings", None)

    bootstrap_runtime()

    try:
        assert registry.get("node-1") is None
        persisted = workspace_store.get_node_record("node-1")
        assert persisted is not None
        assert persisted.state == AgentState.TERMINATED
    finally:
        _stop_all_agents()


def test_shutdown_runtime_keeps_persistent_workspace_nodes_unterminated(
    monkeypatch,
    tmp_path,
):
    settings_file = tmp_path / "settings.json"
    workspace_file = tmp_path / "workspace.json"
    registry.reset()
    settings_file.write_text(
        json.dumps(
            {
                "event_log": {"timestamp_format": "absolute"},
                "model": {"active_provider_id": "", "active_model": ""},
                "providers": [],
                "roles": [],
            }
        ),
        encoding="utf-8",
    )
    workspace_file.write_text(
        json.dumps(
            {
                "tabs": [
                    {
                        "id": "tab-1",
                        "title": "Restore",
                        "created_at": 1,
                        "updated_at": 1,
                    }
                ],
                "nodes": [
                    {
                        "id": "node-1",
                        "config": {
                            "node_type": "agent",
                            "role_name": "Worker",
                            "tab_id": "tab-1",
                            "name": "Persistent Worker",
                            "tools": [],
                            "write_dirs": [],
                            "allow_network": False,
                        },
                        "state": "idle",
                        "todos": [],
                        "history": [
                            {
                                "type": "StateEntry",
                                "state": "idle",
                                "reason": "restored",
                            }
                        ],
                        "position": None,
                        "created_at": 1,
                        "updated_at": 1,
                    }
                ],
                "edges": [],
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(settings_module, "_SETTINGS_FILE", settings_file)
    monkeypatch.setattr(settings_module, "_cached_settings", None)

    bootstrap_runtime()

    try:
        assistant = registry.get_assistant()
        persistent = registry.get("node-1")
        assert assistant is not None
        assert persistent is not None
        assistant_id = assistant.uuid
        assistant._append_history(ReceivedMessage(content="hello", from_id="human"))
        assistant._append_history(AssistantText(content="hi there"))

        shutdown_runtime()

        assert assistant.wait_for_termination(timeout=1.0) is True
        assert persistent.wait_for_termination(timeout=1.0) is True
        assert registry.get_all() == []
        assert assistant.state == AgentState.IDLE
        assert persistent.state == AgentState.IDLE
        persisted_assistant = workspace_store.get_node_record(assistant_id)
        assert persisted_assistant is not None
        assert persisted_assistant.state == AgentState.IDLE
        assert any(
            isinstance(entry, ReceivedMessage) and entry.content == "hello"
            for entry in persisted_assistant.history
        )
        assert any(
            isinstance(entry, AssistantText) and entry.content == "hi there"
            for entry in persisted_assistant.history
        )
        persisted = workspace_store.get_node_record("node-1")
        assert persisted is not None
        assert persisted.state == AgentState.IDLE
        assert all(
            entry.__class__.__name__ != "StateEntry" for entry in persistent.history
        )

        bootstrap_runtime()

        restored_assistant = registry.get_assistant()
        assert restored_assistant is not None
        assert restored_assistant.uuid == assistant_id
        assert any(
            isinstance(entry, ReceivedMessage) and entry.content == "hello"
            for entry in restored_assistant.history
        )
        assert any(
            isinstance(entry, AssistantText) and entry.content == "hi there"
            for entry in restored_assistant.history
        )
    finally:
        _stop_all_agents()
