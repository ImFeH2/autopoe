import json

import pytest

from flowent.agent import Agent
from flowent.models import AgentState, GraphNodeRecord, NodeConfig, NodeType, Tab
from flowent.registry import registry
from flowent.settings import AssistantSettings, Settings
from flowent.tools.set_permissions import SetPermissionsTool
from flowent.workspace_store import workspace_store


@pytest.fixture(autouse=True)
def reset_runtime_state(monkeypatch, tmp_path):
    import flowent.settings as settings_module

    settings_file = tmp_path / "settings.json"
    settings_file.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(settings_module, "_SETTINGS_FILE", settings_file)
    monkeypatch.setattr(settings_module, "_cached_settings", None)
    registry.reset()
    workspace_store.reset_cache()
    yield
    registry.reset()
    workspace_store.reset_cache()
    monkeypatch.setattr(settings_module, "_cached_settings", None)


def _make_record(
    *,
    node_id: str,
    tab_id: str,
    role_name: str,
    name: str,
    write_dirs: list[str],
    allow_network: bool,
    tools: list[str] | None = None,
) -> GraphNodeRecord:
    return GraphNodeRecord(
        id=node_id,
        config=NodeConfig(
            node_type=NodeType.AGENT,
            role_name=role_name,
            tab_id=tab_id,
            name=name,
            tools=list(tools or []),
            write_dirs=list(write_dirs),
            allow_network=allow_network,
        ),
        state=AgentState.INITIALIZING,
    )


def _register_live_node(record: GraphNodeRecord) -> Agent:
    node = Agent(
        NodeConfig(
            node_type=record.config.node_type,
            role_name=record.config.role_name,
            tab_id=record.config.tab_id,
            name=record.config.name,
            tools=list(record.config.tools),
            write_dirs=list(record.config.write_dirs),
            allow_network=record.config.allow_network,
        ),
        uuid=record.id,
    )
    registry.register(node)
    return node


def _grant_assistant_permissions(
    monkeypatch,
    *,
    write_dirs: list[str],
    allow_network: bool,
) -> None:
    monkeypatch.setattr(
        "flowent.settings.get_settings",
        lambda: Settings(
            assistant=AssistantSettings(
                write_dirs=list(write_dirs),
                allow_network=allow_network,
            )
        ),
    )


def test_set_permissions_updates_workflow_boundary_for_all_nodes(monkeypatch, tmp_path):
    root_dir = tmp_path / "root"
    keep_boundary = root_dir / "keep"
    keep_dir = keep_boundary / "child"
    drop_dir = root_dir / "drop"
    keep_dir.mkdir(parents=True)
    drop_dir.mkdir(parents=True)
    _grant_assistant_permissions(
        monkeypatch,
        write_dirs=[str(root_dir)],
        allow_network=True,
    )

    tab = Tab(id="tab-1", title="Task", leader_id="leader-1")
    tab.allow_network = True
    tab.write_dirs = [str(root_dir)]
    tab.permissions_initialized = True
    workspace_store.upsert_tab(tab)
    leader = _make_record(
        node_id="leader-1",
        tab_id=tab.id,
        role_name="Conductor",
        name="Leader",
        write_dirs=[str(root_dir)],
        allow_network=True,
    )
    keep_worker = _make_record(
        node_id="worker-keep",
        tab_id=tab.id,
        role_name="Worker",
        name="Keep Worker",
        write_dirs=[str(keep_dir)],
        allow_network=True,
    )
    drop_worker = _make_record(
        node_id="worker-drop",
        tab_id=tab.id,
        role_name="Worker",
        name="Drop Worker",
        write_dirs=[str(drop_dir)],
        allow_network=True,
    )
    workspace_store.upsert_node_record(leader)
    workspace_store.upsert_node_record(keep_worker)
    workspace_store.upsert_node_record(drop_worker)
    leader_live = _register_live_node(leader)
    keep_live = _register_live_node(keep_worker)
    drop_live = _register_live_node(drop_worker)
    assistant = Agent(
        NodeConfig(
            node_type=NodeType.ASSISTANT,
            tools=["set_permissions"],
            write_dirs=[str(root_dir)],
            allow_network=True,
        ),
        uuid="assistant",
    )

    result = json.loads(
        SetPermissionsTool().execute(
            assistant,
            {
                "workflow_id": tab.id,
                "allow_network": False,
                "write_dirs": [str(keep_boundary)],
            },
        )
    )

    assert result == {
        "tab_id": tab.id,
        "leader_id": "leader-1",
        "allow_network": False,
        "write_dirs": [str(keep_boundary)],
        "updated_node_ids": ["leader-1", "worker-keep", "worker-drop"],
    }
    updated_tab = workspace_store.get_tab(tab.id)
    assert updated_tab is not None
    assert updated_tab.allow_network is False
    assert updated_tab.write_dirs == [str(keep_boundary)]
    assert leader_live.config.allow_network is True
    assert leader_live.config.write_dirs == [str(root_dir)]
    assert keep_live.config.allow_network is True
    assert keep_live.config.write_dirs == [str(keep_dir)]
    assert drop_live.config.allow_network is True
    assert drop_live.config.write_dirs == [str(drop_dir)]


