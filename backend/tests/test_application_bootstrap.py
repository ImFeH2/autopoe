from __future__ import annotations

from types import SimpleNamespace
from typing import cast

import pytest

from flowent.app import create_app
from flowent.bootstrap import AppConfig, AppDependencies, ApplicationLifecycle


class EnabledManager:
    def __init__(self, name: str, events: list[str]) -> None:
        self.name = name
        self.events = events

    async def start_enabled(self) -> None:
        self.events.append(f"start:{self.name}")

    async def stop_all(self) -> None:
        self.events.append(f"stop:{self.name}")


class Scheduler:
    def __init__(self, events: list[str]) -> None:
        self.events = events

    async def start(self) -> None:
        self.events.append("start:scheduler")

    async def shutdown(self) -> None:
        self.events.append("stop:scheduler")


class Workspace:
    def __init__(self, events: list[str]) -> None:
        self.events = events

    async def stop_for_shutdown(self) -> None:
        self.events.append("stop:workspace")


def fake_dependencies(events: list[str]) -> AppDependencies:
    scheduler = Scheduler(events)
    return cast(
        AppDependencies,
        SimpleNamespace(
            mcp_manager=EnabledManager("mcp", events),
            runtime=Workspace(events),
            store=SimpleNamespace(),
            telegram_bot_manager=EnabledManager("telegram", events),
            workflow_service=SimpleNamespace(scheduler=scheduler),
        ),
    )


@pytest.mark.anyio
async def test_application_lifecycle_preserves_resource_order() -> None:
    events: list[str] = []
    lifecycle = ApplicationLifecycle(fake_dependencies(events))

    await lifecycle.start()
    await lifecycle.shutdown()

    assert events == [
        "start:mcp",
        "start:telegram",
        "start:scheduler",
        "stop:scheduler",
        "stop:workspace",
        "stop:telegram",
        "stop:mcp",
    ]


def test_create_app_accepts_explicit_config_and_dependencies(tmp_path) -> None:
    events: list[str] = []
    dependencies = fake_dependencies(events)
    config = AppConfig(
        cwd=tmp_path,
        serve_frontend=False,
        static_dir=tmp_path / "static",
    )

    app = create_app(config=config, dependencies=dependencies)

    assert app.state.mcp_manager is dependencies.mcp_manager
    assert app.state.telegram_bot_manager is dependencies.telegram_bot_manager
    assert app.state.workflow_service is dependencies.workflow_service
    assert not any(route.path == "/{path:path}" for route in app.routes)
