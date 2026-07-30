import asyncio
from collections.abc import Awaitable, Callable
from typing import Any, Protocol

from pydantic import BaseModel, ConfigDict, Field


class ApprovalDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")

    approval_id: str = Field(min_length=1)
    approved: bool
    data: dict[str, Any] = Field(default_factory=dict)


class ApprovalScope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_id: str | None = None
    workflow_run_id: str | None = None
    agent_run_id: str | None = None
    tool_call_id: str | None = None


EmitApprovalEvent = Callable[[str, dict[str, Any]], Awaitable[None]]


class ApprovalStorage(Protocol):
    async def create(
        self,
        kind: str,
        prompt: str,
        metadata: dict[str, Any],
        workflow_run_id: str | None = None,
        agent_run_id: str | None = None,
        run_id: str | None = None,
        tool_call_id: str | None = None,
    ) -> str: ...

    async def resolve(
        self,
        approval_id: str,
        approved: bool,
        data: dict[str, Any],
    ) -> bool: ...

    async def close(self, approval_id: str, status: str) -> bool: ...


class ApprovalCoordinator:
    def __init__(self, store: ApprovalStorage) -> None:
        self.store = store
        self.pending: dict[str, asyncio.Future[ApprovalDecision]] = {}

    async def request(
        self,
        scope: ApprovalScope,
        kind: str,
        prompt: str,
        metadata: dict[str, Any],
        emit: EmitApprovalEvent,
        required_event: str = "approval.required",
        resolved_event: str = "approval.resolved",
        timeout_seconds: float | None = None,
    ) -> ApprovalDecision:
        approval_id = await self.store.create(
            kind,
            prompt,
            metadata,
            scope.workflow_run_id,
            scope.agent_run_id,
            scope.run_id,
            scope.tool_call_id,
        )
        future = asyncio.get_running_loop().create_future()
        self.pending[approval_id] = future
        await emit(
            required_event,
            {
                "approval_id": approval_id,
                "kind": kind,
                "prompt": prompt,
                "metadata": metadata,
            },
        )
        try:
            if timeout_seconds is None:
                decision = await future
            else:
                async with asyncio.timeout(timeout_seconds):
                    decision = await future
        except TimeoutError:
            await self.store.close(approval_id, "expired")
            raise
        except asyncio.CancelledError:
            await self.store.close(approval_id, "cancelled")
            raise
        finally:
            self.pending.pop(approval_id, None)
        await emit(
            resolved_event,
            {
                "approval_id": approval_id,
                "kind": kind,
                "approved": decision.approved,
                "data": decision.data,
            },
        )
        return decision

    async def resolve(self, decision: ApprovalDecision) -> bool:
        future = self.pending.get(decision.approval_id)
        if future is None or future.done():
            return False
        resolved = await self.store.resolve(
            decision.approval_id,
            decision.approved,
            decision.data,
        )
        if not resolved:
            return False
        future.set_result(decision)
        return True
