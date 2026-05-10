from __future__ import annotations

import threading
from typing import TYPE_CHECKING

from loguru import logger

from flowent.registry import registry

if TYPE_CHECKING:
    from flowent.channels.telegram import TelegramChannel

SYSTEM_NODE_TIMEOUT = 5.0
_telegram_channel: TelegramChannel | None = None
_telegram_channel_lock = threading.Lock()


def _stop_telegram_channel() -> None:
    global _telegram_channel
    with _telegram_channel_lock:
        channel = _telegram_channel
        _telegram_channel = None

    if channel is not None:
        channel.stop()


def restart_telegram_channel() -> None:
    from flowent.channels.telegram import TelegramChannel
    from flowent.settings import get_settings

    _stop_telegram_channel()

    settings = get_settings()
    if not settings.telegram.bot_token.strip():
        return

    channel = TelegramChannel()
    channel.start()
    with _telegram_channel_lock:
        global _telegram_channel
        _telegram_channel = channel


def bootstrap_runtime() -> None:
    from flowent.access import ensure_access_bootstrap
    from flowent.agent import Agent
    from flowent.graph_service import (
        build_assistant_tools,
        ensure_tab_leaders,
        resolve_effective_permissions_for_node_record,
    )
    from flowent.models import AgentState, NodeConfig, NodeType
    from flowent.settings import (
        ensure_builtin_roles,
        get_settings,
        save_settings,
    )
    from flowent.workspace_store import workspace_store

    workspace_store.reset_cache()
    settings = get_settings()
    settings_changed = ensure_builtin_roles(settings)
    generated_access_code = ensure_access_bootstrap(settings)
    if settings_changed or generated_access_code is not None:
        save_settings(settings)
    assistant_tools = build_assistant_tools(settings=settings)

    assistant_record = next(
        (
            record
            for record in workspace_store.list_node_records()
            if record.config.node_type == NodeType.ASSISTANT
            and record.state != AgentState.TERMINATED
        ),
        None,
    )
    assistant = Agent(
        NodeConfig(
            node_type=NodeType.ASSISTANT,
            role_name=settings.assistant.role_name,
            name="Assistant",
            tools=assistant_tools,
            write_dirs=list(settings.assistant.write_dirs),
            allow_network=settings.assistant.allow_network,
        ),
        uuid=assistant_record.id if assistant_record is not None else None,
    )
    if assistant_record is not None:
        assistant.history = list(assistant_record.history)
        assistant._set_execution_context(
            summary=assistant_record.execution_context_summary,
            history_cutoff=assistant_record.execution_context_history_cutoff,
        )
        assistant.todos = list(assistant_record.todos)
        assistant.prime_runtime_state(
            AgentState.ERROR
            if assistant_record.state == AgentState.ERROR
            else AgentState.IDLE
        )
    registry.register(assistant)
    assistant.start()
    logger.info("Assistant started with role {}", settings.assistant.role_name)

    ensure_tab_leaders()

    restored_node_ids: set[str] = set()
    for record in workspace_store.list_node_records():
        if record.config.node_type == NodeType.ASSISTANT:
            continue
        if record.state == AgentState.TERMINATED:
            continue
        allow_network, write_dirs = resolve_effective_permissions_for_node_record(
            record
        )
        node = Agent(
            NodeConfig(
                node_type=record.config.node_type,
                role_name=record.config.role_name,
                tab_id=record.config.tab_id,
                name=record.config.name,
                tools=list(record.config.tools),
                write_dirs=write_dirs,
                allow_network=allow_network,
            ),
            uuid=record.id,
        )
        node.history = list(record.history)
        node._set_execution_context(
            summary=record.execution_context_summary,
            history_cutoff=record.execution_context_history_cutoff,
        )
        node.todos = list(record.todos)
        node.prime_runtime_state(
            AgentState.ERROR if record.state == AgentState.ERROR else AgentState.IDLE
        )
        registry.register(node)
        node.start()
        restored_node_ids.add(node.uuid)

    if settings.telegram.bot_token.strip():
        restart_telegram_channel()


def shutdown_runtime(timeout: float = SYSTEM_NODE_TIMEOUT) -> None:
    from flowent.models import NodeType

    logger.info("Shutting down runtime")
    _stop_telegram_channel()
    persistent_agents = []
    for agent in registry.get_all():
        if agent.node_type == NodeType.ASSISTANT or agent.config.tab_id:
            agent.request_process_exit()
            persistent_agents.append(agent)
            continue
        agent.terminate_and_wait(timeout=timeout)
    for agent in persistent_agents:
        agent.wait_for_termination(timeout=timeout)
    registry.reset()
    logger.info("Runtime shutdown complete")
