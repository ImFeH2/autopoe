from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from threading import Lock
from typing import Any, Literal, cast

from pydantic_ai import Agent, ModelRetry, RunContext
from pydantic_ai.exceptions import AgentRunError
from pydantic_ai.models.anthropic import AnthropicModel, AnthropicModelName
from pydantic_ai.models.google import GoogleModel, GoogleModelName
from pydantic_ai.models.openai import OpenAIChatModel, OpenAIModelName
from pydantic_ai.providers.anthropic import AnthropicProvider
from pydantic_ai.providers.google import GoogleProvider
from pydantic_ai.providers.openai import OpenAIProvider

from flowent.domain import Activation, DomainError
from flowent.host_tools import HostToolError
from flowent.runtime import AgentRunContext, AgentRunFailure, AgentRunner

ProviderType = Literal["openai", "anthropic", "google"]


@dataclass(frozen=True)
class ModelConfig:
    provider: ProviderType
    base_url: str
    api_key: str = field(repr=False)
    model: str

    @classmethod
    def restore(cls, values: dict[str, str]) -> ModelConfig:
        provider = values["provider"]
        if provider not in ("openai", "anthropic", "google"):
            raise RuntimeError("Persisted model provider is invalid")
        config = cls(
            provider=cast(ProviderType, provider),
            base_url=values["base_url"],
            api_key=values["api_key"],
            model=values["model"],
        )
        if not config.base_url or not config.api_key or not config.model:
            raise RuntimeError("Persisted model configuration is incomplete")
        return config

    def persistence_data(self) -> dict[str, str]:
        return {
            "provider": self.provider,
            "base_url": self.base_url,
            "api_key": self.api_key,
            "model": self.model,
        }


class UnavailableRunner:
    def __init__(self, message: str) -> None:
        self._message = message

    def run(self, activation: Activation, context: AgentRunContext) -> None:
        del activation, context
        raise AgentRunFailure(self._message)


class PydanticAgentRunner:
    def __init__(self, config: ModelConfig) -> None:
        if config.provider == "anthropic":
            model = AnthropicModel(
                cast(AnthropicModelName, config.model),
                provider=AnthropicProvider(
                    base_url=config.base_url,
                    api_key=config.api_key,
                ),
            )
        elif config.provider == "google":
            model = GoogleModel(
                cast(GoogleModelName, config.model),
                provider=GoogleProvider(
                    base_url=config.base_url,
                    api_key=config.api_key,
                ),
            )
        else:
            model = OpenAIChatModel(
                cast(OpenAIModelName, config.model),
                provider=OpenAIProvider(
                    base_url=config.base_url,
                    api_key=config.api_key,
                ),
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
                "Use exec with an argv list to inspect the launch directory and run commands. "
                "Use patch with a unified diff to create, modify, delete, or rename text files. "
                "Never read or expose .env files, environment variables, credentials, tokens, or secrets. "
                "Acknowledge each triggering Message with discussion action=ack only after you have "
                "finished handling it. Do not claim you used tools that are not available."
            ),
            retries=2,
        )
        self._register_tools()

    def _register_tools(self) -> None:
        @self._agent.tool(name="exec", sequential=True)
        def execute_command(
            ctx: RunContext[AgentRunContext],
            argv: list[str],
            cwd: str | None = None,
            timeout_seconds: int = 60,
        ) -> Any:
            """Run argv without a shell inside the launch directory and return captured output."""
            try:
                return ctx.deps.exec(argv, cwd, timeout_seconds)
            except HostToolError as error:
                raise ModelRetry(str(error)) from error

        @self._agent.tool(sequential=True)
        def patch(ctx: RunContext[AgentRunContext], diff: str) -> Any:
            """Atomically apply a unified text diff inside the launch directory."""
            try:
                return ctx.deps.patch(diff)
            except HostToolError as error:
                raise ModelRetry(str(error)) from error

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


class ModelRuntime:
    def __init__(
        self,
        config: ModelConfig | None = None,
        on_configure: Callable[[dict[str, str]], None] | None = None,
        runner_factory: Callable[[ModelConfig | None], AgentRunner] | None = None,
    ) -> None:
        self._lock = Lock()
        self._config = config
        self._on_configure = on_configure
        self._runner_factory = runner_factory or self._create_runner
        self._runner = self._runner_factory(config)

    def _create_runner(self, config: ModelConfig | None) -> AgentRunner:
        if config is None:
            return UnavailableRunner("Model configuration is incomplete")
        return PydanticAgentRunner(config)

    def settings(self) -> dict[str, Any]:
        with self._lock:
            config = self._config
            if config is None:
                return {
                    "provider": "openai",
                    "base_url": "",
                    "model": "",
                    "has_api_key": False,
                }
            return {
                "provider": config.provider,
                "base_url": config.base_url,
                "model": config.model,
                "has_api_key": True,
            }

    def configure(
        self,
        provider: str,
        base_url: str,
        api_key: str,
        model: str,
    ) -> dict[str, Any]:
        provider = provider.strip()
        base_url = base_url.strip()
        api_key = api_key.strip()
        model = model.strip()
        if provider not in ("openai", "anthropic", "google"):
            raise ValueError("provider must be openai, anthropic, or google")
        with self._lock:
            if not api_key and self._config is not None:
                api_key = self._config.api_key
            if not base_url:
                raise ValueError("base_url must not be empty")
            if not api_key:
                raise ValueError("api_key must not be empty")
            if not model:
                raise ValueError("model must not be empty")
            config = ModelConfig(
                provider=cast(ProviderType, provider),
                base_url=base_url,
                api_key=api_key,
                model=model,
            )
            runner = self._runner_factory(config)
            if self._on_configure is not None:
                self._on_configure(config.persistence_data())
            self._config = config
            self._runner = runner
        return self.settings()

    def run(self, activation: Activation, context: AgentRunContext) -> None:
        with self._lock:
            runner = self._runner
        runner.run(activation, context)


def create_runner(
    stored_config: dict[str, str] | None = None,
    on_configure: Callable[[dict[str, str]], None] | None = None,
) -> ModelRuntime:
    config = ModelConfig.restore(stored_config) if stored_config is not None else None
    return ModelRuntime(config, on_configure=on_configure)
