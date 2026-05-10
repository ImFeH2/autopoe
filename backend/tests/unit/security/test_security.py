from flowent.agent import Agent
from flowent.models import NodeConfig, NodeType
from flowent.security import authorize
from flowent.settings import Settings


def test_authorize_allows_edit_within_write_dirs(tmp_path):
    target = tmp_path / "allowed.txt"
    agent = Agent(
        NodeConfig(
            node_type=NodeType.AGENT,
            tools=["edit"],
            write_dirs=[str(tmp_path)],
        )
    )

    result = authorize("edit", agent, {"path": str(target)})

    assert result is None


def test_authorize_rejects_edit_when_write_dirs_empty(tmp_path):
    agent = Agent(
        NodeConfig(
            node_type=NodeType.AGENT,
            tools=["edit"],
            write_dirs=[],
        )
    )

    result = authorize("edit", agent, {"path": str(tmp_path / "blocked.txt")})

    assert result == "Write access is disabled for this workflow"


def test_authorize_rejects_edit_outside_write_dirs(tmp_path):
    allowed = tmp_path / "allowed"
    allowed.mkdir()
    blocked = tmp_path / "blocked.txt"
    agent = Agent(
        NodeConfig(
            node_type=NodeType.AGENT,
            tools=["edit"],
            write_dirs=[str(allowed)],
        )
    )

    result = authorize("edit", agent, {"path": str(blocked)})

    assert result == f"Path not in write_dirs: {blocked}"


def test_authorize_resolves_relative_write_dirs_against_working_dir(
    monkeypatch,
    tmp_path,
):
    allowed = tmp_path / "allowed"
    allowed.mkdir()
    agent = Agent(
        NodeConfig(
            node_type=NodeType.AGENT,
            tools=["edit"],
            write_dirs=["./allowed"],
        )
    )

    monkeypatch.setattr(
        "flowent.settings.get_settings",
        lambda: Settings(working_dir=str(tmp_path)),
    )

    result = authorize("edit", agent, {"path": str(allowed / "file.txt")})

    assert result is None


def test_authorize_allows_fetch_when_network_enabled():
    agent = Agent(
        NodeConfig(
            node_type=NodeType.AGENT,
            tools=["fetch"],
            allow_network=True,
        )
    )

    result = authorize("fetch", agent, {"url": "https://example.com"})

    assert result is None


def test_authorize_rejects_fetch_when_network_disabled():
    agent = Agent(
        NodeConfig(
            node_type=NodeType.AGENT,
            tools=["fetch"],
            allow_network=False,
        )
    )

    result = authorize("fetch", agent, {"url": "https://example.com"})

    assert result == "Network access is disabled for this workflow"


def test_authorize_allows_other_tools_by_default():
    agent = Agent(NodeConfig(node_type=NodeType.AGENT, tools=["exec"]))

    result = authorize("exec", agent, {"command": "pwd"})

    assert result is None


def test_authorize_rejects_assistant_only_tools_for_workflow_nodes():
    agent = Agent(
        NodeConfig(
            node_type=NodeType.AGENT,
            role_name="Worker",
            tools=["list_workflows"],
        )
    )

    result = authorize("list_workflows", agent, {})

    assert result == "Ask the Assistant to manage workflows or settings"


def test_authorize_rejects_mcp_prefixed_tools_for_assistant():
    agent = Agent(
        NodeConfig(
            node_type=NodeType.ASSISTANT,
            tools=["mcp__flowent__clone_workflow"],
        )
    )

    result = authorize("mcp__flowent__clone_workflow", agent, {})

    assert result == "Tool not found: mcp__flowent__clone_workflow"
