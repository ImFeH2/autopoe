import asyncio
import logging
import sys
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    SecretStr,
    ValidationError,
    field_validator,
)

from flowent.agents import AgentRunner, AgentRunRequest, ModelConfiguration
from flowent.approval import ApprovalCoordinator
from flowent.persistence import RuntimeServices
from flowent.protocol import Envelope, JsonlTransport, Scope
from flowent.tools.workspace import WorkspaceManager
from flowent.workflows import (
    ApprovalDecision,
    WorkflowDefinition,
    WorkflowRunRequest,
    seed_builtin_workflows,
)
from flowent.workflows.engine import WorkflowEngine


class InitializeRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    data_dir: str = Field(min_length=1)


class RuntimePreferences(BaseModel):
    model_config = ConfigDict(extra="forbid")

    default_workspace_mode: Literal["direct", "worktree"] = "worktree"


class SaveModelSettingsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model: ModelConfiguration
    runtime: RuntimePreferences = Field(default_factory=RuntimePreferences)
    api_key: SecretStr | None = None
    clear_api_key: bool = False

    @field_validator("model")
    @classmethod
    def require_concrete_model(
        cls,
        model: ModelConfiguration,
    ) -> ModelConfiguration:
        if model.provider == "default":
            raise ValueError("Default settings require a concrete provider")
        return model


class ListRunsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    workflow_id: str | None = None
    limit: int = Field(default=50, ge=1, le=100)


class ListRunEventsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_id: str = Field(min_length=1)
    after: int = Field(default=-1, ge=-1)


