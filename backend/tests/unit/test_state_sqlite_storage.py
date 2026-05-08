import base64
import sqlite3
import time

import flowent.settings as settings_module
from flowent.agent import Agent
from flowent.image_assets import create_image_asset
from flowent.mcp_service import MCPDiscoverySnapshot, MCPToolDescriptor, mcp_service
from flowent.models import NodeConfig, NodeType
from flowent.settings import MCPServerConfig, Settings

_ONE_PIXEL_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII="
)


def test_create_image_asset_persists_metadata_in_state_sqlite(monkeypatch, tmp_path):
    settings_file = tmp_path / "settings.json"
    settings_file.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(settings_module, "_SETTINGS_FILE", settings_file)
    monkeypatch.setattr(settings_module, "_cached_settings", None)

    asset = create_image_asset(
        _ONE_PIXEL_PNG,
        mime_type="image/png",
        original_name="pixel.png",
    )

    assert asset.file_path == tmp_path / "assets" / "images" / asset.stored_name
    assert asset.file_path.is_file()
    connection = sqlite3.connect(tmp_path / "state.sqlite")
    connection.row_factory = sqlite3.Row
    try:
        row = connection.execute(
            """
            SELECT stored_name, mime_type, width, height, original_name
            FROM image_assets
            WHERE id = ?
            """,
            (asset.id,),
        ).fetchone()
    finally:
        connection.close()
    assert row is not None
    assert row["stored_name"] == asset.stored_name
    assert row["mime_type"] == "image/png"
    assert row["width"] == 1
    assert row["height"] == 1
    assert row["original_name"] == "pixel.png"


def test_mcp_service_restores_persisted_snapshot_and_activity_after_runtime_clear(
    monkeypatch,
    tmp_path,
):
    settings_file = tmp_path / "settings.json"
    settings_file.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(settings_module, "_SETTINGS_FILE", settings_file)
    monkeypatch.setattr(settings_module, "_cached_settings", None)
    mcp_service.reset()
    now = time.time()

    try:
        mcp_service._set_snapshot(
            MCPDiscoverySnapshot(
                server_name="filesystem",
                transport="stdio",
                status="connected",
                auth_status="unsupported",
                last_refresh_result="success",
            )
        )
        mcp_service._record_activity(
            server_name="filesystem",
            action="refresh",
            actor_node_id=None,
            tab_id=None,
            started_at=now - 2.0,
            ended_at=now,
            result="success",
            summary="Capabilities refreshed",
        )

        mcp_service.clear_runtime_state()

        restored_snapshot = mcp_service._get_snapshot("filesystem")
        restored_activities = mcp_service.list_activities(server_name="filesystem")

        assert restored_snapshot is not None
        assert restored_snapshot.status == "connected"
        assert restored_snapshot.last_refresh_result == "success"
        assert len(restored_activities) == 1
        assert restored_activities[0].server_name == "filesystem"
        assert restored_activities[0].summary == "Capabilities refreshed"
    finally:
        mcp_service.reset()


def test_mcp_service_filters_workflow_management_tools_for_non_assistant(
    monkeypatch,
    tmp_path,
):
    settings_file = tmp_path / "settings.json"
    settings_file.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(settings_module, "_SETTINGS_FILE", settings_file)
    monkeypatch.setattr(settings_module, "_cached_settings", None)
    monkeypatch.setattr(
        "flowent.mcp_service.get_settings",
        lambda: Settings(
            mcp_servers=[
                MCPServerConfig(
                    name="flowent",
                    transport="stdio",
                )
            ]
        ),
    )
    mcp_service.reset()

    try:
        mcp_service._set_snapshot(
            MCPDiscoverySnapshot(
                server_name="flowent",
                transport="stdio",
                status="connected",
                auth_status="unsupported",
                tools=[
                    MCPToolDescriptor(
                        server_name="flowent",
                        tool_name="list_workflows",
                        fully_qualified_id="mcp__flowent__list_workflows",
                    ),
                    MCPToolDescriptor(
                        server_name="flowent",
                        tool_name="search_notes",
                        fully_qualified_id="mcp__flowent__search_notes",
                    ),
                ],
            )
        )
        worker = Agent(NodeConfig(node_type=NodeType.AGENT), uuid="worker")
        assistant = Agent(NodeConfig(node_type=NodeType.ASSISTANT), uuid="assistant")

        worker_tools = {
            descriptor.fully_qualified_id
            for descriptor in mcp_service.list_agent_dynamic_tools(worker)
        }
        assistant_tools = {
            descriptor.fully_qualified_id
            for descriptor in mcp_service.list_agent_dynamic_tools(assistant)
        }

        assert worker_tools == {"mcp__flowent__search_notes"}
        assert assistant_tools == {
            "mcp__flowent__list_workflows",
            "mcp__flowent__search_notes",
        }
    finally:
        mcp_service.reset()
