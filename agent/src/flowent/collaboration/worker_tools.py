from collections.abc import Awaitable, Callable
from typing import Annotated, Any

from pydantic import Field

WorkerName = Annotated[str, Field(min_length=1, max_length=80)]
WorkerRole = Annotated[str, Field(min_length=1, max_length=160)]
ListWorkers = Callable[[], Awaitable[list[dict[str, Any]]]]
CreateWorker = Callable[[str, str], Awaitable[dict[str, Any]]]


class WorkerTools:
    def __init__(self, list_workers: ListWorkers, create_worker: CreateWorker):
        self.list = list_workers
        self.create = create_worker

    @property
    def functions(self) -> list[Callable[..., Any]]:
        return [self.list_workers, self.create_worker]

    async def list_workers(self) -> list[dict[str, Any]]:
        """List active Workers in the current Project."""
        return await self.list()

    async def create_worker(
        self,
        name: WorkerName,
        role: WorkerRole,
    ) -> dict[str, Any]:
        """Create an idle Worker with its own runtime and Agent Home."""
        return await self.create(name, role)
