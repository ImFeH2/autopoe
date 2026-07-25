from __future__ import annotations

import logging
import os
from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path

from fastapi import FastAPI
from starlette.types import Lifespan

from flowent.channels import TelegramBotManager, TelegramTransport
from flowent.compact import CompactProvider, LocalSummaryCompactProvider
from flowent.llm import CompletionCallable
from flowent.logging import ensure_logging_configured
from flowent.mcp import McpManager, McpTransport
from flowent.paths import resolve_workdir
from flowent.sandbox import (
    SandboxError,
    SandboxFailure,
    SandboxFailureKind,
    SandboxRunner,
    SandboxState,
)
from flowent.storage import StateStore, WorkflowRepository
from flowent.system_tools import ensure_ripgrep_available
from flowent.workflow_service import WorkflowService
from flowent.workspace.runtime import WorkspaceRuntime

logger = logging.getLogger("flowent.app")

DEFAULT_STATIC_DIR = Path(__file__).parent / "static"


@dataclass(frozen=True, slots=True)
class AppConfig:
    cwd: Path
    serve_frontend: bool
    static_dir: Path


@dataclass(frozen=True, slots=True)
class AppDependencies:
    store: StateStore
    workflow_repository: WorkflowRepository
    mcp_manager: McpManager
    workflow_service: WorkflowService
    runtime: WorkspaceRuntime
    telegram_bot_manager: TelegramBotManager


def frontend_static_directory() -> Path:
    configured_directory = os.environ.get("FLOWENT_STATIC_DIR")
    if configured_directory:
        return Path(configured_directory)
    repository_frontend_dist = Path(__file__).resolve().parents[3] / "frontend" / "dist"
    if repository_frontend_dist.is_dir():
        return repository_frontend_dist
    return DEFAULT_STATIC_DIR


def ensure_application_requirements() -> None:
    ensure_logging_configured()
    protection_status = SandboxRunner().status
    if (
        not protection_status.available
        and protection_status.state is not SandboxState.SETUP_REQUIRED
    ):
        failure = protection_status.failure or SandboxFailure(
            kind=SandboxFailureKind.BACKEND_UNAVAILABLE,
            message="Command protection is not ready.",
            backend=protection_status.backend,
        )
        raise SandboxError(failure=failure)
    ensure_ripgrep_available()


def resolve_app_config(
    *,
    serve_frontend: bool,
    workdir: Path | str | None,
) -> AppConfig:
    return AppConfig(
        cwd=resolve_workdir(workdir),
        serve_frontend=serve_frontend,
        static_dir=frontend_static_directory().resolve(strict=False),
    )


def build_app_dependencies(
    config: AppConfig,
    *,
    chat_completion: CompletionCallable | None = None,
    compact_provider: CompactProvider | None = None,
    mcp_transport: McpTransport | None = None,
    store: StateStore | None = None,
    telegram_transport: TelegramTransport | None = None,
) -> AppDependencies:
    resolved_store = store if store is not None else StateStore()
    workflow_repository = WorkflowRepository(resolved_store.database)
    resolved_compact_provider = (
        compact_provider
        if compact_provider is not None
        else LocalSummaryCompactProvider()
    )
    mcp_manager = McpManager(store=resolved_store, transport=mcp_transport)
    workflow_service = WorkflowService(
        chat_completion=chat_completion,
        cwd=config.cwd,
        mcp_manager=mcp_manager,
        state_store=resolved_store,
        workflow_repository=workflow_repository,
    )
    runtime = WorkspaceRuntime(
        chat_completion=chat_completion,
        compact_provider=resolved_compact_provider,
        cwd=config.cwd,
        mcp_manager=mcp_manager,
        store=resolved_store,
        workflow_repository=workflow_repository,
        workflow_service=workflow_service,
    )
    telegram_bot_manager = TelegramBotManager(
        message_handler=runtime.reply_text,
        store=resolved_store,
        telegram_transport=telegram_transport,
    )
    return AppDependencies(
        store=resolved_store,
        workflow_repository=workflow_repository,
        mcp_manager=mcp_manager,
        workflow_service=workflow_service,
        runtime=runtime,
        telegram_bot_manager=telegram_bot_manager,
    )


class ApplicationLifecycle:
    def __init__(self, dependencies: AppDependencies) -> None:
        self.dependencies = dependencies

    async def start(self) -> None:
        await self.dependencies.mcp_manager.start_enabled()
        await self.dependencies.telegram_bot_manager.start_enabled()
        await self.dependencies.workflow_service.scheduler.start()

    async def shutdown(self) -> None:
        shutdown_steps: tuple[tuple[str, Callable[[], Awaitable[None]]], ...] = (
            (
                "Workflow scheduler",
                self.dependencies.workflow_service.scheduler.shutdown,
            ),
            ("Workspace", self.dependencies.runtime.stop_for_shutdown),
            ("Telegram", self.dependencies.telegram_bot_manager.stop_all),
            ("MCP", self.dependencies.mcp_manager.stop_all),
        )
        for label, shutdown in shutdown_steps:
            await self._run_shutdown_step(label, shutdown)

    async def _run_shutdown_step(
        self,
        label: str,
        shutdown: Callable[[], Awaitable[None]],
    ) -> None:
        try:
            await shutdown()
        except Exception:
            logger.exception("%s cleanup failed during shutdown", label)


def create_application_lifespan(dependencies: AppDependencies) -> Lifespan[FastAPI]:
    lifecycle = ApplicationLifecycle(dependencies)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        await lifecycle.start()
        try:
            yield
        finally:
            await lifecycle.shutdown()

    return lifespan


def bind_app_state(app: FastAPI, dependencies: AppDependencies) -> None:
    app.state.mcp_manager = dependencies.mcp_manager
    app.state.telegram_bot_manager = dependencies.telegram_bot_manager
    app.state.workflow_repository = dependencies.workflow_repository
    app.state.workflow_service = dependencies.workflow_service
