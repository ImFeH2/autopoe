import json
import threading

from flowent.agent import Agent
from flowent.models import (
    AgentState,
    Message,
    NodeConfig,
    NodeType,
    ReceivedMessage,
    StateEntry,
    Tab,
    TodoItem,
)
from flowent.registry import registry
from flowent.settings import RoleConfig, Settings
from flowent.tools.contacts import ContactsTool
from flowent.tools.idle import IdleTool
from flowent.tools.list_roles import ListRolesTool
from flowent.tools.list_tabs import ListTabsTool
from flowent.tools.list_tools import ListToolsTool
from flowent.tools.sleep import SleepTool
from flowent.tools.todo import TodoTool
from flowent.workspace_store import workspace_store


def test_idle_tool_uses_request_idle(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.AGENT, tools=["idle"]))
    called: list[str | None] = []

    def fake_request_idle(*, tool_call_id: str | None = None) -> str:
        called.append(tool_call_id)
        return "idle 1.25s"

    monkeypatch.setattr(agent, "request_idle", fake_request_idle)

    result = IdleTool().execute(agent, {})

    assert result == "idle 1.25s"
    assert called == [None]


def test_idle_tool_blocks_until_message_and_returns_idle_duration():
    agent = Agent(NodeConfig(node_type=NodeType.AGENT, tools=["idle"]), uuid="agent-a")
    result: list[str] = []

    thread = threading.Thread(
        target=lambda: result.append(IdleTool().execute(agent, {})),
        daemon=True,
    )
    thread.start()

    agent.enqueue_message(
        Message(from_id="tester", to_id=agent.uuid, content="hello from queue")
    )
    thread.join(timeout=1.0)

    assert not thread.is_alive()
    assert len(result) == 1
    assert result[0].startswith("idle ")
    assert result[0].endswith("s")
    received_entries = [
        entry for entry in agent.history if isinstance(entry, ReceivedMessage)
    ]
    assert len(received_entries) == 1
    assert received_entries[0].from_id == "tester"
    assert received_entries[0].content == "hello from queue"


def test_idle_tool_returns_immediately_when_runtime_notice_is_pending():
    agent = Agent(NodeConfig(node_type=NodeType.AGENT, tools=["idle"]), uuid="agent-a")
    agent.set_state(AgentState.RUNNING, "processing")
    agent._queue_runtime_notice("fix the previous routing mistake")

    result = IdleTool().execute(agent, {})

    assert result == ""
    assert agent.state == AgentState.RUNNING
    assert agent._build_messages()[-1] == {
        "role": "user",
        "content": "<system>fix the previous routing mistake</system>",
    }


def test_sleep_tool_uses_request_sleep(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.AGENT, tools=["sleep"]))
    called: list[float] = []

    def fake_request_sleep(*, seconds: float) -> str:
        called.append(seconds)
        return "slept 0.25s"

    monkeypatch.setattr(agent, "request_sleep", fake_request_sleep)

    result = SleepTool().execute(agent, {"seconds": 0.25})

    assert result == "slept 0.25s"
    assert called == [0.25]


def test_sleep_tool_rejects_negative_seconds():
    agent = Agent(NodeConfig(node_type=NodeType.AGENT, tools=["sleep"]))

    result = json.loads(SleepTool().execute(agent, {"seconds": -1}))

    assert result == {"error": "seconds must be a non-negative number"}


def test_sleep_tool_waits_and_returns_duration():
    agent = Agent(NodeConfig(node_type=NodeType.AGENT, tools=["sleep"]))

    result = SleepTool().execute(agent, {"seconds": 0.01})

    assert result.startswith("slept ")
    assert result.endswith("s")


def test_enqueue_message_enqueues_wake_signal_immediately():
    agent = Agent(NodeConfig(node_type=NodeType.AGENT), uuid="agent-a")

    agent.enqueue_message(
        Message(from_id="tester", to_id=agent.uuid, content="hello from queue")
    )

    signal = agent._wake_queue.get_nowait()

    assert signal.reason == "message"
    assert signal.payload == {
        "message": {
            "from": "tester",
            "content": "hello from queue",
            "parts": [{"type": "text", "text": "hello from queue"}],
            "history_recorded": False,
        }
    }
    assert signal.resume_reason == "received message from tester"


