import json

from flowent.agent import Agent
from flowent.models import NodeConfig, NodeType
from flowent.settings import (
    AssistantSettings,
    EventLogSettings,
    LeaderSettings,
    ModelSettings,
    ProviderConfig,
    RoleConfig,
    Settings,
    build_assistant_write_dirs,
)
from flowent.tools.manage_settings import ManageSettingsTool


def test_manage_settings_get_returns_current_settings(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT, tools=["manage_settings"]))
    settings = Settings(
        assistant=AssistantSettings(
            role_name="Steward",
            allow_network=False,
            write_dirs=["/tmp/workspace", "/tmp/output"],
        ),
        leader=LeaderSettings(role_name="Conductor"),
        event_log=EventLogSettings(timestamp_format="relative"),
        model=ModelSettings(active_provider_id="provider-1", active_model="gpt-4o"),
    )

    monkeypatch.setattr("flowent.settings.get_settings", lambda: settings)

    result = json.loads(ManageSettingsTool().execute(agent, {"action": "get"}))

    assert result == {
        "app_data_dir": settings.app_data_dir,
        "working_dir": settings.working_dir,
        "assistant": {
            "role_name": "Steward",
            "allow_network": False,
            "write_dirs": ["/tmp/workspace", "/tmp/output"],
        },
        "leader": {
            "role_name": "Conductor",
        },
        "model": {
            "active_provider_id": "provider-1",
            "active_model": "gpt-4o",
            "input_image": None,
            "output_image": None,
            "structured_output": None,
            "context_window_tokens": None,
            "capabilities": None,
            "resolved_context_window_tokens": None,
            "timeout_ms": 10000,
            "retry_policy": "limited",
            "max_retries": 5,
            "retry_initial_delay_seconds": 0.5,
            "retry_max_delay_seconds": 8.0,
            "retry_backoff_cap_retries": 5,
            "auto_compact_token_limit": None,
            "params": {
                "reasoning_effort": None,
                "verbosity": None,
                "max_output_tokens": None,
                "temperature": None,
                "top_p": None,
            },
        },
        "event_log": {
            "timestamp_format": "relative",
        },
    }


def test_manage_settings_update_changes_active_provider_and_model(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT, tools=["manage_settings"]))
    settings = Settings()
    saved: list[Settings] = []
    invalidations: list[str] = []

    monkeypatch.setattr("flowent.settings.get_settings", lambda: settings)
    monkeypatch.setattr(
        "flowent.settings.save_settings", lambda current: saved.append(current)
    )
    monkeypatch.setattr(
        "flowent.providers.gateway.gateway.invalidate_cache",
        lambda: invalidations.append("invalidate"),
    )

    result = json.loads(
        ManageSettingsTool().execute(
            agent,
            {
                "action": "update",
                "active_provider_id": "provider-2",
                "active_model": "gpt-4.1",
            },
        )
    )

    assert result["model"] == {
        "active_provider_id": "provider-2",
        "active_model": "gpt-4.1",
        "input_image": None,
        "output_image": None,
        "structured_output": None,
        "context_window_tokens": None,
        "capabilities": None,
        "resolved_context_window_tokens": None,
        "timeout_ms": 10000,
        "retry_policy": "limited",
        "max_retries": 5,
        "retry_initial_delay_seconds": 0.5,
        "retry_max_delay_seconds": 8.0,
        "retry_backoff_cap_retries": 5,
        "auto_compact_token_limit": None,
        "params": {
            "reasoning_effort": None,
            "verbosity": None,
            "max_output_tokens": None,
            "temperature": None,
            "top_p": None,
        },
    }
    assert settings.model.active_provider_id == "provider-2"
    assert settings.model.active_model == "gpt-4.1"
    assert saved == [settings]
    assert invalidations == ["invalidate"]


def test_manage_settings_update_changes_assistant_role(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT, tools=["manage_settings"]))
    settings = Settings(
        roles=[
            RoleConfig(name="Steward", system_prompt="Default assistant role."),
            RoleConfig(name="Reviewer", system_prompt="Review carefully."),
        ]
    )
    expected_write_dirs = list(settings.assistant.write_dirs)
    saved: list[Settings] = []

    monkeypatch.setattr("flowent.settings.get_settings", lambda: settings)
    monkeypatch.setattr(
        "flowent.settings.save_settings", lambda current: saved.append(current)
    )
    monkeypatch.setattr(
        "flowent.providers.gateway.gateway.invalidate_cache", lambda: None
    )

    result = json.loads(
        ManageSettingsTool().execute(
            agent,
            {
                "action": "update",
                "assistant_role_name": "Reviewer",
            },
        )
    )

    assert result["assistant"] == {
        "role_name": "Reviewer",
        "allow_network": True,
        "write_dirs": expected_write_dirs,
    }
    assert settings.assistant.role_name == "Reviewer"
    assert saved == [settings]


