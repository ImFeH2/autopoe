from __future__ import annotations

from pathlib import Path
from typing import Any

from flowent.collaboration import (
    AgentRecord,
    Chat,
    ChatTools,
    CollaborationStore,
    WorkerTools,
)
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
        self.chats: list[Chat] = []
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
        try:
            return next(chat for chat in self.chats if chat.kind == "general")
        except StopIteration as error:
            raise RuntimeError("project general chat is missing") from error

    def state(self) -> dict[str, Any]:
        return {
            **self.leader.state(),
            "agents": self.agent_infos(),
            "chats": self.chat_infos(),
        }

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

    def agent_directory(self) -> list[dict[str, str]]:
        return [
            {
                "id": runtime.record.id,
                "name": runtime.record.name,
                "role": runtime.record.role,
                "kind": runtime.record.kind,
            }
            for runtime in sorted(
                self.runtimes.values(),
                key=lambda runtime: (
                    runtime.record.kind != "leader",
                    runtime.record.name.casefold(),
                    runtime.record.id,
                ),
            )
        ]

    def chat_infos(self) -> list[dict[str, Any]]:
        return [chat.to_dict() for chat in self.chats]

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
        await self._refresh_chats()
        self._notify_agents()
        self._notify_chats()
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
        self._notify_agents()
        return runtime.agent_info()

    async def archive_worker(self, agent_id: str) -> None:
        runtime = self.runtimes.get(agent_id)
        if runtime is None or runtime.record.kind != "worker":
            raise ValueError("worker not found")
        if runtime.status in {"running", "waiting"}:
            raise ValueError("worker is busy")
        await self.store.archive_worker(self.project.id, agent_id)
        self.runtimes.pop(agent_id)
        await self._refresh_chats()
        self._notify_agents()
        self._notify_chats()

    async def list_agent_chats(self, agent_id: str) -> list[dict[str, Any]]:
        self._runtime(agent_id)
        return await self.store.chat_store.list_agent_chats(self.project.id, agent_id)

    async def create_chat(
        self,
        title: str,
        purpose: str,
        members: list[str],
        created_by: str = "user",
    ) -> dict[str, Any]:
        if created_by != "user":
            self._runtime(created_by)
        chat = await self.store.chat_store.create_chat(
            self.project.id,
            title,
            purpose,
            members,
            created_by,
        )
        await self._refresh_chats()
        self._notify_chats()
        return chat.to_dict()

    async def update_chat(
        self,
        chat_id: str,
        title: str,
        purpose: str,
        members: list[str],
    ) -> dict[str, Any]:
        chat = await self.store.chat_store.update_chat(
            self.project.id,
            chat_id,
            title,
            purpose,
            members,
        )
        await self._refresh_chats()
        self._notify_chats()
        return chat.to_dict()

    async def close_chat(self, chat_id: str) -> None:
        await self.store.chat_store.close_chat(self.project.id, chat_id)
        await self._refresh_chats()
        self._notify_chats()

    async def chat_messages(self, chat_id: str) -> list[dict[str, Any]]:
        return [
            message.to_dict()
            for message in await self.store.chat_store.list_messages(
                self.project.id,
                chat_id,
            )
        ]

    async def read_chat(self, chat_id: str, agent_id: str) -> dict[str, Any]:
        self._runtime(agent_id)
        return await self.store.chat_store.read_chat(
            self.project.id,
            chat_id,
            agent_id,
        )

    async def send_message(
        self,
        chat_id: str,
        content: str,
        author: str = "user",
    ) -> dict[str, Any]:
        if author != "user":
            self._runtime(author)
        message = await self.store.chat_store.send_message(
            self.project.id,
            chat_id,
            author,
            content,
        )
        result = message.to_dict()
        self.emit({"method": "chat/message", "params": result})
        return result

    async def mark_processed(
        self,
        chat_id: str,
        agent_id: str,
        through_message_id: str,
    ) -> int:
        self._runtime(agent_id)
        return await self.store.chat_store.mark_processed(
            self.project.id,
            chat_id,
            agent_id,
            through_message_id,
        )

    async def run_turn(self, content: str) -> None:
        await self.leader.run_turn(content)

    def set_model(self, model_name: str | None) -> None:
        self.model_name = model_name
        for runtime in self.runtimes.values():
            runtime.set_model(model_name)
        self._notify_agents()

    async def _load(self) -> None:
        await self.store.open_project(self.project.id)
        await self._refresh_chats()
        for record in await self.store.list_agents(self.project.id):
            self.runtimes[record.id] = await self._build(record)

    async def _build(self, record: AgentRecord) -> AgentRuntime:
        snapshot = await self.store.snapshot(self.project.id, record.id)
        chat_tools = ChatTools(
            record.id,
            self.agent_directory,
            self.list_agent_chats,
            self.create_chat,
            self.read_chat,
            self.send_message,
            self.mark_processed,
        )
        project_tools = [
            *chat_tools.functions,
            *(self.worker_tools.functions if record.kind == "leader" else []),
        ]
        return AgentRuntime(
            self.data_dir,
            self.project,
            self.emit,
            self.model_name,
            self.resolve_model,
            self.request_approval,
            self.store,
            snapshot,
            project_tools,
        )

    def _runtime(self, agent_id: str) -> AgentRuntime:
        try:
            return self.runtimes[agent_id]
        except KeyError as error:
            raise ValueError("agent not found") from error

    async def _refresh_chats(self) -> None:
        self.chats = await self.store.chat_store.list_chats(self.project.id)
        general = self.chat
        for runtime in self.runtimes.values():
            if runtime.chat.id == general.id:
                runtime.chat = general

    def _notify_agents(self) -> None:
        self.emit(
            {
                "method": "agents/updated",
                "params": {"agents": self.agent_infos()},
            }
        )

    def _notify_chats(self) -> None:
        self.emit(
            {
                "method": "chats/updated",
                "params": {"chats": self.chat_infos()},
            }
        )
