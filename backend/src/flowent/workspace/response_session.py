import asyncio
import logging
from collections.abc import AsyncIterator, Coroutine, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any

from flowent.application_errors import OperationConflictError, ResourceNotFoundError
from flowent.storage import StoredMessage
from flowent.workspace.events import (
    WorkspaceResponse,
    response_snapshot_data_at,
    stream_event,
    stream_message_data,
)

logger = logging.getLogger("flowent.workspace.response_session")


@dataclass
class WorkspacePendingResponse:
    stop_event: asyncio.Event
    task: asyncio.Task[Any]


class WorkspaceResponseSession:
    def __init__(self, coordinator: "WorkspaceTurnCoordinator") -> None:
        self.coordinator = coordinator
        self.response = WorkspaceResponse(
            condition=asyncio.Condition(),
            generation=coordinator.generation,
        )
        self.turn_released = False
        coordinator.active_response = self.response

    def is_current_generation(self) -> bool:
        return self.response.generation == self.coordinator.generation

    async def append_event(self, event: str, data: dict[str, object]) -> None:
        async with self.response.condition:
            self.response.events.append(
                (self.response.latest_event_index + 1, event, data)
            )
            self.response.condition.notify_all()

    async def append_snapshot(self, message: StoredMessage) -> None:
        if message.author != "assistant":
            return
        self.response.latest_snapshot = message
        await self.append_event(
            "snapshot",
            {
                "message": stream_message_data(
                    message,
                    self.response.active_output,
                )
            },
        )

    def attach_task(self, task: asyncio.Task[None]) -> WorkspaceResponse:
        self.response.task = task
        task.add_done_callback(self._task_done)
        return self.response

    async def finish(self) -> None:
        self.response.is_done = True
        async with self.response.condition:
            self.response.condition.notify_all()
        self.coordinator.deactivate_response(self.response)
        self.release_turn()

    def release_turn(self) -> None:
        if self.turn_released:
            return
        self.turn_released = True
        self.coordinator.release_response()
        self.coordinator.release_turn()

    def _task_done(self, _: asyncio.Task[None]) -> None:
        if self.turn_released:
            return
        self.response.is_done = True
        self.coordinator.deactivate_response(self.response)
        self.release_turn()

        async def notify_response_done() -> None:
            async with self.response.condition:
                self.response.condition.notify_all()

        self.coordinator.spawn_background(notify_response_done())


