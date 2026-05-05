import asyncio
from pathlib import Path

import pytest
from fastapi import HTTPException

from flowent.access import set_access_code, verify_access_code
from flowent.agent import Agent
from flowent.models import NodeConfig, NodeType, SystemEntry
from flowent.prompts.steward import STEWARD_ROLE_SYSTEM_PROMPT
from flowent.registry import registry
from flowent.routes.settings import (
    UpdateSettingsRequest,
    UpdateTelegramSettingsRequest,
    approve_telegram_chat,
    delete_pending_telegram_chat,
    delete_telegram_chat,
    get_settings_api,
    get_settings_bootstrap,
    get_telegram_settings,
    update_settings,
    update_telegram_settings,
)
from flowent.settings import (
    ProviderConfig,
    RoleConfig,
    Settings,
    TelegramApprovedChat,
    TelegramPendingChat,
    TelegramSettings,
    build_default_assistant_write_dirs,
)


def test_get_settings_returns_assistant_configuration(monkeypatch):
    settings = Settings(
        roles=[RoleConfig(name="Steward", system_prompt="Default assistant role.")]
    )

    monkeypatch.setattr("flowent.routes.settings.get_settings", lambda: settings)

    result = asyncio.run(get_settings_api())

    assert result["assistant"] == {
        "role_name": "Steward",
        "allow_network": True,
        "write_dirs": build_default_assistant_write_dirs(),
    }
    assert result["leader"] == {"role_name": "Conductor"}