class Runtime:
    def __init__(self) -> None:
        self.transport = JsonlTransport()
        self.tasks: dict[str, asyncio.Task[None]] = {}
        self.initialized = False
        self.stopping = False
        self.services: RuntimeServices | None = None
        self.agent_runner: AgentRunner | None = None
        self.workflow_engine: WorkflowEngine | None = None
        self.approvals: ApprovalCoordinator | None = None
        self.workspace_manager: WorkspaceManager | None = None

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
            "workflow.list": self.list_workflows,
            "workflow.get": self.get_workflow,
            "workflow.save": self.save_workflow,
            "workflow.publish": self.publish_workflow,
            "workflow.run": self.start_workflow,
            "workflow.cancel": self.cancel_workflow,
            "workflow.approve": self.approve_workflow,
            "approval.resolve": self.approve_workflow,
            "run.list": self.list_runs,
            "run.events": self.list_run_events,
            "settings.get": self.get_settings,
            "settings.save": self.save_settings,
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
        await seed_builtin_workflows(self.services.workflows)
        self.approvals = ApprovalCoordinator(self.services.approvals)
        self.workspace_manager = WorkspaceManager(self.services.data_dir)
        self.agent_runner = AgentRunner(
            self.services.runs,
            self.approvals,
            self.workspace_manager,
            self.services.credentials,
            self.services.settings,
        )
        self.workflow_engine = WorkflowEngine(
            self.services.workflows,
            self.agent_runner,
            self.approvals,
            self.workspace_manager,
            self.services.artifacts,
        )
        self.initialized = True
        await self.respond(request, {"initialized": True})
        await self.emit(
            "runtime.ready",
            {
                "capabilities": [
                    "agent.run",
                    "agent.cancel",
                    "workflow.list",
                    "workflow.get",
                    "workflow.save",
                    "workflow.publish",
                    "workflow.run",
                    "workflow.cancel",
                    "workflow.approve",
                    "approval.resolve",
                    "run.list",
                    "run.events",
                    "settings.get",
                    "settings.save",
                ],
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
        request_payload = dict(request.payload)
        if "agent" not in request_payload:
            stored_model = await self.require_services().settings.get("model.default")
            if stored_model is not None:
                request_payload["agent"] = {"model": stored_model}
        payload = AgentRunRequest.model_validate(request_payload)
        if payload.run_id in self.tasks:
            raise RuntimeError(f"Run already exists: {payload.run_id}")
        task = asyncio.create_task(self.run_agent(payload))
        self.tasks[payload.run_id] = task
        task.add_done_callback(lambda _: self.tasks.pop(payload.run_id, None))
        await self.respond(request, {"accepted": True, "run_id": payload.run_id})

    async def cancel_agent(self, request: Envelope) -> None:
        await self.cancel_task(request)

    async def cancel_workflow(self, request: Envelope) -> None:
        await self.cancel_task(request)

    async def cancel_task(self, request: Envelope) -> None:
        run_id = str(request.payload.get("run_id", ""))
        task = self.tasks.get(run_id)
        if task is not None:
            task.cancel()
        await self.respond(request, {"cancelled": task is not None, "run_id": run_id})

    async def list_workflows(self, request: Envelope) -> None:
        services = self.require_services()
        workflows = await services.workflows.list_definitions()
        await self.respond(
            request,
            {"workflows": [item.model_dump(mode="json") for item in workflows]},
        )

    async def get_workflow(self, request: Envelope) -> None:
        services = self.require_services()
        workflow_id = str(request.payload.get("workflow_id", ""))
        definition = await services.workflows.get_draft(workflow_id)
        if definition is None:
            raise ValueError(f"Workflow not found: {workflow_id}")
        await self.respond(
            request,
            {"workflow": definition.model_dump(mode="json")},
        )

    async def save_workflow(self, request: Envelope) -> None:
        services = self.require_services()
        definition = WorkflowDefinition.model_validate(request.payload.get("workflow"))
        saved = await services.workflows.save_draft(definition)
        await self.respond(
            request,
            {"workflow": saved.model_dump(mode="json")},
        )

    async def publish_workflow(self, request: Envelope) -> None:
        services = self.require_services()
        workflow_id = str(request.payload.get("workflow_id", ""))
        version = await services.workflows.publish(workflow_id)
        await self.respond(
            request,
            {"version": version.model_dump(mode="json")},
        )

    async def start_workflow(self, request: Envelope) -> None:
        if not self.initialized or self.workflow_engine is None:
            raise RuntimeError("Workflow engine is not initialized")
        payload = WorkflowRunRequest.model_validate(request.payload)
        if payload.run_id in self.tasks:
            raise RuntimeError(f"Run already exists: {payload.run_id}")
        task = asyncio.create_task(self.run_workflow(payload))
        self.tasks[payload.run_id] = task
        task.add_done_callback(lambda _: self.tasks.pop(payload.run_id, None))
        await self.respond(request, {"accepted": True, "run_id": payload.run_id})

    async def approve_workflow(self, request: Envelope) -> None:
        if self.approvals is None:
            raise RuntimeError("Approval coordinator is not initialized")
        decision = ApprovalDecision.model_validate(request.payload)
        resolved = await self.approvals.resolve(decision)
        await self.respond(
            request,
            {"resolved": resolved, "approval_id": decision.approval_id},
        )

    async def list_runs(self, request: Envelope) -> None:
        services = self.require_services()
        payload = ListRunsRequest.model_validate(request.payload)
        runs = await services.workflows.list_runs(
            payload.limit,
            payload.workflow_id,
        )
        await self.respond(
            request,
            {"runs": [run.model_dump(mode="json") for run in runs]},
        )

    async def list_run_events(self, request: Envelope) -> None:
        services = self.require_services()
        payload = ListRunEventsRequest.model_validate(request.payload)
        records = await services.events.list_run(payload.run_id, payload.after)
        events = [
            {
                "name": record.name,
                "sequence": record.sequence,
                "scope": {
                    key: value
                    for key, value in {
                        "run_id": record.run_id,
                        "workflow_run_id": record.workflow_run_id,
                        "agent_run_id": record.agent_run_id,
                    }.items()
                    if value is not None
                },
                "payload": record.payload,
                "created_at": record.created_at,
            }
            for record in records
        ]
        await self.respond(request, {"events": events})

    async def get_settings(self, request: Envelope) -> None:
        services = self.require_services()
        stored = await services.settings.get("model.default")
        stored_runtime = await services.settings.get("runtime.preferences")
        configuration = ModelConfiguration.model_validate(
            stored
            or {
                "provider": "demo",
                "model": "flowent-demo",
                "api_mode": "responses",
                "credential_id": "default",
            }
        )
        has_api_key = False
        credential_store_available = True
        if configuration.credential_id is not None:
            try:
                has_api_key = (
                    await services.credentials.get(
                        configuration.provider,
                        configuration.credential_id,
                    )
                    is not None
                )
            except RuntimeError:
                credential_store_available = False
        await self.respond(
            request,
            {
                "model": configuration.model_dump(mode="json"),
                "runtime": RuntimePreferences.model_validate(
                    stored_runtime or {}
                ).model_dump(mode="json"),
                "has_api_key": has_api_key,
                "credential_store_available": credential_store_available,
            },
        )

    async def save_settings(self, request: Envelope) -> None:
        services = self.require_services()
        payload = SaveModelSettingsRequest.model_validate(request.payload)
        configuration = payload.model
        credential_id = configuration.credential_id or "default"
        configuration = configuration.model_copy(
            update={"credential_id": credential_id}
        )
        credential_store_available = True
        if payload.clear_api_key:
            await services.credentials.delete(
                configuration.provider,
                credential_id,
            )
            has_api_key = False
        elif payload.api_key is not None:
            await services.credentials.set(
                configuration.provider,
                credential_id,
                payload.api_key.get_secret_value(),
            )
            has_api_key = True
        elif configuration.provider == "demo":
            has_api_key = False
        else:
            try:
                has_api_key = (
                    await services.credentials.get(
                        configuration.provider,
                        credential_id,
                    )
                    is not None
                )
            except RuntimeError:
                has_api_key = False
                credential_store_available = False
        await services.settings.set(
            "model.default",
            configuration.model_dump(mode="json"),
        )
        await services.settings.set(
            "runtime.preferences",
            payload.runtime.model_dump(mode="json"),
        )
        await self.respond(
            request,
            {
                "model": configuration.model_dump(mode="json"),
                "runtime": payload.runtime.model_dump(mode="json"),
                "has_api_key": has_api_key,
                "credential_store_available": credential_store_available,
            },
        )

    async def run_agent(self, request: AgentRunRequest) -> None:
        async def send(name: str, payload: dict[str, Any] | None = None) -> None:
            await self.emit(
                name,
                payload or {},
                scope=Scope(run_id=request.run_id, agent_run_id=request.run_id),
            )

        if self.agent_runner is None:
            raise RuntimeError("Agent runner is not initialized")
        await self.agent_runner.run(request, send)

    async def run_workflow(self, request: WorkflowRunRequest) -> None:
        async def send(
            name: str,
            payload: dict[str, Any],
            agent_run_id: str | None,
        ) -> None:
            await self.emit(
                name,
                payload,
                scope=Scope(
                    run_id=request.run_id,
                    workflow_run_id=request.run_id,
                    agent_run_id=agent_run_id,
                ),
            )

        if self.workflow_engine is None:
            raise RuntimeError("Workflow engine is not initialized")
        try:
            await self.workflow_engine.run(request, send)
        except asyncio.CancelledError:
            await send("workflow.cancelled", {}, None)
        except Exception as error:
            message = str(error) or type(error).__name__
            logging.getLogger(__name__).exception("Workflow task failed")
            await send("workflow.failed", {"message": message}, None)

    def require_services(self) -> RuntimeServices:
        if self.services is None:
            raise RuntimeError("Runtime is not initialized")
        return self.services

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
            stream_key = scope.workflow_run_id or scope.agent_run_id or scope.run_id
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