class WorkspaceTurnCoordinator:
    def __init__(self) -> None:
        self.active_response: WorkspaceResponse | None = None
        self.background_tasks: set[asyncio.Task[None]] = set()
        self.generation = 0
        self.pending_response: WorkspacePendingResponse | None = None
        self.response_reserved = False
        self.turn_lock = asyncio.Lock()

    @asynccontextmanager
    async def serialized_turn(self) -> AsyncIterator[None]:
        async with self.turn_lock:
            yield

    async def acquire_turn(self) -> None:
        await self.turn_lock.acquire()

    def release_turn(self) -> None:
        self.turn_lock.release()

    def current_response(self) -> WorkspaceResponse | None:
        response = self.active_response
        if response is None or response.is_done:
            return None
        return response

    def has_active_response(self) -> bool:
        response = self.active_response
        return (
            response is not None
            and not response.is_done
            and response.task is not None
            and not response.task.done()
        )

    def reserve_response(self) -> WorkspacePendingResponse:
        if self.response_reserved or self.has_active_response():
            raise OperationConflictError("Response in progress")
        task = asyncio.current_task()
        if task is None:
            raise RuntimeError("Workspace response task is unavailable.")
        pending_response = WorkspacePendingResponse(
            stop_event=asyncio.Event(),
            task=task,
        )
        self.response_reserved = True
        self.pending_response = pending_response
        return pending_response

    def activate_response(self, pending_response: WorkspacePendingResponse) -> None:
        if self.pending_response is pending_response:
            self.pending_response = None

    def release_response(
        self, pending_response: WorkspacePendingResponse | None = None
    ) -> None:
        self.response_reserved = False
        if pending_response is None or self.pending_response is pending_response:
            self.pending_response = None

    async def acquire_response_turn(
        self, pending_response: WorkspacePendingResponse
    ) -> None:
        acquire_task = asyncio.create_task(self.turn_lock.acquire())
        stop_task = asyncio.create_task(pending_response.stop_event.wait())
        acquired = False
        try:
            await asyncio.wait(
                {acquire_task, stop_task},
                return_when=asyncio.FIRST_COMPLETED,
            )
            if pending_response.stop_event.is_set():
                raise OperationConflictError("Response stopped.")
            await acquire_task
            acquired = True
            if pending_response.stop_event.is_set():
                raise OperationConflictError("Response stopped.")
        except BaseException:
            if not acquire_task.done():
                acquire_task.cancel()
            if not stop_task.done():
                stop_task.cancel()
            acquire_result, _ = await asyncio.gather(
                acquire_task,
                stop_task,
                return_exceptions=True,
            )
            if acquired or acquire_result is True:
                self.turn_lock.release()
            raise
        else:
            stop_task.cancel()
            await asyncio.gather(stop_task, return_exceptions=True)

    def start_response_session(self) -> WorkspaceResponseSession:
        return WorkspaceResponseSession(self)

    def deactivate_response(self, response: WorkspaceResponse) -> None:
        if self.active_response is response:
            self.active_response = None

    def can_replace_messages(self) -> bool:
        return not self.response_reserved and not self.turn_lock.locked()

    def cancel_for_clear(self) -> None:
        self.generation += 1
        pending_response = self.pending_response
        if pending_response is not None:
            pending_response.stop_event.set()
        response = self.active_response
        if response is None:
            return
        response.is_done = True
        if response.task is not None and not response.task.done():
            response.discard_on_cancel = True
            response.task.cancel()

    async def notify_cleared_response(self) -> None:
        response = self.active_response
        if response is None:
            return
        async with response.condition:
            response.condition.notify_all()

    def stream_current_response(self) -> WorkspaceResponse:
        response = self.current_response()
        if response is None:
            raise ResourceNotFoundError("Response not found.")
        return response

    async def response_stream(
        self,
        response: WorkspaceResponse,
        after: int = 0,
        include_snapshots: bool = True,
    ) -> AsyncIterator[str]:
        next_event_index = after + 1
        reconnect_snapshot = (
            response_snapshot_data_at(response, after) if after > 0 else None
        )
        if include_snapshots and reconnect_snapshot is not None:
            yield stream_event(
                "snapshot",
                {"message": reconnect_snapshot},
                event_id=after,
            )
        while True:
            async with response.condition:

                def has_next_event(index: int = next_event_index) -> bool:
                    return response.is_done or any(
                        event_index >= index for event_index, _, _ in response.events
                    )

                await response.condition.wait_for(has_next_event)
                events = [
                    event for event in response.events if event[0] >= next_event_index
                ]

            for index, event, data in events:
                next_event_index = index + 1
                if event == "snapshot" and not include_snapshots:
                    continue
                yield stream_event(event, data, event_id=index)
                if event in {"done", "error"}:
                    return

            if response.is_done and not events:
                return

    def stop_response(self) -> None:
        pending_response = self.pending_response
        if pending_response is not None:
            pending_response.stop_event.set()
        response = self.current_response()
        if (
            response is not None
            and response.task is not None
            and not response.task.done()
        ):
            response.task.cancel()

    async def stop_response_for_shutdown(self) -> None:
        tasks: list[asyncio.Task[Any]] = []
        pending_response = self.pending_response
        if pending_response is not None and not pending_response.task.done():
            pending_response.stop_event.set()
            tasks.append(pending_response.task)
        response = self.active_response
        if response is not None and response.task is not None:
            if not response.task.done():
                response.task.cancel()
            tasks.append(response.task)
        await self.gather_tasks("Workspace response", tasks)

    async def stop_background_tasks_for_shutdown(self) -> None:
        await self.gather_tasks("Workspace background", list(self.background_tasks))

    def spawn_background(self, awaitable: Coroutine[Any, Any, None]) -> None:
        task = asyncio.create_task(awaitable)
        self.background_tasks.add(task)
        task.add_done_callback(self.background_tasks.discard)

    async def gather_tasks(
        self, label: str, tasks: Sequence[asyncio.Task[Any]]
    ) -> None:
        if not tasks:
            return
        results = await asyncio.gather(*tasks, return_exceptions=True)
        for result in results:
            if result is None or isinstance(result, asyncio.CancelledError):
                continue
            if isinstance(result, BaseException):
                logger.error(
                    "%s cleanup task failed",
                    label,
                    exc_info=(type(result), result, result.__traceback__),
                )
