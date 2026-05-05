import json

from flowent.agent import Agent
from flowent.models import ModelInfo, NodeConfig, NodeType
from flowent.settings import (
    ModelSettings,
    ProviderConfig,
    RoleConfig,
    RoleModelConfig,
    Settings,
)
from flowent.tools.manage_providers import ManageProvidersTool


def test_manage_providers_list_omits_api_keys(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT, tools=["manage_providers"]))
    settings = Settings(
        providers=[
            ProviderConfig(
                id="provider-1",
                name="Primary",
                type="openai_compatible",
                base_url="https://api.example.com/v1",
                api_key="secret",
            )
        ]
    )

    monkeypatch.setattr("flowent.settings.get_settings", lambda: settings)

    result = json.loads(ManageProvidersTool().execute(agent, {"action": "list"}))

    assert result == [
        {
            "id": "provider-1",
            "name": "Primary",
            "type": "openai_compatible",
            "base_url": "https://api.example.com/v1",
            "headers": {},
            "retry_429_delay_seconds": 0,
            "models": [],
        }
    ]


def test_manage_providers_create_persists_provider(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT, tools=["manage_providers"]))
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
        ManageProvidersTool().execute(
            agent,
            {
                "action": "create",
                "name": "Test Provider",
                "type": "openai_compatible",
                "base_url": "https://api.example.com",
            },
        )
    )

    assert result["name"] == "Test Provider"
    assert result["type"] == "openai_compatible"
    assert result["base_url"] == "https://api.example.com"
    assert result["headers"] == {}
    assert result["retry_429_delay_seconds"] == 0
    assert "api_key" not in result
    assert len(settings.providers) == 1
    assert settings.providers[0].name == "Test Provider"
    assert settings.providers[0].base_url == "https://api.example.com"
    assert saved == [settings]
    assert invalidations == ["invalidate"]


def test_manage_providers_create_requires_fields(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT, tools=["manage_providers"]))

    result = json.loads(
        ManageProvidersTool().execute(
            agent,
            {
                "action": "create",
                "type": "openai_compatible",
                "base_url": "https://api.example.com/v1",
            },
        )
    )

    assert result == {"error": "name is required"}


def test_manage_providers_update_changes_only_supplied_fields(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT, tools=["manage_providers"]))
    settings = Settings(
        providers=[
            ProviderConfig(
                id="provider-1",
                name="Old Name",
                type="openai_compatible",
                base_url="https://old.example.com/v1",
                api_key="secret",
            )
        ]
    )
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
        ManageProvidersTool().execute(
            agent,
            {
                "action": "update",
                "id": "provider-1",
                "base_url": "https://new.example.com",
            },
        )
    )

    assert result == {
        "id": "provider-1",
        "name": "Old Name",
        "type": "openai_compatible",
        "base_url": "https://new.example.com",
        "headers": {},
        "retry_429_delay_seconds": 0,
        "models": [],
    }
    assert settings.providers[0].name == "Old Name"
    assert settings.providers[0].type == "openai_compatible"
    assert settings.providers[0].base_url == "https://new.example.com"
    assert settings.providers[0].api_key == "secret"
    assert saved == [settings]
    assert invalidations == ["invalidate"]


def test_manage_providers_create_persists_headers(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT, tools=["manage_providers"]))
    settings = Settings()

    monkeypatch.setattr("flowent.settings.get_settings", lambda: settings)
    monkeypatch.setattr("flowent.settings.save_settings", lambda current: None)
    monkeypatch.setattr(
        "flowent.providers.gateway.gateway.invalidate_cache", lambda: None
    )

    result = json.loads(
        ManageProvidersTool().execute(
            agent,
            {
                "action": "create",
                "name": "Test Provider",
                "type": "openai_compatible",
                "base_url": "https://api.example.com",
                "headers": {"X-Test": "value"},
            },
        )
    )

    assert result["headers"] == {"X-Test": "value"}
    assert settings.providers[0].headers == {"X-Test": "value"}


def test_manage_providers_update_persists_headers(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT, tools=["manage_providers"]))
    settings = Settings(
        providers=[
            ProviderConfig(
                id="provider-1",
                name="Old Name",
                type="openai_compatible",
                base_url="https://old.example.com/v1",
                api_key="secret",
                headers={"X-Old": "value"},
            )
        ]
    )

    monkeypatch.setattr("flowent.settings.get_settings", lambda: settings)
    monkeypatch.setattr("flowent.settings.save_settings", lambda current: None)
    monkeypatch.setattr(
        "flowent.providers.gateway.gateway.invalidate_cache", lambda: None
    )

    result = json.loads(
        ManageProvidersTool().execute(
            agent,
            {
                "action": "update",
                "id": "provider-1",
                "headers": {"X-New": "next"},
                "retry_429_delay_seconds": 4,
            },
        )
    )

    assert result["headers"] == {"X-New": "next"}
    assert result["retry_429_delay_seconds"] == 4
    assert settings.providers[0].headers == {"X-New": "next"}
    assert settings.providers[0].retry_429_delay_seconds == 4


def test_manage_providers_rejects_non_string_header_values(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT, tools=["manage_providers"]))
    monkeypatch.setattr("flowent.settings.get_settings", lambda: Settings())

    result = json.loads(
        ManageProvidersTool().execute(
            agent,
            {
                "action": "create",
                "name": "Test Provider",
                "type": "openai_compatible",
                "base_url": "https://api.example.com",
                "headers": {"X-Test": 1},
            },
        )
    )

    assert result == {"error": "headers must be a JSON object of string values"}