def test_set_permissions_keeps_omitted_fields_unchanged(monkeypatch, tmp_path):
    root_dir = tmp_path / "root"
    narrowed_dir = root_dir / "narrowed"
    root_dir.mkdir()
    narrowed_dir.mkdir()
    _grant_assistant_permissions(
        monkeypatch,
        write_dirs=[str(root_dir)],
        allow_network=False,
    )

    tab = Tab(id="tab-1", title="Task", leader_id="leader-1")
    tab.allow_network = True
    tab.write_dirs = [str(root_dir)]
    tab.permissions_initialized = True
    workspace_store.upsert_tab(tab)
    leader = _make_record(
        node_id="leader-1",
        tab_id=tab.id,
        role_name="Conductor",
        name="Leader",
        write_dirs=[str(root_dir)],
        allow_network=True,
    )
    workspace_store.upsert_node_record(leader)
    leader_live = _register_live_node(leader)
    assistant = Agent(
        NodeConfig(
            node_type=NodeType.ASSISTANT,
            tools=["set_permissions"],
            write_dirs=[str(root_dir)],
            allow_network=False,
        ),
        uuid="assistant",
    )

    result = json.loads(
        SetPermissionsTool().execute(
            assistant,
            {
                "workflow_id": tab.id,
                "write_dirs": [str(narrowed_dir)],
            },
        )
    )

    assert result["allow_network"] is True
    assert result["write_dirs"] == [str(narrowed_dir)]
    updated_tab = workspace_store.get_tab(tab.id)
    assert updated_tab is not None
    assert updated_tab.allow_network is True
    assert updated_tab.write_dirs == [str(narrowed_dir)]
    assert leader_live.config.allow_network is True
    assert leader_live.config.write_dirs == [str(root_dir)]


def test_set_permissions_broadens_workflow_boundary_without_mutating_workers(
    monkeypatch,
    tmp_path,
):
    root_dir = tmp_path / "root"
    current_boundary = root_dir / "current"
    worker_dir = current_boundary / "child"
    worker_dir.mkdir(parents=True)
    _grant_assistant_permissions(
        monkeypatch,
        write_dirs=[str(root_dir)],
        allow_network=True,
    )

    tab = Tab(id="tab-1", title="Task", leader_id="leader-1")
    tab.allow_network = False
    tab.write_dirs = [str(current_boundary)]
    tab.permissions_initialized = True
    workspace_store.upsert_tab(tab)
    leader = _make_record(
        node_id="leader-1",
        tab_id=tab.id,
        role_name="Conductor",
        name="Leader",
        write_dirs=[str(current_boundary)],
        allow_network=False,
    )
    worker = _make_record(
        node_id="worker-1",
        tab_id=tab.id,
        role_name="Worker",
        name="Worker",
        write_dirs=[str(worker_dir)],
        allow_network=False,
    )
    workspace_store.upsert_node_record(leader)
    workspace_store.upsert_node_record(worker)
    worker_live = _register_live_node(worker)
    assistant = Agent(
        NodeConfig(
            node_type=NodeType.ASSISTANT,
            tools=["set_permissions"],
            write_dirs=[str(root_dir)],
            allow_network=True,
        ),
        uuid="assistant",
    )

    result = json.loads(
        SetPermissionsTool().execute(
            assistant,
            {
                "workflow_id": tab.id,
                "allow_network": True,
                "write_dirs": [str(root_dir)],
            },
        )
    )

    assert result["allow_network"] is True
    assert result["write_dirs"] == [str(root_dir)]
    updated_tab = workspace_store.get_tab(tab.id)
    assert updated_tab is not None
    assert updated_tab.allow_network is True
    assert updated_tab.write_dirs == [str(root_dir)]
    assert worker_live.config.allow_network is False
    assert worker_live.config.write_dirs == [str(worker_dir)]


def test_set_permissions_rejects_allow_network_outside_caller_boundary(
    monkeypatch,
    tmp_path,
):
    root_dir = tmp_path / "root"
    root_dir.mkdir()
    _grant_assistant_permissions(
        monkeypatch,
        write_dirs=[str(root_dir)],
        allow_network=False,
    )

    tab = Tab(id="tab-1", title="Task", leader_id="leader-1")
    tab.allow_network = False
    tab.write_dirs = [str(root_dir)]
    tab.permissions_initialized = True
    workspace_store.upsert_tab(tab)
    workspace_store.upsert_node_record(
        _make_record(
            node_id="leader-1",
            tab_id=tab.id,
            role_name="Conductor",
            name="Leader",
            write_dirs=[str(root_dir)],
            allow_network=False,
        )
    )
    assistant = Agent(
        NodeConfig(
            node_type=NodeType.ASSISTANT,
            tools=["set_permissions"],
            write_dirs=[str(root_dir)],
            allow_network=False,
        ),
        uuid="assistant",
    )

    result = json.loads(
        SetPermissionsTool().execute(
            assistant,
            {
                "workflow_id": tab.id,
                "allow_network": True,
            },
        )
    )

    assert result == {
        "error": "allow_network boundary exceeded: caller disallows network access"
    }