def test_manage_settings_update_changes_assistant_permissions(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT, tools=["manage_settings"]))
    settings = Settings()
    expected_write_dirs = build_assistant_write_dirs([" ./tmp ", "./tmp/", ""])

    monkeypatch.setattr("flowent.settings.get_settings", lambda: settings)
    monkeypatch.setattr("flowent.settings.save_settings", lambda current: None)
    monkeypatch.setattr(
        "flowent.providers.gateway.gateway.invalidate_cache", lambda: None
    )

    result = json.loads(
        ManageSettingsTool().execute(
            agent,
            {
                "action": "update",
                "assistant_allow_network": False,
                "assistant_write_dirs": [" ./tmp ", "./tmp/", ""],
            },
        )
    )

    assert result["assistant"] == {
        "role_name": "Steward",
        "allow_network": False,
        "write_dirs": expected_write_dirs,
    }
    assert settings.assistant.allow_network is False
    assert settings.assistant.write_dirs == expected_write_dirs


def test_manage_settings_update_changes_working_dir(monkeypatch, tmp_path):
    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT, tools=["manage_settings"]))
    settings = Settings()

    monkeypatch.setattr("flowent.settings.get_settings", lambda: settings)
    monkeypatch.setattr("flowent.settings.save_settings", lambda current: None)
    monkeypatch.setattr(
        "flowent.providers.gateway.gateway.invalidate_cache", lambda: None
    )

    result = json.loads(
        ManageSettingsTool().execute(
            agent,
            {
                "action": "update",
                "working_dir": str(tmp_path),
            },
        )
    )

    assert result["working_dir"] == str(tmp_path.resolve())
    assert settings.working_dir == str(tmp_path.resolve())


def test_manage_settings_update_resolves_write_dirs_against_new_working_dir(
    monkeypatch,
    tmp_path,
):
    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT, tools=["manage_settings"]))
    settings = Settings()
    target_dir = tmp_path / "project"
    target_dir.mkdir()

    monkeypatch.setattr("flowent.settings.get_settings", lambda: settings)
    monkeypatch.setattr("flowent.settings.save_settings", lambda current: None)
    monkeypatch.setattr(
        "flowent.providers.gateway.gateway.invalidate_cache", lambda: None
    )

    result = json.loads(
        ManageSettingsTool().execute(
            agent,
            {
                "action": "update",
                "working_dir": str(target_dir),
                "assistant_write_dirs": ["./out"],
            },
        )
    )

    assert result["working_dir"] == str(target_dir.resolve())
    assert result["assistant"]["write_dirs"] == [str((target_dir / "out").resolve())]
    assert settings.working_dir == str(target_dir.resolve())
    assert settings.assistant.write_dirs == [str((target_dir / "out").resolve())]


def test_manage_settings_update_rejects_blank_working_dir(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT, tools=["manage_settings"]))
    settings = Settings()

    monkeypatch.setattr("flowent.settings.get_settings", lambda: settings)

    result = json.loads(
        ManageSettingsTool().execute(
            agent,
            {
                "action": "update",
                "working_dir": "   ",
            },
        )
    )

    assert result == {"error": "working_dir must not be empty"}


def test_manage_settings_update_changes_leader_role(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT, tools=["manage_settings"]))
    settings = Settings(
        roles=[
            RoleConfig(name="Conductor", system_prompt="Default leader role."),
            RoleConfig(name="Reviewer", system_prompt="Review carefully."),
        ]
    )
    saved: list[Settings] = []

    monkeypatch.setattr("flowent.settings.get_settings", lambda: settings)
    monkeypatch.setattr(
        "flowent.settings.save_settings", lambda current: saved.append(current)
    )
    monkeypatch.setattr(
        "flowent.providers.gateway.gateway.invalidate_cache", lambda: None
    )

    result = json.loads(
        ManageSettingsTool().execute(
            agent,
            {
                "action": "update",
                "leader_role_name": "Reviewer",
            },
        )
    )

    assert result["leader"] == {"role_name": "Reviewer"}
    assert settings.leader.role_name == "Reviewer"
    assert saved == [settings]