def test_manage_providers_rejects_negative_retry_429_delay(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT, tools=["manage_providers"]))
    monkeypatch.setattr("flowent.settings.get_settings", lambda: Settings())

    result = json.loads(
        ManageProvidersTool().execute(
            agent,
            {
                "action": "create",
                "name": "Test Provider",
                "type": "openai_compatible",
                "base_url": "https://api.example.com",
                "retry_429_delay_seconds": -1,
            },
        )
    )

    assert result == {
        "error": "retry_429_delay_seconds must be greater than or equal to 0"
    }


def test_manage_providers_update_rejects_unknown_provider(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT, tools=["manage_providers"]))
    monkeypatch.setattr("flowent.settings.get_settings", lambda: Settings())

    result = json.loads(
        ManageProvidersTool().execute(
            agent,
            {"action": "update", "id": "missing", "name": "Next"},
        )
    )

    assert result == {"error": "Provider 'missing' not found"}


def test_manage_providers_update_rejects_mismatched_base_url_suffix(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT, tools=["manage_providers"]))
    settings = Settings(
        providers=[
            ProviderConfig(
                id="provider-1",
                name="Primary",
                type="openai_compatible",
                base_url="https://api.example.com/v1",
                api_key="secret",
            )
        ]
    )

    monkeypatch.setattr("flowent.settings.get_settings", lambda: settings)

    result = json.loads(
        ManageProvidersTool().execute(
            agent,
            {"action": "update", "id": "provider-1", "type": "gemini"},
        )
    )

    assert result == {
        "error": "Provider base_url suffix '/v1' does not match type 'gemini' "
        "(expected '/v1beta')"
    }


def test_manage_providers_delete_removes_provider(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT, tools=["manage_providers"]))
    settings = Settings(
        providers=[
            ProviderConfig(
                id="provider-1",
                name="Delete Me",
                type="openai_compatible",
                base_url="https://api.example.com/v1",
                api_key="secret",
            )
        ]
    )
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
        ManageProvidersTool().execute(
            agent,
            {"action": "delete", "id": "provider-1"},
        )
    )

    assert result == {"status": "deleted"}
    assert settings.providers == []
    assert saved == [settings]
    assert invalidations == ["invalidate"]


def test_manage_providers_delete_clears_active_model_for_active_provider(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT, tools=["manage_providers"]))
    settings = Settings(
        model=ModelSettings(active_provider_id="provider-1", active_model="gpt-4o"),
        providers=[
            ProviderConfig(
                id="provider-1",
                name="Primary",
                type="openai_compatible",
                base_url="https://api.example.com/v1",
                api_key="secret",
            )
        ],
    )

    monkeypatch.setattr("flowent.settings.get_settings", lambda: settings)
    monkeypatch.setattr("flowent.settings.save_settings", lambda current: None)
    monkeypatch.setattr(
        "flowent.providers.gateway.gateway.invalidate_cache", lambda: None
    )

    result = json.loads(
        ManageProvidersTool().execute(
            agent,
            {"action": "delete", "id": "provider-1"},
        )
    )

    assert result == {"status": "deleted"}
    assert settings.model.active_provider_id == ""
    assert settings.model.active_model == ""


def test_manage_providers_delete_clears_role_model_references(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT, tools=["manage_providers"]))
    settings = Settings(
        providers=[
            ProviderConfig(
                id="provider-1",
                name="Primary",
                type="openai_compatible",
                base_url="https://api.example.com/v1",
                api_key="secret",
            )
        ],
        roles=[
            RoleConfig(
                name="Reviewer",
                system_prompt="Review carefully",
                model=RoleModelConfig(
                    provider_id="provider-1",
                    model="gpt-4.1-mini",
                ),
            )
        ],
    )

    monkeypatch.setattr("flowent.settings.get_settings", lambda: settings)
    monkeypatch.setattr("flowent.settings.save_settings", lambda current: None)
    monkeypatch.setattr(
        "flowent.providers.gateway.gateway.invalidate_cache", lambda: None
    )

    result = json.loads(
        ManageProvidersTool().execute(
            agent,
            {"action": "delete", "id": "provider-1"},
        )
    )

    assert result == {"status": "deleted"}
    assert settings.roles[0].model is None


def test_manage_providers_list_models_streams_model_ids(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT, tools=["manage_providers"]))
    chunks: list[str] = []

    monkeypatch.setattr("flowent.settings.get_settings", lambda: Settings())
    monkeypatch.setattr(
        "flowent.providers.gateway.gateway.list_models_for",
        lambda provider_id, register_interrupt=None: [
            ModelInfo(id=f"{provider_id}-a"),
            ModelInfo(id=f"{provider_id}-b"),
        ],
    )

    result = json.loads(
        ManageProvidersTool().execute(
            agent,
            {"action": "list_models", "id": "provider-1"},
            on_output=chunks.append,
        )
    )

    assert result == [
        {
            "model": "provider-1-a",
            "source": "discovered",
            "context_window_tokens": None,
            "input_image": False,
            "output_image": False,
            "structured_output": False,
        },
        {
            "model": "provider-1-b",
            "source": "discovered",
            "context_window_tokens": None,
            "input_image": False,
            "output_image": False,
            "structured_output": False,
        },
    ]
    assert "".join(chunks) == (
        "Listing models for provider-1\nprovider-1-a\nprovider-1-b\n"
    )