def test_set_permissions_rejects_write_dirs_outside_caller_boundary(
    monkeypatch,
    tmp_path,
):
    caller_dir = tmp_path / "caller"
    other_dir = tmp_path / "other"
    caller_dir.mkdir()
    other_dir.mkdir()
    _grant_assistant_permissions(
        monkeypatch,
        write_dirs=[str(caller_dir)],
        allow_network=True,
    )

    tab = Tab(id="tab-1", title="Task", leader_id="leader-1")
    tab.allow_network = False
    tab.write_dirs = [str(caller_dir)]
    tab.permissions_initialized = True
    workspace_store.upsert_tab(tab)
    workspace_store.upsert_node_record(
        _make_record(
            node_id="leader-1",
            tab_id=tab.id,
            role_name="Conductor",
            name="Leader",
            write_dirs=[str(caller_dir)],
            allow_network=False,
        )
    )
    assistant = Agent(
        NodeConfig(
            node_type=NodeType.ASSISTANT,
            tools=["set_permissions"],
            write_dirs=[str(caller_dir)],
            allow_network=True,
        ),
        uuid="assistant",
    )

    result = json.loads(
        SetPermissionsTool().execute(
            assistant,
            {
                "workflow_id": tab.id,
                "write_dirs": [str(other_dir)],
            },
        )
    )

    assert result == {"error": f"write_dirs boundary exceeded: {other_dir}"}


def test_set_permissions_allows_explicitly_granted_non_assistant_agent(tmp_path):
    root_dir = tmp_path / "root"
    narrowed_dir = root_dir / "narrowed"
    root_dir.mkdir()
    narrowed_dir.mkdir()

    tab = Tab(id="tab-1", title="Task", leader_id="leader-1")
    tab.allow_network = True
    tab.write_dirs = [str(root_dir)]
    tab.permissions_initialized = True
    workspace_store.upsert_tab(tab)
    workspace_store.upsert_node_record(
        _make_record(
            node_id="leader-1",
            tab_id=tab.id,
            role_name="Conductor",
            name="Leader",
            write_dirs=[str(root_dir)],
            allow_network=True,
            tools=["set_permissions"],
        )
    )
    leader = Agent(
        NodeConfig(
            node_type=NodeType.AGENT,
            role_name="Conductor",
            tab_id=tab.id,
            name="Leader",
            tools=["set_permissions"],
            write_dirs=[str(root_dir)],
            allow_network=True,
        ),
        uuid="leader-1",
    )

    result = json.loads(
        SetPermissionsTool().execute(
            leader,
            {
                "workflow_id": tab.id,
                "write_dirs": [str(narrowed_dir)],
            },
        )
    )

    assert result["tab_id"] == tab.id
    assert result["write_dirs"] == [str(narrowed_dir)]


def test_set_permissions_migrates_legacy_leader_permissions(tmp_path):
    root_dir = tmp_path / "root"
    narrowed_dir = root_dir / "narrowed"
    root_dir.mkdir()
    narrowed_dir.mkdir()

    tab = Tab(id="tab-1", title="Task", leader_id="leader-1")
    workspace_store.upsert_tab(tab)
    workspace_store.upsert_node_record(
        _make_record(
            node_id="leader-1",
            tab_id=tab.id,
            role_name="Conductor",
            name="Leader",
            write_dirs=[str(root_dir)],
            allow_network=True,
            tools=["set_permissions"],
        )
    )
    leader = Agent(
        NodeConfig(
            node_type=NodeType.AGENT,
            role_name="Conductor",
            tab_id=tab.id,
            name="Leader",
            tools=["set_permissions"],
            write_dirs=[str(root_dir)],
            allow_network=True,
        ),
        uuid="leader-1",
    )

    result = json.loads(
        SetPermissionsTool().execute(
            leader,
            {
                "workflow_id": tab.id,
                "write_dirs": [str(narrowed_dir)],
            },
        )
    )

    updated_tab = workspace_store.get_tab(tab.id)
    assert result["allow_network"] is True
    assert result["write_dirs"] == [str(narrowed_dir)]
    assert updated_tab is not None
    assert updated_tab.permissions_initialized is True
    assert updated_tab.allow_network is True
    assert updated_tab.write_dirs == [str(narrowed_dir)]


def test_set_permissions_tool_schema_matches_patch_contract():
    assert SetPermissionsTool.parameters == {
        "type": "object",
        "properties": {
            "workflow_id": {
                "type": "string",
                "description": "ID of the workflow whose permission boundary should be updated",
            },
            "allow_network": {
                "type": "boolean",
                "description": "Optional patched network permission for the workflow boundary",
            },
            "write_dirs": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Optional patched writable directory boundary for the workflow",
            },
        },
        "required": ["workflow_id"],
    }