def test_request_termination_enqueues_wake_signal_immediately():
    agent = Agent(NodeConfig(node_type=NodeType.AGENT), uuid="agent-a")

    agent.request_termination("stop")

    signal = agent._wake_queue.get_nowait()

    assert agent._terminate.is_set()
    assert agent._termination_reason == "stop"
    assert signal.reason == "termination"
    assert signal.payload == {}
    assert signal.resume_reason == "termination requested"


def test_request_interrupt_marks_running_agent():
    agent = Agent(NodeConfig(node_type=NodeType.AGENT), uuid="agent-a")
    agent.set_state(AgentState.RUNNING, "processing")

    interrupted = agent.request_interrupt()

    assert interrupted is True
    assert agent._interrupt_requested.is_set()


def test_request_interrupt_marks_sleeping_agent():
    agent = Agent(NodeConfig(node_type=NodeType.AGENT), uuid="agent-a")
    agent.set_state(AgentState.SLEEPING, "waiting for reply")

    interrupted = agent.request_interrupt()

    assert interrupted is True
    assert agent._interrupt_requested.is_set()


def test_request_interrupt_ignores_idle_agent():
    agent = Agent(NodeConfig(node_type=NodeType.AGENT), uuid="agent-a")

    interrupted = agent.request_interrupt()

    assert interrupted is False
    assert not agent._interrupt_requested.is_set()


def test_state_changes_are_recorded_in_history():
    agent = Agent(NodeConfig(node_type=NodeType.AGENT), uuid="agent-a")

    agent.set_state(AgentState.RUNNING, "processing")
    agent.set_state(AgentState.IDLE, "completed")

    state_entries = [
        entry for entry in agent.get_history_snapshot() if isinstance(entry, StateEntry)
    ]

    assert [entry.state for entry in state_entries] == [
        "initializing",
        "running",
        "idle",
    ]
    assert [entry.reason for entry in state_entries] == [
        "created",
        "processing",
        "completed",
    ]


def test_contacts_tool_uses_agent_public_api(monkeypatch):
    agent = Agent(
        NodeConfig(node_type=NodeType.AGENT, tools=["contacts"]),
        uuid="agent-a",
    )
    expected = [
        {
            "id": "agent-b",
            "node_type": "agent",
            "role_name": "Worker",
            "name": "Worker",
            "state": "idle",
        }
    ]

    monkeypatch.setattr(agent, "get_contacts_info", lambda: expected)

    result = json.loads(ContactsTool().execute(agent, {}))

    assert result == {"contacts": expected}


def test_agent_get_contacts_info_keeps_only_leader_for_regular_agents():
    registry.reset()
    workspace_store.reset_cache()
    workspace_store.upsert_tab(Tab(id="tab-1", title="Task", leader_id="leader-a"))
    leader = Agent(
        NodeConfig(
            node_type=NodeType.AGENT,
            role_name="Conductor",
            name="Leader",
            tab_id="tab-1",
        ),
        uuid="leader-a",
    )
    agent = Agent(
        NodeConfig(node_type=NodeType.AGENT, tab_id="tab-1"),
        uuid="agent-a",
    )
    assistant = Agent(
        NodeConfig(node_type=NodeType.ASSISTANT, role_name="Steward", name="Assistant"),
        uuid="assistant-a",
    )
    peer = Agent(
        NodeConfig(
            node_type=NodeType.AGENT,
            role_name="Worker",
            name="Worker",
            tab_id="tab-1",
        ),
        uuid="agent-b",
    )
    registry.register(leader)
    registry.register(agent)
    registry.register(assistant)
    registry.register(peer)
    agent.add_connection(peer.uuid)

    try:
        assert agent.get_contacts_info() == [
            {
                "id": "leader-a",
                "node_type": "agent",
                "role_name": "Conductor",
                "name": "Leader",
                "state": "initializing",
                "is_leader": True,
            },
        ]
    finally:
        registry.reset()
        workspace_store.reset_cache()


