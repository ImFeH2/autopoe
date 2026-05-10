import json
from dataclasses import asdict

import flowent.settings as settings_module
from flowent.access import set_access_code, verify_access_code
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
    AssistantSettings,
    LeaderSettings,
    ProviderConfig,
    RoleConfig,
    RoleModelConfig,
    Settings,
    TelegramApprovedChat,
    TelegramSettings,
    build_default_assistant_write_dirs,
)


def test_load_settings_migrates_legacy_role_field(monkeypatch, tmp_path):
    settings_file = tmp_path / "settings.json"
    settings_file.write_text(
        json.dumps(
            {
                "event_log": {"timestamp_format": "absolute"},
                "model": {
                    "active_provider_id": "provider-1",
                    "active_model": "gpt-default",
                },
                "providers": [],
                "roles": [
                    {
                        "id": "legacy-worker",
                        "name": "Worker",
                        "system_prompt": "Do work.",
                        "required_tools": ["read"],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(settings_module, "_SETTINGS_FILE", settings_file)
    monkeypatch.setattr(settings_module, "_cached_settings", None)

    loaded = settings_module.load_settings()

    assert loaded.roles == [
        RoleConfig(
            name="Worker",
            description="Do work.",
            system_prompt="Do work.",
            included_tools=["read"],
        )
    ]
    assert loaded.assistant == AssistantSettings()
    assert loaded.leader == LeaderSettings()
    assert loaded.telegram == TelegramSettings()

    persisted = json.loads(settings_file.read_text(encoding="utf-8"))
    assert persisted["assistant"] == {
        "role_name": STEWARD_ROLE_NAME,
        "allow_network": True,
        "write_dirs": build_default_assistant_write_dirs(),
    }
    assert persisted["leader"] == {"role_name": CONDUCTOR_ROLE_NAME}
    assert persisted["telegram"] == {
        "bot_token": "",
        "pending_chats": [],
        "approved_chats": [],
    }
    assert persisted["roles"] == [
        {
            "name": "Worker",
            "description": "Do work.",
            "system_prompt": "Do work.",
            "model": None,
            "model_params": None,
            "included_tools": ["read"],
            "excluded_tools": [],
        }
    ]


def test_load_settings_defaults_model_max_retries(monkeypatch, tmp_path):
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

    monkeypatch.setattr(settings_module, "_SETTINGS_FILE", settings_file)
    monkeypatch.setattr(settings_module, "_cached_settings", None)

    loaded = settings_module.load_settings()

    assert loaded.model.max_retries == 5

    persisted = json.loads(settings_file.read_text(encoding="utf-8"))
    assert persisted["model"]["max_retries"] == 5


def test_load_settings_defaults_assistant_permissions(monkeypatch, tmp_path):
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

    monkeypatch.setattr(settings_module, "_SETTINGS_FILE", settings_file)
    monkeypatch.setattr(settings_module, "_cached_settings", None)

    loaded = settings_module.load_settings()

    assert loaded.assistant.allow_network is True
    assert loaded.assistant.write_dirs == build_default_assistant_write_dirs()

    persisted = json.loads(settings_file.read_text(encoding="utf-8"))
    assert persisted["assistant"] == {
        "role_name": STEWARD_ROLE_NAME,
        "allow_network": True,
        "write_dirs": build_default_assistant_write_dirs(),
    }


def test_load_settings_normalizes_assistant_write_dirs(monkeypatch, tmp_path):
    settings_file = tmp_path / "settings.json"
    settings_file.write_text(
        json.dumps(
            {
                "assistant": {
                    "role_name": STEWARD_ROLE_NAME,
                    "allow_network": False,
                    "write_dirs": [" ./workspace ", "./workspace/", ""],
                },
                "event_log": {"timestamp_format": "absolute"},
                "model": {"active_provider_id": "", "active_model": ""},
                "providers": [],
                "roles": [],
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(settings_module, "_SETTINGS_FILE", settings_file)
    monkeypatch.setattr(settings_module, "_cached_settings", None)

    loaded = settings_module.load_settings()
    expected_write_dirs = [str((settings_module.WORKING_DIR / "workspace").resolve())]

    assert loaded.assistant == AssistantSettings(
        role_name=STEWARD_ROLE_NAME,
        allow_network=False,
        write_dirs=expected_write_dirs,
    )

    persisted = json.loads(settings_file.read_text(encoding="utf-8"))
    assert persisted["assistant"] == {
        "role_name": STEWARD_ROLE_NAME,
        "allow_network": False,
        "write_dirs": expected_write_dirs,
    }


def test_load_settings_defaults_model_retry_policy(monkeypatch, tmp_path):
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

    monkeypatch.setattr(settings_module, "_SETTINGS_FILE", settings_file)
    monkeypatch.setattr(settings_module, "_cached_settings", None)

    loaded = settings_module.load_settings()

    assert loaded.model.retry_policy == "limited"

    persisted = json.loads(settings_file.read_text(encoding="utf-8"))
    assert persisted["model"]["retry_policy"] == "limited"


def test_load_settings_defaults_retry_backoff_fields(monkeypatch, tmp_path):
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

    monkeypatch.setattr(settings_module, "_SETTINGS_FILE", settings_file)
    monkeypatch.setattr(settings_module, "_cached_settings", None)

    loaded = settings_module.load_settings()

    assert loaded.model.retry_initial_delay_seconds == 0.5
    assert loaded.model.retry_max_delay_seconds == 8.0
    assert loaded.model.retry_backoff_cap_retries == 5

    persisted = json.loads(settings_file.read_text(encoding="utf-8"))
    assert persisted["model"]["retry_initial_delay_seconds"] == 0.5
    assert persisted["model"]["retry_max_delay_seconds"] == 8.0
    assert persisted["model"]["retry_backoff_cap_retries"] == 5


def test_get_settings_reloads_when_settings_file_changes_externally(
    monkeypatch, tmp_path
):
    settings_file = tmp_path / "settings.json"

    monkeypatch.setattr(settings_module, "_SETTINGS_FILE", settings_file)
    monkeypatch.setattr(settings_module, "_cached_settings", None)
    monkeypatch.setattr(settings_module, "_cached_settings_file_signature", None)

    settings_module.save_settings(Settings(custom_prompt="before"))

    cached = settings_module.get_settings()
    assert cached.custom_prompt == "before"

    persisted = json.loads(settings_file.read_text(encoding="utf-8"))
    persisted["custom_prompt"] = "after external update"
    settings_file.write_text(json.dumps(persisted, indent=2), encoding="utf-8")

    reloaded = settings_module.get_settings()

    assert reloaded.custom_prompt == "after external update"


def test_save_settings_preserves_newer_live_access_when_cache_is_stale(
    monkeypatch, tmp_path
):
    settings_file = tmp_path / "settings.json"

    monkeypatch.setattr(settings_module, "_SETTINGS_FILE", settings_file)
    monkeypatch.setattr(settings_module, "_cached_settings", None)
    monkeypatch.setattr(settings_module, "_cached_settings_file_signature", None)

    initial = Settings()
    set_access_code(initial, "OLD-CODE")
    settings_module.save_settings(initial)

    cached = settings_module.get_settings()
    assert verify_access_code(cached.access, "OLD-CODE")

    refreshed, _ = settings_module._read_settings_file()
    set_access_code(refreshed, "NEW-CODE")
    settings_file.write_text(
        json.dumps(asdict(refreshed), indent=2),
        encoding="utf-8",
    )

    cached.providers.append(
        ProviderConfig(
            id="provider-1",
            name="Primary",
            type="openai_compatible",
            base_url="https://api.example.com/v1",
            api_key="secret",
        )
    )
    settings_module.save_settings(cached)

    final_settings, _ = settings_module._read_settings_file()

    assert len(final_settings.providers) == 1
    assert final_settings.providers[0].id == "provider-1"
    assert verify_access_code(final_settings.access, "NEW-CODE")
    assert not verify_access_code(final_settings.access, "OLD-CODE")


def test_load_settings_defaults_model_timeout_ms(monkeypatch, tmp_path):
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

    monkeypatch.setattr(settings_module, "_SETTINGS_FILE", settings_file)
    monkeypatch.setattr(settings_module, "_cached_settings", None)

    loaded = settings_module.load_settings()

    assert loaded.model.timeout_ms == 10000

    persisted = json.loads(settings_file.read_text(encoding="utf-8"))
    assert persisted["model"]["timeout_ms"] == 10000


def test_load_settings_normalizes_provider_headers(monkeypatch, tmp_path):
    settings_file = tmp_path / "settings.json"
    settings_file.write_text(
        json.dumps(
            {
                "event_log": {"timestamp_format": "absolute"},
                "model": {"active_provider_id": "", "active_model": ""},
                "providers": [
                    {
                        "id": "provider-1",
                        "name": "Primary",
                        "type": "openai_compatible",
                        "base_url": "https://api.example.com/v1",
                        "api_key": "secret",
                        "headers": {
                            "Authorization": "Bearer test",
                            "X-Number": 1,
                        },
                    }
                ],
                "roles": [],
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(settings_module, "_SETTINGS_FILE", settings_file)
    monkeypatch.setattr(settings_module, "_cached_settings", None)

    loaded = settings_module.load_settings()

    assert loaded.providers == [
        ProviderConfig(
            id="provider-1",
            name="Primary",
            type="openai_compatible",
            base_url="https://api.example.com/v1",
            api_key="secret",
            headers={"Authorization": "Bearer test"},
        )
    ]

    persisted = json.loads(settings_file.read_text(encoding="utf-8"))
    assert persisted["providers"][0]["headers"] == {"Authorization": "Bearer test"}


def test_load_settings_defaults_provider_retry_429_delay_seconds(monkeypatch, tmp_path):
    settings_file = tmp_path / "settings.json"
    settings_file.write_text(
        json.dumps(
            {
                "event_log": {"timestamp_format": "absolute"},
                "model": {"active_provider_id": "", "active_model": ""},
                "providers": [
                    {
                        "id": "provider-1",
                        "name": "Primary",
                        "type": "openai_compatible",
                        "base_url": "https://api.example.com/v1",
                        "api_key": "secret",
                    }
                ],
                "roles": [],
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(settings_module, "_SETTINGS_FILE", settings_file)
    monkeypatch.setattr(settings_module, "_cached_settings", None)

    loaded = settings_module.load_settings()

    assert loaded.providers[0].retry_429_delay_seconds == 0

    persisted = json.loads(settings_file.read_text(encoding="utf-8"))
    assert persisted["providers"][0]["retry_429_delay_seconds"] == 0


def test_load_settings_drops_assistant_only_tools_from_custom_roles(
    monkeypatch,
    tmp_path,
):
    settings_file = tmp_path / "settings.json"
    settings_file.write_text(
        json.dumps(
            {
                "event_log": {"timestamp_format": "absolute"},
                "model": {"active_provider_id": "", "active_model": ""},
                "providers": [],
                "roles": [
                    {
                        "name": "Reviewer",
                        "system_prompt": "Review work.",
                        "included_tools": [
                            "read",
                            "create_workflow",
                            "delete_workflow",
                            "list_workflows",
                            "mcp__flowent__list_workflows",
                            "mcp__flowent__copy_workflow",
                            "mcp__flowent__clone_workflow",
                            "manage_settings",
                        ],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(settings_module, "_SETTINGS_FILE", settings_file)
    monkeypatch.setattr(settings_module, "_cached_settings", None)

    loaded = settings_module.load_settings()

    assert loaded.roles[0].included_tools == ["read"]
    persisted = json.loads(settings_file.read_text(encoding="utf-8"))
    assert persisted["roles"][0]["included_tools"] == ["read"]


def test_load_settings_migrates_legacy_post_prompt_to_custom_post_prompt(
    monkeypatch, tmp_path
):
    settings_file = tmp_path / "settings.json"
    settings_file.write_text(
        json.dumps(
            {
                "event_log": {"timestamp_format": "absolute"},
                "model": {"active_provider_id": "", "active_model": ""},
                "custom_prompt": "Apply extra guardrails.",
                "post_prompt": "Append runtime guidance.",
                "providers": [],
                "roles": [],
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(settings_module, "_SETTINGS_FILE", settings_file)
    monkeypatch.setattr(settings_module, "_cached_settings", None)

    loaded = settings_module.load_settings()

    assert loaded.custom_prompt == "Apply extra guardrails."
    assert loaded.custom_post_prompt == "Append runtime guidance."
    assert loaded.assistant == AssistantSettings()
    assert loaded.leader == LeaderSettings()
    assert loaded.telegram == TelegramSettings()

    persisted = json.loads(settings_file.read_text(encoding="utf-8"))
    assert persisted["custom_post_prompt"] == "Append runtime guidance."
    assert "post_prompt" not in persisted


def test_load_settings_migrates_legacy_model_override(monkeypatch, tmp_path):
    settings_file = tmp_path / "settings.json"
    settings_file.write_text(
        json.dumps(
            {
                "event_log": {"timestamp_format": "absolute"},
                "model": {
                    "active_provider_id": "provider-1",
                    "active_model": "gpt-default",
                },
                "providers": [],
                "roles": [
                    {
                        "name": "Reviewer",
                        "system_prompt": "Review carefully.",
                        "model_override": "gpt-4.1-mini",
                        "included_tools": ["read", "exec"],
                        "excluded_tools": ["fetch"],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(settings_module, "_SETTINGS_FILE", settings_file)
    monkeypatch.setattr(settings_module, "_cached_settings", None)

    loaded = settings_module.load_settings()

    assert loaded.roles == [
        RoleConfig(
            name="Reviewer",
            description="Review carefully.",
            system_prompt="Review carefully.",
            model=RoleModelConfig(
                provider_id="provider-1",
                model="gpt-4.1-mini",
            ),
            included_tools=["read", "exec"],
            excluded_tools=["fetch"],
        )
    ]

    persisted = json.loads(settings_file.read_text(encoding="utf-8"))
    assert persisted["roles"] == [
        {
            "name": "Reviewer",
            "description": "Review carefully.",
            "system_prompt": "Review carefully.",
            "model": {
                "provider_id": "provider-1",
                "model": "gpt-4.1-mini",
            },
            "model_params": None,
            "included_tools": ["read", "exec"],
            "excluded_tools": ["fetch"],
        }
    ]


def test_load_settings_parses_role_model_object(monkeypatch, tmp_path):
    settings_file = tmp_path / "settings.json"
    settings_file.write_text(
        json.dumps(
            {
                "event_log": {"timestamp_format": "absolute"},
                "model": {
                    "active_provider_id": "provider-1",
                    "active_model": "gpt-default",
                },
                "providers": [],
                "roles": [
                    {
                        "name": "Reviewer",
                        "system_prompt": "Review carefully.",
                        "model": {
                            "provider_id": "provider-2",
                            "model": "gpt-4.1-mini",
                        },
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(settings_module, "_SETTINGS_FILE", settings_file)
    monkeypatch.setattr(settings_module, "_cached_settings", None)

    loaded = settings_module.load_settings()

    assert loaded.roles == [
        RoleConfig(
            name="Reviewer",
            description="Review carefully.",
            system_prompt="Review carefully.",
            model=RoleModelConfig(
                provider_id="provider-2",
                model="gpt-4.1-mini",
            ),
        )
    ]


def test_load_settings_parses_telegram_settings(monkeypatch, tmp_path):
    settings_file = tmp_path / "settings.json"
    settings_file.write_text(
        json.dumps(
            {
                "event_log": {"timestamp_format": "absolute"},
                "assistant": {
                    "role_name": STEWARD_ROLE_NAME,
                    "allow_network": True,
                    "write_dirs": build_default_assistant_write_dirs(),
                },
                "telegram": {
                    "bot_token": "123456:ABCDE",
                    "registered_chat_ids": ["-1001", 2002],
                },
                "model": {"active_provider_id": "", "active_model": ""},
                "providers": [],
                "roles": [],
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(settings_module, "_SETTINGS_FILE", settings_file)
    monkeypatch.setattr(settings_module, "_cached_settings", None)

    loaded = settings_module.load_settings()

    assert loaded.telegram == TelegramSettings(
        bot_token="123456:ABCDE",
        pending_chats=[],
        approved_chats=[
            TelegramApprovedChat(chat_id=-1001, approved_at=0.0),
            TelegramApprovedChat(chat_id=2002, approved_at=0.0),
        ],
    )

    persisted = json.loads(settings_file.read_text(encoding="utf-8"))
    assert persisted["telegram"] == {
        "bot_token": "123456:ABCDE",
        "pending_chats": [],
        "approved_chats": [
            {
                "chat_id": -1001,
                "username": None,
                "display_name": "",
                "approved_at": 0.0,
            },
            {
                "chat_id": 2002,
                "username": None,
                "display_name": "",
                "approved_at": 0.0,
            },
        ],
    }


def test_ensure_builtin_roles_repairs_and_creates_builtin_roles():
    settings = Settings(
        roles=[
            RoleConfig(
                name=WORKER_ROLE_NAME,
                system_prompt="Outdated prompt.",
                included_tools=[],
                excluded_tools=["fetch"],
            )
        ]
    )

    changed = settings_module.ensure_builtin_roles(settings)

    assert changed is True
    assert settings.roles == [
        RoleConfig(
            name=STEWARD_ROLE_NAME,
            description=STEWARD_ROLE_DESCRIPTION,
            system_prompt=STEWARD_ROLE_SYSTEM_PROMPT,
            included_tools=STEWARD_ROLE_INCLUDED_TOOLS,
            excluded_tools=[],
        ),
        RoleConfig(
            name=WORKER_ROLE_NAME,
            description=WORKER_ROLE_DESCRIPTION,
            system_prompt=WORKER_ROLE_SYSTEM_PROMPT,
            included_tools=WORKER_ROLE_INCLUDED_TOOLS,
            excluded_tools=[],
        ),
        RoleConfig(
            name=CONDUCTOR_ROLE_NAME,
            description=CONDUCTOR_ROLE_DESCRIPTION,
            system_prompt=CONDUCTOR_ROLE_SYSTEM_PROMPT,
            included_tools=CONDUCTOR_ROLE_INCLUDED_TOOLS,
            excluded_tools=[],
        ),
        RoleConfig(
            name=DESIGNER_ROLE_NAME,
            description=DESIGNER_ROLE_DESCRIPTION,
            system_prompt=DESIGNER_ROLE_SYSTEM_PROMPT,
            included_tools=DESIGNER_ROLE_INCLUDED_TOOLS,
            excluded_tools=[],
        ),
    ]
    assert settings.assistant.role_name == STEWARD_ROLE_NAME
    assert settings.leader.role_name == CONDUCTOR_ROLE_NAME
