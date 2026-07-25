from __future__ import annotations

import asyncio
import sys
import time
from pathlib import Path

import pytest

from flowent.sandbox import SandboxError, SandboxRunner
from flowent.sandboxing import (
    PreparedProcess,
    SandboxBackend,
    SandboxFailureKind,
    SandboxPolicy,
    SandboxState,
    SandboxStatus,
)


class CloseTracker:
    def __init__(self) -> None:
        self.close_count = 0

    def close(self) -> None:
        self.close_count += 1


class PassthroughBackend(SandboxBackend):
    name = "test"

    def __init__(self, tracker: CloseTracker | None = None) -> None:
        self.tracker = tracker

    def status(self) -> SandboxStatus:
        return SandboxStatus(backend=self.name, state=SandboxState.AVAILABLE)

    def prepare(
        self,
        command: list[str],
        policy: SandboxPolicy,
        *,
        include_seccomp: bool = True,
    ) -> PreparedProcess:
        resources = () if self.tracker is None else (self.tracker,)
        return PreparedProcess(args=command, resources=resources, status=self.status())


def child_tree_command(marker: Path) -> list[str]:
    child = (
        "import pathlib,time;"
        "time.sleep(0.3);"
        f"pathlib.Path({str(marker)!r}).write_text('alive')"
    )
    parent = (
        "import subprocess,sys,time;"
        f"subprocess.Popen([sys.executable, '-c', {child!r}]);"
        "time.sleep(10)"
    )
    return [sys.executable, "-c", parent]


def test_sync_timeout_kills_process_tree_and_closes_resources(
    tmp_path: Path,
) -> None:
    marker = tmp_path / "sync-timeout"
    tracker = CloseTracker()
    runner = SandboxRunner(cwd=tmp_path, backend=PassthroughBackend(tracker))

    result = runner.run(child_tree_command(marker), timeout_seconds=0.05)
    time.sleep(0.4)

    assert result.exit_code == 124
    assert result.failure is not None
    assert result.failure.kind is SandboxFailureKind.TIMEOUT
    assert not marker.exists()
    assert tracker.close_count == 1


@pytest.mark.anyio
async def test_async_timeout_kills_process_tree_and_closes_resources(
    tmp_path: Path,
) -> None:
    marker = tmp_path / "async-child-survived"
    tracker = CloseTracker()
    runner = SandboxRunner(cwd=tmp_path, backend=PassthroughBackend(tracker))

    result = await runner.run_async(child_tree_command(marker), timeout_seconds=0.05)
    await asyncio.sleep(0.4)

    assert result.exit_code == 124
    assert result.failure is not None
    assert result.failure.kind is SandboxFailureKind.TIMEOUT
    assert not marker.exists()
    assert tracker.close_count == 1


@pytest.mark.anyio
async def test_async_cancellation_kills_process_tree_and_closes_resources(
    tmp_path: Path,
) -> None:
    marker = tmp_path / "cancelled-child-survived"
    tracker = CloseTracker()
    runner = SandboxRunner(cwd=tmp_path, backend=PassthroughBackend(tracker))
    task = asyncio.create_task(
        runner.run_async(child_tree_command(marker), timeout_seconds=5)
    )
    await asyncio.sleep(0.05)

    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    await asyncio.sleep(0.4)

    assert not marker.exists()
    assert tracker.close_count == 1


def test_sync_launch_failure_closes_resources(tmp_path: Path) -> None:
    tracker = CloseTracker()
    runner = SandboxRunner(cwd=tmp_path, backend=PassthroughBackend(tracker))

    with pytest.raises(SandboxError) as error:
        runner.run([str(tmp_path / "missing-command")])

    assert error.value.failure.kind is SandboxFailureKind.BACKEND_LAUNCH_FAILED
    assert error.value.failure.backend == "test"
    assert tracker.close_count == 1
