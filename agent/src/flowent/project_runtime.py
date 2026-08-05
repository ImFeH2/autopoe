from __future__ import annotations

from pathlib import Path
from typing import Any

from flowent.collaboration import AgentRecord, Chat, CollaborationStore, WorkerTools
from flowent.project import Project
from flowent.runtime import AgentRuntime, Emit, RequestApproval, ResolveModel


class ProjectRuntime:
    def __init__(
        self,
        data_dir: Path,
        project: Project,
        emit: Emit,
        model_name: str | None,
        resolve_model: ResolveModel,
        request_approval: RequestApproval,
        store: CollaborationStore,
    ):
        self.data_dir = data_dir
        self.project = project
        self.emit = emit
        self.model_name = model_name
        self.resolve_model = resolve_model
        self.request_approval = request_approval
        self.store = store
        self.runtimes: dict[str, AgentRuntime] = {}
        self.worker_tools = WorkerTools(self.list_workers, self.create_worker)

    @classmethod
    async def open(
        cls,
        data_dir: Path,
        project: Project,
        emit: Emit,
        model_name: str | None,
        resolve_model: ResolveModel,
        request_approval: RequestApproval,
        store: CollaborationStore,
    ) -> ProjectRuntime:
        runtime = cls(
            data_dir,
            project,
            emit,
            model_name,
            resolve_model,
            request_approval,
            store,
        )
        await runtime._load()
        return runtime

    @property
    def leader(self) -> AgentRuntime:
        try:
            return self.runtimes["leader"]
        except KeyError as error:
            raise RuntimeError("project leader runtime is missing") from error

    @property
    def chat(self) -> Chat:
        return self.leader.chat

    def state(self) -> dict[str, Any]:
        return {**self.leader.state(), "agents": self.agent_infos()}

    def agent_info(self) -> dict[str, Any]:
        return self.leader.agent_info()

    def agent_infos(self) -> list[dict[str, Any]]:
        runtimes = sorted(
            self.runtimes.values(),
            key=lambda runtime: (
                runtime.record.kind != "leader",
                runtime.record.name.casefold(),
                runtime.record.id,
            ),
        )
        return [runtime.agent_info() for runtime in runtimes]

    async def list_workers(self) -> list[dict[str, Any]]:
        return [agent for agent in self.agent_infos() if agent["kind"] == "worker"]

    async def create_worker(self, name: str, role: str) -> dict[str, Any]:
        record = await self.store.create_worker(self.project.id, name, role)
        try:
            runtime = await self._build(record)
        except Exception:
            await self.store.archive_worker(self.project.id, record.id)
            raise
        self.runtimes[record.id] = runtime
        self._notify()
        return runtime.agent_info()

    async def update_worker(
        self,
        agent_id: str,
        name: str,
        role: str,
    ) -> dict[str, Any]:
        runtime = self.runtimes.get(agent_id)
        if runtime is None or runtime.record.kind != "worker":
            raise ValueError("worker not found")
        record = await self.store.update_worker(
            self.project.id,
            agent_id,
            name,
            role,
        )
        runtime.update_record(record)
        self._notify()
        return runtime.agent_info()

    async def archive_worker(self, agent_id: str) -> None:
        runtime = self.runtimes.get(agent_id)
        if runtime is None or runtime.record.kind != "worker":
            raise ValueError("worker not found")
        if runtime.status in {"running", "waiting"}:
            raise ValueError("worker is busy")
        await self.store.archive_worker(self.project.id, agent_id)
        self.runtimes.pop(agent_id)
        self._notify()

    async def run_turn(self, content: str) -> None:
        await self.leader.run_turn(content)

    def set_model(self, model_name: str | None) -> None:
        self.model_name = model_name
        for runtime in self.runtimes.values():
            runtime.set_model(model_name)
        self._notify()

    async def _load(self) -> None:
        await self.store.open_project(self.project.id)
        for record in await self.store.list_agents(self.project.id):
            self.runtimes[record.id] = await self._build(record)

    async def _build(self, record: AgentRecord) -> AgentRuntime:
        snapshot = await self.store.snapshot(self.project.id, record.id)
        role_tools = self.worker_tools.functions if record.kind == "leader" else []
        return AgentRuntime(
            self.data_dir,
            self.project,
            self.emit,
            self.model_name,
            self.resolve_model,
            self.request_approval,
            self.store,
            snapshot,
            role_tools,
        )

    def _notify(self) -> None:
        self.emit(
            {
                "method": "agents/updated",
                "params": {"agents": self.agent_infos()},
            }
        )