def test_agent_get_contacts_info_keeps_leader_stable_when_explicitly_connected():
    registry.reset()
    workspace_store.reset_cache()
    workspace_store.upsert_tab(Tab(id="tab-1", title="Task", leader_id="leader-a"))
    leader = Agent(
        NodeConfig(
            node_type=NodeType.AGENT,
            role_name="Conductor",
            name="Leader",
            tab_id="tab-1",
        ),
        uuid="leader-a",
    )
    agent = Agent(
        NodeConfig(node_type=NodeType.AGENT, tab_id="tab-1"),
        uuid="agent-a",
    )
    assistant = Agent(
        NodeConfig(node_type=NodeType.ASSISTANT, role_name="Steward", name="Assistant"),
        uuid="assistant-a",
    )
    registry.register(leader)
    registry.register(agent)
    registry.register(assistant)
    agent.add_connection(leader.uuid)

    try:
        assert agent.get_contacts_info() == [
            {
                "id": "leader-a",
                "node_type": "agent",
                "role_name": "Conductor",
                "name": "Leader",
                "state": "initializing",
                "is_leader": True,
            }
        ]
    finally:
        registry.reset()
        workspace_store.reset_cache()


def test_agent_get_contacts_info_ignores_peer_only_connections():
    registry.reset()
    workspace_store.reset_cache()
    workspace_store.upsert_tab(Tab(id="tab-1", title="Task", leader_id="leader-a"))
    leader = Agent(
        NodeConfig(
            node_type=NodeType.AGENT,
            role_name="Conductor",
            name="Leader",
            tab_id="tab-1",
        ),
        uuid="leader-a",
    )
    agent = Agent(
        NodeConfig(node_type=NodeType.AGENT, tab_id="tab-1"),
        uuid="agent-a",
    )
    assistant = Agent(
        NodeConfig(node_type=NodeType.ASSISTANT, role_name="Steward", name="Assistant"),
        uuid="assistant-a",
    )
    peer = Agent(
        NodeConfig(
            node_type=NodeType.AGENT,
            role_name="Reviewer",
            name="Reviewer",
            tab_id="tab-1",
        ),
        uuid="agent-b",
    )
    registry.register(leader)
    registry.register(agent)
    registry.register(assistant)
    registry.register(peer)
    peer.add_connection(agent.uuid)

    try:
        assert agent.get_contacts_info() == [
            {
                "id": "leader-a",
                "node_type": "agent",
                "role_name": "Conductor",
                "name": "Leader",
                "state": "initializing",
                "is_leader": True,
            },
        ]
    finally:
        registry.reset()
        workspace_store.reset_cache()


def test_leader_get_contacts_info_includes_assistant_and_all_tab_agents():
    registry.reset()
    workspace_store.reset_cache()
    workspace_store.upsert_tab(Tab(id="tab-1", title="Task", leader_id="leader-a"))
    assistant = Agent(
        NodeConfig(node_type=NodeType.ASSISTANT, role_name="Steward", name="Assistant"),
        uuid="assistant-a",
    )
    leader = Agent(
        NodeConfig(
            node_type=NodeType.AGENT,
            role_name="Conductor",
            name="Leader",
            tab_id="tab-1",
        ),
        uuid="leader-a",
    )
    outgoing_worker = Agent(
        NodeConfig(
            node_type=NodeType.AGENT,
            role_name="Worker",
            name="Writer",
            tab_id="tab-1",
        ),
        uuid="agent-b",
    )
    incoming_worker = Agent(
        NodeConfig(
            node_type=NodeType.AGENT,
            role_name="Reviewer",
            name="Reviewer",
            tab_id="tab-1",
        ),
        uuid="agent-c",
    )
    detached_worker = Agent(
        NodeConfig(
            node_type=NodeType.AGENT,
            role_name="Analyst",
            name="Analyst",
            tab_id="tab-1",
        ),
        uuid="agent-d",
    )
    registry.register(assistant)
    registry.register(leader)
    registry.register(outgoing_worker)
    registry.register(incoming_worker)
    registry.register(detached_worker)
    leader.add_connection(outgoing_worker.uuid)
    incoming_worker.add_connection(leader.uuid)

    try:
        assert leader.get_contacts_info() == [
            {
                "id": "assistant-a",
                "node_type": "assistant",
                "role_name": "Steward",
                "name": "Assistant",
                "state": "initializing",
                "is_leader": False,
            },
            {
                "id": "agent-b",
                "node_type": "agent",
                "role_name": "Worker",
                "name": "Writer",
                "state": "initializing",
                "is_leader": False,
            },
            {
                "id": "agent-c",
                "node_type": "agent",
                "role_name": "Reviewer",
                "name": "Reviewer",
                "state": "initializing",
                "is_leader": False,
            },
            {
                "id": "agent-d",
                "node_type": "agent",
                "role_name": "Analyst",
                "name": "Analyst",
                "state": "initializing",
                "is_leader": False,
            },
        ]
    finally:
        registry.reset()
        workspace_store.reset_cache()