def test_manage_settings_update_changes_max_retries(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT, tools=["manage_settings"]))
    settings = Settings()

    monkeypatch.setattr("flowent.settings.get_settings", lambda: settings)
    monkeypatch.setattr("flowent.settings.save_settings", lambda current: None)
    monkeypatch.setattr(
        "flowent.providers.gateway.gateway.invalidate_cache", lambda: None
    )

    result = json.loads(
        ManageSettingsTool().execute(
            agent,
            {
                "action": "update",
                "max_retries": 7,
            },
        )
    )

    assert result["model"]["max_retries"] == 7
    assert settings.model.max_retries == 7


def test_manage_settings_update_changes_retry_policy(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT, tools=["manage_settings"]))
    settings = Settings()

    monkeypatch.setattr("flowent.settings.get_settings", lambda: settings)
    monkeypatch.setattr("flowent.settings.save_settings", lambda current: None)
    monkeypatch.setattr(
        "flowent.providers.gateway.gateway.invalidate_cache", lambda: None
    )

    result = json.loads(
        ManageSettingsTool().execute(
            agent,
            {
                "action": "update",
                "retry_policy": "unlimited",
            },
        )
    )

    assert result["model"]["retry_policy"] == "unlimited"
    assert settings.model.retry_policy == "unlimited"


def test_manage_settings_update_changes_timeout_ms(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT, tools=["manage_settings"]))
    settings = Settings()

    monkeypatch.setattr("flowent.settings.get_settings", lambda: settings)
    monkeypatch.setattr("flowent.settings.save_settings", lambda current: None)
    monkeypatch.setattr(
        "flowent.providers.gateway.gateway.invalidate_cache", lambda: None
    )

    result = json.loads(
        ManageSettingsTool().execute(
            agent,
            {
                "action": "update",
                "timeout_ms": 15000,
            },
        )
    )

    assert result["model"]["timeout_ms"] == 15000
    assert settings.model.timeout_ms == 15000


def test_manage_settings_update_changes_retry_backoff(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT, tools=["manage_settings"]))
    settings = Settings()

    monkeypatch.setattr("flowent.settings.get_settings", lambda: settings)
    monkeypatch.setattr("flowent.settings.save_settings", lambda current: None)
    monkeypatch.setattr(
        "flowent.providers.gateway.gateway.invalidate_cache", lambda: None
    )

    result = json.loads(
        ManageSettingsTool().execute(
            agent,
            {
                "action": "update",
                "retry_initial_delay_seconds": 0.75,
                "retry_max_delay_seconds": 12.0,
                "retry_backoff_cap_retries": 3,
            },
        )
    )

    assert result["model"]["retry_initial_delay_seconds"] == 0.75
    assert result["model"]["retry_max_delay_seconds"] == 12.0
    assert result["model"]["retry_backoff_cap_retries"] == 3
    assert settings.model.retry_initial_delay_seconds == 0.75
    assert settings.model.retry_max_delay_seconds == 12.0
    assert settings.model.retry_backoff_cap_retries == 3


def test_manage_settings_update_changes_model_metadata_overrides_and_token_limit(
    monkeypatch,
):
    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT, tools=["manage_settings"]))
    settings = Settings(
        providers=[
            ProviderConfig(
                id="provider-1",
                name="Primary",
                type="openai_responses",
                base_url="https://api.example.com/v1",
                api_key="secret",
            )
        ]
    )
    settings.model.active_provider_id = "provider-1"
    settings.model.active_model = "gpt-5.2"

    monkeypatch.setattr("flowent.settings.get_settings", lambda: settings)
    monkeypatch.setattr("flowent.settings.save_settings", lambda current: None)
    monkeypatch.setattr(
        "flowent.providers.gateway.gateway.invalidate_cache", lambda: None
    )

    result = json.loads(
        ManageSettingsTool().execute(
            agent,
            {
                "action": "update",
                "context_window_tokens": 64000,
                "input_image": True,
                "output_image": False,
                "auto_compact_token_limit": 48000,
            },
        )
    )

    assert result["model"]["context_window_tokens"] == 64000
    assert result["model"]["resolved_context_window_tokens"] == 64000
    assert result["model"]["capabilities"] == {
        "input_image": True,
        "output_image": False,
        "structured_output": False,
    }
    assert result["model"]["auto_compact_token_limit"] == 48000
    assert settings.model.context_window_tokens == 64000
    assert settings.model.input_image is True
    assert settings.model.output_image is False
    assert settings.model.auto_compact_token_limit == 48000


