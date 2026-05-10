import json

from flowent.agent import Agent
from flowent.models import NodeConfig, NodeType
from flowent.settings import Settings
from flowent.tools.manage_prompts import ManagePromptsTool


def test_manage_prompts_get_returns_current_prompt(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT, tools=["manage_prompts"]))
    settings = Settings(
        custom_prompt="Be concise.",
        custom_post_prompt="Summarize decisions before the next step.",
    )

    monkeypatch.setattr("flowent.settings.get_settings", lambda: settings)

    result = json.loads(ManagePromptsTool().execute(agent, {"action": "get"}))

    assert result == {
        "custom_prompt": "Be concise.",
        "custom_post_prompt": "Summarize decisions before the next step.",
    }


def test_manage_prompts_update_saves_custom_prompt(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT, tools=["manage_prompts"]))
    settings = Settings(custom_prompt="", custom_post_prompt="")
    saved: list[Settings] = []

    monkeypatch.setattr("flowent.settings.get_settings", lambda: settings)
    monkeypatch.setattr(
        "flowent.settings.save_settings", lambda current: saved.append(current)
    )

    result = json.loads(
        ManagePromptsTool().execute(
            agent,
            {
                "action": "update",
                "custom_prompt": "Always prefer terse answers.",
                "custom_post_prompt": "Summarize decisions before the next step.",
            },
        )
    )

    assert result == {
        "custom_prompt": "Always prefer terse answers.",
        "custom_post_prompt": "Summarize decisions before the next step.",
    }
    assert settings.custom_prompt == "Always prefer terse answers."
    assert settings.custom_post_prompt == "Summarize decisions before the next step."
    assert saved == [settings]


def test_manage_prompts_update_requires_prompt_field(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT, tools=["manage_prompts"]))
    monkeypatch.setattr("flowent.settings.get_settings", lambda: Settings())

    result = json.loads(
        ManagePromptsTool().execute(
            agent,
            {"action": "update"},
        )
    )

    assert result == {"error": "custom_prompt or custom_post_prompt is required"}


def test_manage_prompts_update_allows_custom_post_prompt_only(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT, tools=["manage_prompts"]))
    settings = Settings(custom_prompt="Keep this.", custom_post_prompt="")

    monkeypatch.setattr("flowent.settings.get_settings", lambda: settings)
    monkeypatch.setattr("flowent.settings.save_settings", lambda current: None)

    result = json.loads(
        ManagePromptsTool().execute(
            agent,
            {
                "action": "update",
                "custom_post_prompt": "Append this after history.",
            },
        )
    )

    assert result == {
        "custom_prompt": "Keep this.",
        "custom_post_prompt": "Append this after history.",
    }
    assert settings.custom_prompt == "Keep this."
    assert settings.custom_post_prompt == "Append this after history."