def test_assistant_get_contacts_info_lists_registered_tab_leaders():
    registry.reset()
    workspace_store.reset_cache()
    workspace_store.upsert_tab(Tab(id="tab-1", title="Task", leader_id="leader-a"))
    assistant = Agent(
        NodeConfig(node_type=NodeType.ASSISTANT, role_name="Steward", name="Assistant"),
        uuid="assistant-a",
    )
    leader = Agent(
        NodeConfig(
            node_type=NodeType.AGENT,
            role_name="Conductor",
            name="Leader",
            tab_id="tab-1",
        ),
        uuid="leader-a",
    )
    worker = Agent(
        NodeConfig(
            node_type=NodeType.AGENT,
            role_name="Worker",
            name="Worker",
            tab_id="tab-1",
        ),
        uuid="agent-b",
    )
    registry.register(assistant)
    registry.register(leader)
    registry.register(worker)

    try:
        assert assistant.get_contacts_info() == [
            {
                "id": "leader-a",
                "node_type": "agent",
                "role_name": "Conductor",
                "name": "Leader",
                "state": "initializing",
                "is_leader": True,
            }
        ]
    finally:
        registry.reset()
        workspace_store.reset_cache()


def test_list_roles_tool_returns_registered_roles(monkeypatch):
    agent = Agent(
        NodeConfig(
            node_type=NodeType.AGENT,
            role_name="Conductor",
            tools=["list_roles"],
        )
    )

    monkeypatch.setattr(
        "flowent.settings.get_settings",
        lambda: Settings(
            roles=[
                RoleConfig(
                    name="Worker",
                    description="General execution role",
                    system_prompt="Do work.",
                    included_tools=["read", "exec"],
                ),
                RoleConfig(
                    name="Reviewer",
                    description="Review code carefully",
                    system_prompt="Review code.",
                    excluded_tools=["fetch"],
                ),
            ]
        ),
    )

    result = json.loads(ListRolesTool().execute(agent, {}))

    assert result == [
        {
            "name": "Worker",
            "description": "General execution role",
            "system_prompt": "Do work.",
            "builtin_tools": [
                "idle",
                "sleep",
                "todo",
                "contacts",
                "send",
                "read",
                "exec",
            ],
            "optional_tools": [
                "set_permissions",
                "create_agent",
                "connect",
                "edit",
                "fetch",
                "list_roles",
                "list_tools",
                "list_mcp_resources",
                "list_mcp_resource_templates",
                "read_mcp_resource",
                "list_mcp_prompts",
                "get_mcp_prompt",
            ],
        },
        {
            "name": "Reviewer",
            "description": "Review code carefully",
            "system_prompt": "Review code.",
            "builtin_tools": [
                "idle",
                "sleep",
                "todo",
                "contacts",
                "send",
            ],
            "optional_tools": [
                "set_permissions",
                "create_agent",
                "connect",
                "read",
                "edit",
                "exec",
                "list_roles",
                "list_tools",
                "list_mcp_resources",
                "list_mcp_resource_templates",
                "read_mcp_resource",
                "list_mcp_prompts",
                "get_mcp_prompt",
            ],
        },
    ]


