from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal, cast

from dotenv import dotenv_values
from pydantic_ai import Agent, ModelRetry, RunContext
from pydantic_ai.exceptions import AgentRunError
from pydantic_ai.models.openai import OpenAIChatModel, OpenAIModelName
from pydantic_ai.providers.openai import OpenAIProvider

from flowent.domain import Activation, DomainError
from flowent.runtime import AgentRunContext, AgentRunFailure, AgentRunner


@dataclass(frozen=True)
class ModelConfig:
    base_url: str
    api_key: str = field(repr=False)
    model: str

    @classmethod
    def load(cls, directory: Path) -> ModelConfig:
        values = dotenv_values(directory / ".env")
        config = cls(
            base_url=(values.get("base_url") or "").strip(),
            api_key=(values.get("api_key") or "").strip(),
            model=(values.get("model") or "").strip(),
        )
        if not config.base_url or not config.api_key or not config.model:
            raise RuntimeError("Model configuration is incomplete")
        return config


class UnavailableRunner:
    def __init__(self, message: str) -> None:
        self._message = message

    def run(self, activation: Activation, context: AgentRunContext) -> None:
        del activation, context
        raise AgentRunFailure(self._message)


class DeterministicRunner:
    def run(self, activation: Activation, context: AgentRunContext) -> None:
        agent = context.state.member(activation.agent_id)
        for item in activation.items:
            discussion = context.discussion(
                "read",
                discussion_id=item.discussion_id,
                message_ids=list(item.message_ids),
            )
            requested = [
                message
                for message in discussion["messages"]
                if message["id"] in item.message_ids
            ]
            bodies = " | ".join(message["body"] for message in requested)
            context.discussion(
                "send",
                discussion_id=item.discussion_id,
                body=f"{agent['name']} received: {bodies}",
            )
            context.discussion(
                "ack",
                discussion_id=item.discussion_id,
                message_ids=list(item.message_ids),
            )


class PydanticAgentRunner:
    def __init__(self, config: ModelConfig) -> None:
        provider = OpenAIProvider(base_url=config.base_url, api_key=config.api_key)
        model = OpenAIChatModel(
            cast(OpenAIModelName, config.model),
            provider=provider,
        )
        self._agent = Agent(
            model,
            deps_type=AgentRunContext,
            instructions=(
                "You are an Agent in Flowent. All Agents are equal and use the same tools. "
                "An Activation only identifies Messages waiting for you; it never contains their body. "
                "Use discussion action=read for every listed Message before deciding what to do. "
                "Communicate only with discussion action=send. Use organization and discussion tools "
                "to discover Members, create Agents, or open a new Discussion when useful. "
                "Acknowledge each triggering Message with discussion action=ack only after you have "
                "finished handling it. Do not claim you used tools that are not available."
            ),
            retries=2,
        )
        self._register_tools()

    def _register_tools(self) -> None:
        @self._agent.tool
        def organization(
            ctx: RunContext[AgentRunContext],
            action: Literal["list_members", "create_agent"],
            name: str | None = None,
        ) -> Any:
            """List Organization Members or create an equal Agent by name."""
            try:
                if action == "create_agent":
                    if not name:
                        raise ModelRetry("name is required for create_agent")
                    return ctx.deps.organization(action, name=name)
                return ctx.deps.organization(action)
            except DomainError as error:
                raise ModelRetry(error.message) from error

        @self._agent.tool
        def discussion(
            ctx: RunContext[AgentRunContext],
            action: Literal["create", "send", "list", "read", "ack", "search"],
            discussion_id: int | None = None,
            topic: str | None = None,
            member_ids: list[int] | None = None,
            body: str | None = None,
            mention_ids: list[int] | None = None,
            message_ids: list[int] | None = None,
            query: str | None = None,
            sender_id: int | None = None,
        ) -> Any:
            """Create, send, list, read, acknowledge, or search Discussions and Messages."""
            try:
                if action == "create":
                    if not topic or not member_ids:
                        raise ModelRetry("topic and member_ids are required for create")
                    return ctx.deps.discussion(
                        action,
                        topic=topic,
                        member_ids=member_ids,
                    )
                if action == "send":
                    if discussion_id is None or not body:
                        raise ModelRetry("discussion_id and body are required for send")
                    return ctx.deps.discussion(
                        action,
                        discussion_id=discussion_id,
                        body=body,
                        mention_ids=mention_ids or [],
                    )
                if action == "list":
                    return ctx.deps.discussion(action)
                if action == "read":
                    if discussion_id is None:
                        raise ModelRetry("discussion_id is required for read")
                    return ctx.deps.discussion(
                        action,
                        discussion_id=discussion_id,
                        message_ids=message_ids or [],
                    )
                if action == "ack":
                    if discussion_id is None or not message_ids:
                        raise ModelRetry(
                            "discussion_id and message_ids are required for ack"
                        )
                    return ctx.deps.discussion(
                        action,
                        discussion_id=discussion_id,
                        message_ids=message_ids,
                    )
                if not query:
                    raise ModelRetry("query is required for search")
                return ctx.deps.discussion(
                    action,
                    query=query,
                    discussion_id=discussion_id,
                    sender_id=sender_id,
                )
            except DomainError as error:
                raise ModelRetry(error.message) from error

    def run(self, activation: Activation, context: AgentRunContext) -> None:
        items = [
            {
                "discussion_id": item.discussion_id,
                "message_ids": list(item.message_ids),
            }
            for item in activation.items
        ]
        prompt = (
            f"You are Member {activation.agent_id}. Process this Activation: {items}. "
            "Read the listed Messages, do the requested work using available tools, communicate "
            "through Discussions, then acknowledge completed triggering Messages."
        )
        try:
            self._agent.run_sync(prompt, deps=context)
        except AgentRunError as error:
            raise AgentRunFailure("Model request failed") from error


def create_runner(directory: Path) -> AgentRunner:
    if os.environ.get("FLOWENT_TEST_RUNNER") == "deterministic":
        return DeterministicRunner()
    try:
        config = ModelConfig.load(directory)
    except RuntimeError:
        return UnavailableRunner("Model configuration is incomplete")
    return PydanticAgentRunner(config)