def test_get_settings_bootstrap_returns_related_resources(monkeypatch):
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
                name="Steward",
                description="Default assistant role.",
                system_prompt="Default assistant role.",
            )
        ],
    )

    monkeypatch.setattr("flowent.routes.settings.get_settings", lambda: settings)
    monkeypatch.setattr("flowent._version.__version__", "1.2.3")

    result = asyncio.run(get_settings_bootstrap())

    assert result == {
        "settings": {
            "app_data_dir": settings.app_data_dir,
            "working_dir": settings.working_dir,
            "event_log": {"timestamp_format": "absolute"},
            "access": {"configured": False},
            "assistant": {
                "role_name": "Steward",
                "allow_network": True,
                "write_dirs": build_default_assistant_write_dirs(),
            },
            "leader": {"role_name": "Conductor"},
            "telegram": {
                "bot_token": "",
                "pending_chats": [],
                "approved_chats": [],
            },
            "model": {
                "active_provider_id": "",
                "active_model": "",
                "input_image": None,
                "output_image": None,
                "structured_output": None,
                "capabilities": None,
                "context_window_tokens": None,
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
            "custom_prompt": "",
            "custom_post_prompt": "",
            "providers": [
                {
                    "id": "provider-1",
                    "name": "Primary",
                    "type": "openai_compatible",
                    "base_url": "https://api.example.com/v1",
                    "api_key": "secret",
                    "headers": {},
                    "retry_429_delay_seconds": 0,
                    "models": [],
                }
            ],
            "roles": [
                {
                    "name": "Steward",
                    "description": "Default assistant role.",
                    "system_prompt": "Default assistant role.",
                    "model": None,
                    "model_params": None,
                    "included_tools": [],
                    "excluded_tools": [],
                }
            ],
            "mcp_servers": [],
        },
        "providers": [
            {
                "id": "provider-1",
                "name": "Primary",
                "type": "openai_compatible",
                "base_url": "https://api.example.com/v1",
                "api_key": "secret",
                "headers": {},
                "retry_429_delay_seconds": 0,
                "models": [],
            }
        ],
        "roles": [
            {
                "name": "Steward",
                "description": "Default assistant role.",
                "system_prompt": "Default assistant role.",
                "model": None,
                "model_params": None,
                "included_tools": [],
                "excluded_tools": [],
                "is_builtin": True,
            }
        ],
        "version": "1.2.3",
    }


def test_get_telegram_settings_masks_bot_token(monkeypatch):
    settings = Settings(
        telegram=TelegramSettings(
            bot_token="123456:ABCDE",
            pending_chats=[
                TelegramPendingChat(
                    chat_id=1001,
                    username="alice",
                    display_name="Alice",
                    first_seen_at=1.0,
                    last_seen_at=2.0,
                )
            ],
            approved_chats=[
                TelegramApprovedChat(
                    chat_id=-2002,
                    username="bob",
                    display_name="Bob",
                    approved_at=3.0,
                )
            ],
        )
    )

    monkeypatch.setattr("flowent.routes.settings.get_settings", lambda: settings)

    result = asyncio.run(get_telegram_settings())

    assert result == {
        "bot_token": "sk-...BCDE",
        "pending_chats": [
            {
                "chat_id": 1001,
                "username": "alice",
                "display_name": "Alice",
                "first_seen_at": 1.0,
                "last_seen_at": 2.0,
            }
        ],
        "approved_chats": [
            {
                "chat_id": -2002,
                "username": "bob",
                "display_name": "Bob",
                "approved_at": 3.0,
            }
        ],
    }


def test_update_telegram_settings_restarts_channel_when_token_changes(monkeypatch):
    settings = Settings(
        telegram=TelegramSettings(
            bot_token="old-token",
            pending_chats=[
                TelegramPendingChat(
                    chat_id=1001,
                    username="alice",
                    display_name="Alice",
                    first_seen_at=1.0,
                    last_seen_at=2.0,
                )
            ],
            approved_chats=[
                TelegramApprovedChat(
                    chat_id=-2002,
                    username="bob",
                    display_name="Bob",
                    approved_at=3.0,
                )
            ],
        )
    )
    saved: list[Settings] = []
    restarted: list[str] = []

    monkeypatch.setattr("flowent.routes.settings.get_settings", lambda: settings)
    monkeypatch.setattr(
        "flowent.routes.settings.save_settings",
        lambda current: saved.append(current),
    )
    monkeypatch.setattr(
        "flowent.runtime.restart_telegram_channel",
        lambda: restarted.append("restart"),
    )

    result = asyncio.run(
        update_telegram_settings(
            UpdateTelegramSettingsRequest(
                bot_token="new-token",
            )
        )
    )

    assert settings.telegram == TelegramSettings(
        bot_token="new-token",
        pending_chats=[
            TelegramPendingChat(
                chat_id=1001,
                username="alice",
                display_name="Alice",
                first_seen_at=1.0,
                last_seen_at=2.0,
            )
        ],
        approved_chats=[
            TelegramApprovedChat(
                chat_id=-2002,
                username="bob",
                display_name="Bob",
                approved_at=3.0,
            )
        ],
    )
    assert saved == [settings]
    assert restarted == ["restart"]
    assert result == {
        "status": "saved",
        "telegram": {
            "bot_token": "sk-...oken",
            "pending_chats": [
                {
                    "chat_id": 1001,
                    "username": "alice",
                    "display_name": "Alice",
                    "first_seen_at": 1.0,
                    "last_seen_at": 2.0,
                }
            ],
            "approved_chats": [
                {
                    "chat_id": -2002,
                    "username": "bob",
                    "display_name": "Bob",
                    "approved_at": 3.0,
                }
            ],
        },
    }


def test_approve_telegram_chat_moves_pending_chat_to_approved(monkeypatch):
    settings = Settings(
        telegram=TelegramSettings(
            bot_token="token",
            pending_chats=[
                TelegramPendingChat(
                    chat_id=3003,
                    username="alice",
                    display_name="Alice",
                    first_seen_at=1.0,
                    last_seen_at=2.0,
                )
            ],
            approved_chats=[],
        )
    )
    saved: list[Settings] = []

    monkeypatch.setattr("flowent.routes.settings.get_settings", lambda: settings)
    monkeypatch.setattr(
        "flowent.routes.settings.save_settings",
        lambda current: saved.append(current),
    )
    monkeypatch.setattr("flowent.routes.settings.time.time", lambda: 42.0)

    result = asyncio.run(approve_telegram_chat(3003))

    assert settings.telegram.pending_chats == []
    assert settings.telegram.approved_chats == [
        TelegramApprovedChat(
            chat_id=3003,
            username="alice",
            display_name="Alice",
            approved_at=42.0,
        )
    ]
    assert saved == [settings]
    assert result == {
        "status": "approved",
        "telegram": {
            "bot_token": "sk-...oken",
            "pending_chats": [],
            "approved_chats": [
                {
                    "chat_id": 3003,
                    "username": "alice",
                    "display_name": "Alice",
                    "approved_at": 42.0,
                }
            ],
        },
    }


def test_delete_pending_telegram_chat_removes_pending_chat(monkeypatch):
    settings = Settings(
        telegram=TelegramSettings(
            bot_token="token",
            pending_chats=[
                TelegramPendingChat(
                    chat_id=3003,
                    username="alice",
                    display_name="Alice",
                    first_seen_at=1.0,
                    last_seen_at=2.0,
                )
            ],
        )
    )
    saved: list[Settings] = []

    monkeypatch.setattr("flowent.routes.settings.get_settings", lambda: settings)
    monkeypatch.setattr(
        "flowent.routes.settings.save_settings",
        lambda current: saved.append(current),
    )

    result = asyncio.run(delete_pending_telegram_chat(3003))

    assert settings.telegram.pending_chats == []
    assert saved == [settings]
    assert result == {
        "status": "deleted",
        "telegram": {
            "bot_token": "sk-...oken",
            "pending_chats": [],
            "approved_chats": [],
        },
    }


def test_delete_telegram_chat_removes_approved_chat(monkeypatch):
    settings = Settings(
        telegram=TelegramSettings(
            bot_token="token",
            approved_chats=[
                TelegramApprovedChat(
                    chat_id=-2002,
                    username="bob",
                    display_name="Bob",
                    approved_at=3.0,
                ),
                TelegramApprovedChat(
                    chat_id=3003,
                    username="alice",
                    display_name="Alice",
                    approved_at=4.0,
                ),
            ],
        )
    )
    saved: list[Settings] = []

    monkeypatch.setattr("flowent.routes.settings.get_settings", lambda: settings)
    monkeypatch.setattr(
        "flowent.routes.settings.save_settings",
        lambda current: saved.append(current),
    )

    result = asyncio.run(delete_telegram_chat(-2002))

    assert settings.telegram.approved_chats == [
        TelegramApprovedChat(
            chat_id=3003,
            username="alice",
            display_name="Alice",
            approved_at=4.0,
        )
    ]
    assert saved == [settings]
    assert result == {
        "status": "deleted",
        "telegram": {
            "bot_token": "sk-...oken",
            "pending_chats": [],
            "approved_chats": [
                {
                    "chat_id": 3003,
                    "username": "alice",
                    "display_name": "Alice",
                    "approved_at": 4.0,
                }
            ],
        },
    }


def test_update_settings_accepts_xhigh_reasoning_effort(monkeypatch):
    settings = Settings(
        roles=[RoleConfig(name="Steward", system_prompt="Default assistant role.")]
    )
    saved: list[Settings] = []

    monkeypatch.setattr("flowent.routes.settings.get_settings", lambda: settings)
    monkeypatch.setattr(
        "flowent.routes.settings.save_settings",
        lambda current: saved.append(current),
    )
    monkeypatch.setattr(
        "flowent.providers.gateway.gateway.invalidate_cache", lambda: None
    )

    result = asyncio.run(
        update_settings(
            UpdateSettingsRequest(
                model={"params": {"reasoning_effort": "xhigh"}},
            )
        )
    )

    assert settings.model.params.reasoning_effort == "xhigh"
    assert result["settings"]["model"]["params"]["reasoning_effort"] == "xhigh"
    assert saved == [settings]


def test_update_settings_rotates_access_code_and_requires_reauth(monkeypatch):
    settings = Settings(
        roles=[RoleConfig(name="Steward", system_prompt="Default assistant role.")]
    )
    set_access_code(settings, "OLD-ACCESS-CODE")
    saved: list[Settings] = []
    closed: list[dict[str, object]] = []

    monkeypatch.setattr("flowent.routes.settings.get_settings", lambda: settings)
    monkeypatch.setattr(
        "flowent.routes.settings.save_settings",
        lambda current: saved.append(current),
    )
    monkeypatch.setattr(
        "flowent.providers.gateway.gateway.invalidate_cache", lambda: None
    )
    monkeypatch.setattr(
        "flowent.routes.settings.event_bus.close_all_connections",
        lambda **kwargs: closed.append(kwargs),
    )

    result = asyncio.run(
        update_settings(
            UpdateSettingsRequest(
                access={
                    "new_code": "NEW-ACCESS-CODE",
                    "confirm_code": "NEW-ACCESS-CODE",
                }
            )
        )
    )

    assert verify_access_code(settings.access, "NEW-ACCESS-CODE")
    assert not verify_access_code(settings.access, "OLD-ACCESS-CODE")
    assert saved == [settings]
    assert result["reauth_required"] is True
    assert result["settings"]["access"] == {"configured": True}
    assert closed == [{"code": 4001, "reason": "Access code rotated"}]


def test_update_settings_does_not_mutate_cached_access_when_save_fails(monkeypatch):
    settings = Settings(
        roles=[RoleConfig(name="Steward", system_prompt="Default assistant role.")]
    )
    set_access_code(settings, "OLD-ACCESS-CODE")

    monkeypatch.setattr("flowent.routes.settings.get_settings", lambda: settings)
    monkeypatch.setattr(
        "flowent.routes.settings.save_settings",
        lambda current: (_ for _ in ()).throw(RuntimeError("disk full")),
    )

    with pytest.raises(RuntimeError, match="disk full"):
        asyncio.run(
            update_settings(
                UpdateSettingsRequest(
                    access={
                        "new_code": "NEW-ACCESS-CODE",
                        "confirm_code": "NEW-ACCESS-CODE",
                    }
                )
            )
        )

    assert verify_access_code(settings.access, "OLD-ACCESS-CODE")
    assert not verify_access_code(settings.access, "NEW-ACCESS-CODE")


def test_update_settings_accepts_model_max_retries(monkeypatch):
    settings = Settings(
        roles=[RoleConfig(name="Steward", system_prompt="Default assistant role.")]
    )
    saved: list[Settings] = []

    monkeypatch.setattr("flowent.routes.settings.get_settings", lambda: settings)
    monkeypatch.setattr(
        "flowent.routes.settings.save_settings",
        lambda current: saved.append(current),
    )
    monkeypatch.setattr(
        "flowent.providers.gateway.gateway.invalidate_cache", lambda: None
    )

    result = asyncio.run(
        update_settings(
            UpdateSettingsRequest(
                model={"max_retries": 8},
            )
        )
    )

    assert settings.model.max_retries == 8
    assert result["settings"]["model"]["max_retries"] == 8
    assert saved == [settings]


def test_update_settings_accepts_model_metadata_overrides_and_token_limit(
    monkeypatch,
):
    settings = Settings(
        providers=[
            ProviderConfig(
                id="provider-1",
                name="Primary",
                type="openai_responses",
                base_url="https://api.example.com/v1",
                api_key="secret",
            )
        ],
        roles=[RoleConfig(name="Steward", system_prompt="Default assistant role.")],
    )
    settings.model.active_provider_id = "provider-1"
    settings.model.active_model = "gpt-5.2"
    saved: list[Settings] = []

    monkeypatch.setattr("flowent.routes.settings.get_settings", lambda: settings)
    monkeypatch.setattr(
        "flowent.routes.settings.save_settings",
        lambda current: saved.append(current),
    )
    monkeypatch.setattr(
        "flowent.providers.gateway.gateway.invalidate_cache", lambda: None
    )

    result = asyncio.run(
        update_settings(
            UpdateSettingsRequest(
                model={
                    "context_window_tokens": 64000,
                    "input_image": True,
                    "output_image": False,
                    "structured_output": True,
                    "auto_compact_token_limit": 48000,
                },
            )
        )
    )

    assert settings.model.context_window_tokens == 64000
    assert settings.model.input_image is True
    assert settings.model.output_image is False
    assert settings.model.structured_output is True
    assert settings.model.auto_compact_token_limit == 48000
    assert result["settings"]["model"]["context_window_tokens"] == 64000
    assert result["settings"]["model"]["resolved_context_window_tokens"] == 64000
    assert result["settings"]["model"]["capabilities"] == {
        "input_image": True,
        "output_image": False,
        "structured_output": True,
    }
    assert result["settings"]["model"]["auto_compact_token_limit"] == 48000
    assert saved == [settings]


def test_update_settings_accepts_model_retry_policy(monkeypatch):
    settings = Settings(
        roles=[RoleConfig(name="Steward", system_prompt="Default assistant role.")]
    )
    saved: list[Settings] = []

    monkeypatch.setattr("flowent.routes.settings.get_settings", lambda: settings)
    monkeypatch.setattr(
        "flowent.routes.settings.save_settings",
        lambda current: saved.append(current),
    )
    monkeypatch.setattr(
        "flowent.providers.gateway.gateway.invalidate_cache", lambda: None
    )

    result = asyncio.run(
        update_settings(
            UpdateSettingsRequest(
                model={"retry_policy": "unlimited"},
            )
        )
    )

    assert settings.model.retry_policy == "unlimited"
    assert result["settings"]["model"]["retry_policy"] == "unlimited"
    assert saved == [settings]


def test_update_settings_rejects_invalid_model_retry_policy(monkeypatch):
    settings = Settings(
        roles=[RoleConfig(name="Steward", system_prompt="Default assistant role.")]
    )

    monkeypatch.setattr("flowent.routes.settings.get_settings", lambda: settings)

    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(
            update_settings(
                UpdateSettingsRequest(
                    model={"retry_policy": "forever"},
                )
            )
        )

    assert excinfo.value.status_code == 400
    assert (
        excinfo.value.detail
        == "model.retry_policy must be one of: limited, no_retry, unlimited"
    )


def test_update_settings_accepts_model_timeout_ms(monkeypatch):
    settings = Settings(
        roles=[RoleConfig(name="Steward", system_prompt="Default assistant role.")]
    )
    saved: list[Settings] = []

    monkeypatch.setattr("flowent.routes.settings.get_settings", lambda: settings)
    monkeypatch.setattr(
        "flowent.routes.settings.save_settings",
        lambda current: saved.append(current),
    )
    monkeypatch.setattr(
        "flowent.providers.gateway.gateway.invalidate_cache", lambda: None
    )

    result = asyncio.run(
        update_settings(
            UpdateSettingsRequest(
                model={"timeout_ms": 15000},
            )
        )
    )

    assert settings.model.timeout_ms == 15000
    assert result["settings"]["model"]["timeout_ms"] == 15000
    assert saved == [settings]


def test_update_settings_accepts_retry_backoff_fields(monkeypatch):
    settings = Settings(
        roles=[RoleConfig(name="Steward", system_prompt="Default assistant role.")]
    )
    saved: list[Settings] = []

    monkeypatch.setattr("flowent.routes.settings.get_settings", lambda: settings)
    monkeypatch.setattr(
        "flowent.routes.settings.save_settings",
        lambda current: saved.append(current),
    )
    monkeypatch.setattr(
        "flowent.providers.gateway.gateway.invalidate_cache", lambda: None
    )

    result = asyncio.run(
        update_settings(
            UpdateSettingsRequest(
                model={
                    "retry_initial_delay_seconds": 0.75,
                    "retry_max_delay_seconds": 12.0,
                    "retry_backoff_cap_retries": 3,
                },
            )
        )
    )

    assert settings.model.retry_initial_delay_seconds == 0.75
    assert settings.model.retry_max_delay_seconds == 12.0
    assert settings.model.retry_backoff_cap_retries == 3
    assert result["settings"]["model"]["retry_initial_delay_seconds"] == 0.75
    assert result["settings"]["model"]["retry_max_delay_seconds"] == 12.0
    assert result["settings"]["model"]["retry_backoff_cap_retries"] == 3
    assert saved == [settings]


def test_update_settings_rejects_retry_backoff_when_max_below_initial(monkeypatch):
    settings = Settings(
        roles=[RoleConfig(name="Steward", system_prompt="Default assistant role.")]
    )

    monkeypatch.setattr("flowent.routes.settings.get_settings", lambda: settings)

    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(
            update_settings(
                UpdateSettingsRequest(
                    model={
                        "retry_initial_delay_seconds": 1.5,
                        "retry_max_delay_seconds": 1.0,
                    },
                )
            )
        )

    assert excinfo.value.status_code == 400
    assert (
        excinfo.value.detail
        == "model.retry_max_delay_seconds must be greater than or equal to model.retry_initial_delay_seconds"
    )


def test_update_settings_rejects_non_positive_model_timeout_ms(monkeypatch):
    settings = Settings(
        roles=[RoleConfig(name="Steward", system_prompt="Default assistant role.")]
    )

    monkeypatch.setattr("flowent.routes.settings.get_settings", lambda: settings)

    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(
            update_settings(
                UpdateSettingsRequest(
                    model={"timeout_ms": 0},
                )
            )
        )

    assert excinfo.value.status_code == 400
    assert excinfo.value.detail == "model.timeout_ms must be greater than 0"


def test_update_settings_persists_assistant_role(monkeypatch):
    settings = Settings(
        roles=[
            RoleConfig(name="Steward", system_prompt="Default assistant role."),
            RoleConfig(name="Reviewer", system_prompt="Review carefully."),
        ]
    )
    saved: list[Settings] = []

    monkeypatch.setattr("flowent.routes.settings.get_settings", lambda: settings)
    monkeypatch.setattr(
        "flowent.routes.settings.save_settings",
        lambda current: saved.append(current),
    )
    monkeypatch.setattr(
        "flowent.providers.gateway.gateway.invalidate_cache", lambda: None
    )

    result = asyncio.run(
        update_settings(
            UpdateSettingsRequest(assistant={"role_name": "Reviewer"}),
        )
    )

    assert settings.assistant.role_name == "Reviewer"
    assert result["settings"]["assistant"] == {
        "role_name": "Reviewer",
        "allow_network": True,
        "write_dirs": build_default_assistant_write_dirs(),
    }
    assert saved == [settings]


def test_update_settings_keeps_live_assistant_entry_semantics_for_non_steward_role(
    monkeypatch,
):
    registry.reset()
    settings = Settings(
        roles=[
            RoleConfig(name="Steward", system_prompt="Default assistant role."),
            RoleConfig(
                name="Reviewer",
                system_prompt="Review carefully.",
                included_tools=["read"],
            ),
        ]
    )
    assistant = Agent(
        NodeConfig(
            node_type=NodeType.ASSISTANT,
            role_name="Steward",
            tools=[
                "create_workflow",
                "delete_workflow",
                "set_permissions",
                "manage_settings",
            ],
        )
    )
    saved: list[Settings] = []

    registry.register(assistant)
    monkeypatch.setattr("flowent.routes.settings.get_settings", lambda: settings)
    monkeypatch.setattr("flowent.settings.get_settings", lambda: settings)
    monkeypatch.setattr(
        "flowent.routes.settings.save_settings",
        lambda current: saved.append(current),
    )
    monkeypatch.setattr("flowent.graph_service.sync_tab_leaders", lambda reason: None)
    monkeypatch.setattr(
        "flowent.providers.gateway.gateway.invalidate_cache", lambda: None
    )

    try:
        result = asyncio.run(
            update_settings(
                UpdateSettingsRequest(assistant={"role_name": "Reviewer"}),
            )
        )

        assert result["settings"]["assistant"] == {
            "role_name": "Reviewer",
            "allow_network": True,
            "write_dirs": build_default_assistant_write_dirs(),
        }
        assert assistant.config.role_name == "Reviewer"
        assert "create_workflow" in assistant.config.tools
        assert "delete_workflow" in assistant.config.tools
        assert "set_permissions" in assistant.config.tools
        assert "manage_settings" in assistant.config.tools
        assert "read" in assistant.config.tools
        system_prompt = next(
            entry.content
            for entry in assistant.history
            if isinstance(entry, SystemEntry)
        )
        assert STEWARD_ROLE_SYSTEM_PROMPT in system_prompt
        assert "## Selected Role Overlay" in system_prompt
        assert "Review carefully." in system_prompt
        assert saved == [settings]
    finally:
        registry.reset()


def test_update_settings_persists_assistant_permissions(monkeypatch):
    settings = Settings(
        roles=[RoleConfig(name="Steward", system_prompt="Default assistant role.")]
    )
    saved: list[Settings] = []

    monkeypatch.setattr("flowent.routes.settings.get_settings", lambda: settings)
    monkeypatch.setattr(
        "flowent.routes.settings.save_settings",
        lambda current: saved.append(current),
    )
    monkeypatch.setattr(
        "flowent.providers.gateway.gateway.invalidate_cache", lambda: None
    )

    result = asyncio.run(
        update_settings(
            UpdateSettingsRequest(
                assistant={
                    "allow_network": False,
                    "write_dirs": [" ./tmp ", "./tmp/", ""],
                }
            ),
        )
    )

    expected_write_dirs = [str((Path.cwd() / "tmp").resolve())]
    assert settings.assistant.allow_network is False
    assert settings.assistant.write_dirs == expected_write_dirs
    assert result["settings"]["assistant"] == {
        "role_name": "Steward",
        "allow_network": False,
        "write_dirs": expected_write_dirs,
    }
    assert saved == [settings]


def test_update_settings_persists_working_dir(monkeypatch, tmp_path):
    settings = Settings(
        roles=[RoleConfig(name="Steward", system_prompt="Default assistant role.")]
    )
    saved: list[Settings] = []

    monkeypatch.setattr("flowent.routes.settings.get_settings", lambda: settings)
    monkeypatch.setattr(
        "flowent.routes.settings.save_settings",
        lambda current: saved.append(current),
    )
    monkeypatch.setattr(
        "flowent.providers.gateway.gateway.invalidate_cache", lambda: None
    )

    result = asyncio.run(
        update_settings(
            UpdateSettingsRequest(working_dir=str(tmp_path)),
        )
    )

    assert settings.working_dir == str(tmp_path.resolve())
    assert result["settings"]["working_dir"] == str(tmp_path.resolve())
    assert saved == [settings]


def test_update_settings_resolves_assistant_write_dirs_against_new_working_dir(
    monkeypatch,
    tmp_path,
):
    settings = Settings(
        roles=[RoleConfig(name="Steward", system_prompt="Default assistant role.")]
    )
    saved: list[Settings] = []
    target_dir = tmp_path / "project"
    target_dir.mkdir()

    monkeypatch.setattr("flowent.routes.settings.get_settings", lambda: settings)
    monkeypatch.setattr(
        "flowent.routes.settings.save_settings",
        lambda current: saved.append(current),
    )
    monkeypatch.setattr(
        "flowent.providers.gateway.gateway.invalidate_cache", lambda: None
    )

    result = asyncio.run(
        update_settings(
            UpdateSettingsRequest(
                working_dir=str(target_dir),
                assistant={"write_dirs": ["./out"]},
            ),
        )
    )

    assert settings.working_dir == str(target_dir.resolve())
    assert settings.assistant.write_dirs == [str((target_dir / "out").resolve())]
    assert result["settings"]["assistant"]["write_dirs"] == [
        str((target_dir / "out").resolve())
    ]
    assert saved == [settings]


def test_update_settings_rejects_blank_working_dir(monkeypatch):
    settings = Settings(
        roles=[RoleConfig(name="Steward", system_prompt="Default assistant role.")]
    )

    monkeypatch.setattr("flowent.routes.settings.get_settings", lambda: settings)

    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(
            update_settings(
                UpdateSettingsRequest(working_dir="   "),
            )
        )

    assert excinfo.value.status_code == 400
    assert excinfo.value.detail == "working_dir must not be empty"


def test_update_settings_rejects_missing_working_dir(monkeypatch):
    settings = Settings(
        roles=[RoleConfig(name="Steward", system_prompt="Default assistant role.")]
    )

    monkeypatch.setattr("flowent.routes.settings.get_settings", lambda: settings)

    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(
            update_settings(
                UpdateSettingsRequest(
                    working_dir="/definitely/missing/flowent-working-dir"
                ),
            )
        )

    assert excinfo.value.status_code == 400
    assert excinfo.value.detail == "working_dir must be an existing directory"


def test_update_settings_persists_leader_role(monkeypatch):
    settings = Settings(
        roles=[
            RoleConfig(name="Conductor", system_prompt="Default leader role."),
            RoleConfig(name="Reviewer", system_prompt="Review carefully."),
        ]
    )
    saved: list[Settings] = []

    monkeypatch.setattr("flowent.routes.settings.get_settings", lambda: settings)
    monkeypatch.setattr(
        "flowent.routes.settings.save_settings",
        lambda current: saved.append(current),
    )
    monkeypatch.setattr(
        "flowent.providers.gateway.gateway.invalidate_cache", lambda: None
    )

    result = asyncio.run(
        update_settings(
            UpdateSettingsRequest(leader={"role_name": "Reviewer"}),
        )
    )

    assert settings.leader.role_name == "Reviewer"
    assert result["settings"]["leader"] == {"role_name": "Reviewer"}
    assert saved == [settings]


def test_update_settings_rejects_unknown_assistant_role(monkeypatch):
    settings = Settings(
        roles=[RoleConfig(name="Steward", system_prompt="Default assistant role.")]
    )

    monkeypatch.setattr("flowent.routes.settings.get_settings", lambda: settings)

    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(
            update_settings(
                UpdateSettingsRequest(assistant={"role_name": "Ghost"}),
            )
        )

    assert excinfo.value.status_code == 400
    assert excinfo.value.detail == "Role 'Ghost' not found"


def test_update_settings_rejects_invalid_assistant_allow_network(monkeypatch):
    settings = Settings(
        roles=[RoleConfig(name="Steward", system_prompt="Default assistant role.")]
    )

    monkeypatch.setattr("flowent.routes.settings.get_settings", lambda: settings)

    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(
            update_settings(
                UpdateSettingsRequest(assistant={"allow_network": "yes"}),
            )
        )

    assert excinfo.value.status_code == 400
    assert excinfo.value.detail == "assistant.allow_network must be a boolean"


def test_update_settings_rejects_removed_assistant_mcp_servers(monkeypatch):
    settings = Settings(
        roles=[RoleConfig(name="Steward", system_prompt="Default assistant role.")]
    )

    monkeypatch.setattr("flowent.routes.settings.get_settings", lambda: settings)

    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(
            update_settings(
                UpdateSettingsRequest(assistant={"mcp_servers": ["filesystem"]}),
            )
        )

    assert excinfo.value.status_code == 400
    assert excinfo.value.detail == "Unknown assistant fields: mcp_servers"


def test_update_settings_rejects_unknown_leader_role(monkeypatch):
    settings = Settings(roles=[RoleConfig(name="Conductor", system_prompt="Default.")])

    monkeypatch.setattr("flowent.routes.settings.get_settings", lambda: settings)

    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(
            update_settings(
                UpdateSettingsRequest(leader={"role_name": "Ghost"}),
            )
        )

    assert excinfo.value.status_code == 400
    assert excinfo.value.detail == "Role 'Ghost' not found"