def test_manage_settings_update_rejects_non_positive_timeout_ms(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT, tools=["manage_settings"]))
    settings = Settings()

    monkeypatch.setattr("flowent.settings.get_settings", lambda: settings)

    result = json.loads(
        ManageSettingsTool().execute(
            agent,
            {
                "action": "update",
                "timeout_ms": 0,
            },
        )
    )

    assert result == {"error": "timeout_ms must be greater than 0"}


def test_manage_settings_update_rejects_invalid_retry_policy(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT, tools=["manage_settings"]))
    settings = Settings()

    monkeypatch.setattr("flowent.settings.get_settings", lambda: settings)

    result = json.loads(
        ManageSettingsTool().execute(
            agent,
            {
                "action": "update",
                "retry_policy": "forever",
            },
        )
    )

    assert result == {
        "error": "retry_policy must be one of: limited, no_retry, unlimited"
    }


def test_manage_settings_update_rejects_retry_backoff_when_max_below_initial(
    monkeypatch,
):
    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT, tools=["manage_settings"]))
    settings = Settings()
    original_retry_initial_delay_seconds = settings.model.retry_initial_delay_seconds
    original_retry_max_delay_seconds = settings.model.retry_max_delay_seconds

    monkeypatch.setattr("flowent.settings.get_settings", lambda: settings)

    result = json.loads(
        ManageSettingsTool().execute(
            agent,
            {
                "action": "update",
                "retry_initial_delay_seconds": 2.0,
                "retry_max_delay_seconds": 1.0,
            },
        )
    )

    assert result == {
        "error": "model.retry_max_delay_seconds must be greater than or equal to model.retry_initial_delay_seconds"
    }
    assert (
        settings.model.retry_initial_delay_seconds
        == original_retry_initial_delay_seconds
    )
    assert settings.model.retry_max_delay_seconds == original_retry_max_delay_seconds


def test_manage_settings_update_rejects_unknown_assistant_role(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT, tools=["manage_settings"]))
    settings = Settings(roles=[RoleConfig(name="Steward", system_prompt="Default.")])

    monkeypatch.setattr("flowent.settings.get_settings", lambda: settings)

    result = json.loads(
        ManageSettingsTool().execute(
            agent,
            {
                "action": "update",
                "assistant_role_name": "Ghost",
            },
        )
    )

    assert result == {"error": "Role 'Ghost' not found"}


def test_manage_settings_update_rejects_invalid_assistant_allow_network(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT, tools=["manage_settings"]))
    settings = Settings()

    monkeypatch.setattr("flowent.settings.get_settings", lambda: settings)

    result = json.loads(
        ManageSettingsTool().execute(
            agent,
            {
                "action": "update",
                "assistant_allow_network": "yes",
            },
        )
    )

    assert result == {"error": "assistant_allow_network must be a boolean"}


def test_manage_settings_update_rejects_unknown_leader_role(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT, tools=["manage_settings"]))
    settings = Settings(roles=[RoleConfig(name="Conductor", system_prompt="Default.")])

    monkeypatch.setattr("flowent.settings.get_settings", lambda: settings)

    result = json.loads(
        ManageSettingsTool().execute(
            agent,
            {
                "action": "update",
                "leader_role_name": "Ghost",
            },
        )
    )

    assert result == {"error": "Role 'Ghost' not found"}


def test_manage_settings_update_accepts_xhigh_reasoning_effort(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT, tools=["manage_settings"]))
    settings = Settings()

    monkeypatch.setattr("flowent.settings.get_settings", lambda: settings)
    monkeypatch.setattr("flowent.settings.save_settings", lambda current: None)
    monkeypatch.setattr(
        "flowent.providers.gateway.gateway.invalidate_cache", lambda: None
    )

    result = json.loads(
        ManageSettingsTool().execute(
            agent,
            {
                "action": "update",
                "model_params": {"reasoning_effort": "xhigh"},
            },
        )
    )

    assert result["model"]["params"]["reasoning_effort"] == "xhigh"
    assert settings.model.params.reasoning_effort == "xhigh"
