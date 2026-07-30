import asyncio
import logging
import sys
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from flowent_agent.persistence import RuntimeServices
from flowent_agent.protocol import Envelope, JsonlTransport, Scope


class AgentMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: str
    content: str


class AgentRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_id: str = Field(min_length=1)
    messages: list[AgentMessage]


class InitializeRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    data_dir: str = Field(min_length=1)


class Runtime:
    def __init__(self) -> None:
        self.transport = JsonlTransport()
        self.tasks: dict[str, asyncio.Task[None]] = {}
        self.initialized = False
        self.stopping = False
        self.services: RuntimeServices | None = None

    @classmethod
    def run(cls) -> None:
        logging.basicConfig(
            level=logging.INFO,
            format="%(asctime)s %(levelname)s %(name)s %(message)s",
            stream=sys.stderr,
        )
        asyncio.run(cls().serve())

    async def serve(self) -> None:
        await self.emit("runtime.hello", {"runtime_version": "0.1.0"})
        while not self.stopping:
            try:
                envelope = await self.transport.receive()
            except ValidationError as error:
                logging.getLogger(__name__).warning("Invalid envelope: %s", error)
                continue
            if envelope is None:
                break
            if envelope.kind != "request":
                continue
            await self.handle_request(envelope)
        await self.stop_tasks()
        if self.services is not None:
            await self.services.close()

    async def handle_request(self, request: Envelope) -> None:
        handlers: dict[str, Callable[[Envelope], Awaitable[None]]] = {
            "runtime.initialize": self.initialize,
            "runtime.ping": self.ping,
            "runtime.shutdown": self.shutdown,
            "agent.run": self.start_agent,
            "agent.cancel": self.cancel_agent,
        }
        handler = handlers.get(request.name)
        if handler is None:
            await self.respond(
                request,
                {"message": f"Unknown request: {request.name}"},
                name="runtime.error",
            )
            return
        try:
            await handler(request)
        except ValidationError as error:
            await self.respond(
                request,
                {
                    "message": "Invalid request",
                    "details": error.errors(include_url=False),
                },
                name="runtime.error",
            )
        except Exception as error:
            logging.getLogger(__name__).exception("Request failed")
            await self.respond(
                request,
                {"message": str(error)},
                name="runtime.error",
            )

    async def initialize(self, request: Envelope) -> None:
        payload = InitializeRequest.model_validate(request.payload)
        self.services = await RuntimeServices.create(Path(payload.data_dir))
        self.initialized = True
        await self.respond(request, {"initialized": True})
        await self.emit(
            "runtime.ready",
            {
                "capabilities": ["agent.run", "agent.cancel"],
                "protocol_version": 1,
                "recovered": {
                    "workflow_runs": self.services.recovery.workflow_runs,
                    "agent_runs": self.services.recovery.agent_runs,
                    "work_items": self.services.recovery.work_items,
                },
            },
        )

    async def ping(self, request: Envelope) -> None:
        await self.respond(request, {"ready": self.initialized}, name="runtime.pong")

    async def shutdown(self, request: Envelope) -> None:
        await self.respond(request, {"stopping": True})
        self.stopping = True

    async def start_agent(self, request: Envelope) -> None:
        if not self.initialized:
            raise RuntimeError("Runtime is not initialized")
        payload = AgentRunRequest.model_validate(request.payload)
        if payload.run_id in self.tasks:
            raise RuntimeError(f"Run already exists: {payload.run_id}")
        task = asyncio.create_task(self.run_demo_agent(payload))
        self.tasks[payload.run_id] = task
        task.add_done_callback(lambda _: self.tasks.pop(payload.run_id, None))
        await self.respond(request, {"accepted": True, "run_id": payload.run_id})

    async def cancel_agent(self, request: Envelope) -> None:
        run_id = str(request.payload.get("run_id", ""))
        task = self.tasks.get(run_id)
        if task is not None:
            task.cancel()
        await self.respond(request, {"cancelled": task is not None, "run_id": run_id})

    async def run_demo_agent(self, request: AgentRunRequest) -> None:
        async def send(name: str, payload: dict[str, Any] | None = None) -> None:
            await self.emit(
                name,
                payload or {},
                scope=Scope(run_id=request.run_id),
            )

        await send("agent.started")
        try:
            user_messages = [
                message.content
                for message in request.messages
                if message.role == "user"
            ]
            latest = user_messages[-1] if user_messages else ""
            preview = latest[:96]
            suffix = "…" if len(latest) > 96 else ""
            if len(user_messages) > 1:
                response = (
                    f"I received “{preview}{suffix}” as turn {len(user_messages)}. "
                    "The conversation reached the Python runtime, and each response chunk is "
                    "streaming through JSONL and Tauri Channel."
                )
            else:
                response = (
                    f"I received “{preview}{suffix}”. This is Flowent’s Python sidecar runtime, "
                    "streaming over stdio JSONL without a local server."
                )
            for chunk in self.chunk_text(response):
                await asyncio.sleep(0.024)
                await send("agent.text_delta", {"delta": chunk})
            await send("agent.completed")
        except asyncio.CancelledError:
            await send("agent.cancelled")
            raise
        except Exception as error:
            await send("agent.failed", {"message": str(error)})

    async def respond(
        self,
        request: Envelope,
        payload: dict[str, Any],
        name: str | None = None,
    ) -> None:
        await self.transport.send(
            Envelope(
                id=uuid4().hex,
                kind="response",
                name=name or request.name,
                reply_to=request.id,
                scope=request.scope,
                payload=payload,
            )
        )

    async def emit(
        self,
        name: str,
        payload: dict[str, Any],
        scope: Scope | None = None,
        sequence: int | None = None,
    ) -> None:
        event_id = uuid4().hex
        if self.services is not None and scope is not None:
            scope_data = scope.model_dump()
            stream_key = scope.agent_run_id or scope.workflow_run_id or scope.run_id
            if stream_key is not None:
                record = await self.services.events.append(
                    event_id,
                    f"run:{stream_key}",
                    name,
                    payload,
                    scope_data,
                )
                sequence = record.sequence
        await self.transport.send(
            Envelope(
                id=event_id,
                kind="event",
                name=name,
                scope=scope,
                sequence=sequence,
                payload=payload,
            )
        )

    async def stop_tasks(self) -> None:
        tasks = list(self.tasks.values())
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    @staticmethod
    def chunk_text(value: str) -> list[str]:
        chunks = value.split(" ")
        return [
            chunk if index == len(chunks) - 1 else f"{chunk} "
            for index, chunk in enumerate(chunks)
        ]