def test_list_tools_tool_returns_registered_tool_names_and_descriptions():
    agent = Agent(
        NodeConfig(
            node_type=NodeType.AGENT,
            role_name="Conductor",
            tools=["list_tools"],
        )
    )

    result = json.loads(ListToolsTool().execute(agent, {}))

    assert {item["name"] for item in result} == {
        "idle",
        "sleep",
        "todo",
        "contacts",
        "send",
        "read",
        "edit",
        "exec",
        "fetch",
        "set_permissions",
        "create_agent",
        "connect",
        "list_roles",
        "list_tools",
        "list_mcp_resources",
        "list_mcp_resource_templates",
        "read_mcp_resource",
        "list_mcp_prompts",
        "get_mcp_prompt",
    }
    assert all(
        {"name", "description", "source", "parameters"} <= set(item) for item in result
    )
    assert all(
        isinstance(item["description"], str) and item["description"] for item in result
    )


def test_list_tabs_tool_returns_summaries_and_details(monkeypatch, tmp_path):
    import flowent.settings as settings_module
    from flowent.graph_service import create_agent_node, create_edge, create_tab
    from flowent.workspace_store import workspace_store

    settings_file = tmp_path / "settings.json"
    settings_file.write_text(
        json.dumps(
            {
                "event_log": {"timestamp_format": "absolute"},
                "model": {"active_provider_id": "", "active_model": ""},
                "custom_prompt": "",
                "custom_post_prompt": "",
                "providers": [],
                "roles": [],
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(settings_module, "_SETTINGS_FILE", settings_file)
    monkeypatch.setattr(settings_module, "_cached_settings", None)
    monkeypatch.setattr(
        "flowent.settings.get_settings",
        lambda: Settings(
            roles=[
                RoleConfig(
                    name="Worker",
                    system_prompt="Do work.",
                    included_tools=["read"],
                )
            ]
        ),
    )
    workspace_store.reset_cache()
    registry.reset()

    try:
        tab = create_tab(title="Review")
        left, error = create_agent_node(role_name="Worker", tab_id=tab.id, name="Left")
        assert error is None and left is not None
        right, error = create_agent_node(
            role_name="Worker", tab_id=tab.id, name="Right"
        )
        assert error is None and right is not None
        edge, error = create_edge(from_node_id=left.id, to_node_id=right.id)
        assert error is None and edge is not None

        agent = Agent(
            NodeConfig(node_type=NodeType.ASSISTANT, tools=["list_workflows"]),
            uuid="assistant",
        )

        summaries = json.loads(ListTabsTool().execute(agent, {}))
        assert len(summaries) == 1
        assert summaries[0]["id"] == tab.id
        assert summaries[0]["title"] == tab.title
        assert summaries[0]["created_at"] == tab.created_at
        assert isinstance(summaries[0]["updated_at"], float)
        assert summaries[0]["node_count"] == 2
        assert summaries[0]["edge_count"] == 1

        detail = json.loads(ListTabsTool().execute(agent, {"workflow_id": tab.id}))
        assert detail["workflow"]["id"] == tab.id
        assert {node["name"] for node in detail["nodes"]} == {"Left", "Right"}
        assert detail["edges"] == [edge.serialize()]
    finally:
        registry.reset()
        workspace_store.reset_cache()
        monkeypatch.setattr(settings_module, "_cached_settings", None)


def test_todo_tool_writes_via_set_todos(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.AGENT, tools=["todo"]))
    applied: list[list[TodoItem]] = []

    def fake_set_todos(todos: list[TodoItem]) -> None:
        applied.append(todos)
        agent.todos = list(todos)

    monkeypatch.setattr(agent, "set_todos", fake_set_todos)

    result = json.loads(TodoTool().execute(agent, {"todos": ["step 1", "step 2"]}))

    assert result == {"status": "updated"}
    assert len(applied) == 1
    assert [item.text for item in applied[0]] == ["step 1", "step 2"]
