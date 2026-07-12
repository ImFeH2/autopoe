from __future__ import annotations

import asyncio
from collections.abc import Mapping
from pathlib import Path
from typing import Literal

from flowent.agent_runtime import FlowentAgentRuntime
from flowent.llm import CompletionCallable
from flowent.mcp import McpManager
from flowent.provider_connections import selected_connection
from flowent.storage import (
    StateStore,
    StoredWorkflow,
    StoredWorkflowRevision,
    WorkflowDraft,
)
from flowent.workflow_scheduler import WorkflowScheduler
from flowent.workflows import (
    WorkflowRunResponse,
    compile_workflow_spec,
    run_workflow_spec,
    validate_workflow_draft,
    workflow_requires_connection,
)


class WorkflowService:
    def __init__(
        self,
        *,
        chat_completion: CompletionCallable | None,
        cwd: Path,
        mcp_manager: McpManager,
        store: StateStore,
    ) -> None:
        self.chat_completion = chat_completion
        self.cwd = cwd
        self.mcp_manager = mcp_manager
        self.store = store
        self.agent_runtime = FlowentAgentRuntime(
            chat_completion=chat_completion,
            cwd=cwd,
            mcp_manager=mcp_manager,
            store=store,
            workflow_service=self,
        )
        self.scheduler = WorkflowScheduler(self)

    def list_workflows(self) -> list[StoredWorkflow]:
        return self.store.read_workflows()

    def get_workflow(self, workflow_id: str) -> StoredWorkflow:
        workflow = next(
            (
                current_workflow
                for current_workflow in self.store.read_workflows()
                if current_workflow.id == workflow_id
            ),
            None,
        )
        if workflow is None:
            raise ValueError("Workflow not found.")
        return workflow

    def get_active_revision(self, workflow_id: str) -> StoredWorkflowRevision:
        self.get_workflow(workflow_id)
        revision = self.store.read_active_workflow_revision(workflow_id)
        if revision is None:
            raise ValueError("Workflow is not ready to run.")
        return revision

    def get_workflow_revision(
        self, workflow_id: str, revision: int
    ) -> StoredWorkflowRevision:
        workflow = self.get_workflow(workflow_id)
        stored_revision = self.store.read_workflow_revision(workflow_id, revision)
        if stored_revision is not None:
            return stored_revision
        if workflow.revision == revision:
            compile_workflow_spec(workflow.spec)
            active_revision = self.store.read_active_workflow_revision(workflow_id)
            if active_revision is not None and active_revision.spec == workflow.spec:
                return active_revision
            raise ValueError("Workflow revision is not ready to run.")
        raise ValueError("Workflow revision not found.")

    async def save_workflow(
        self,
        workflow: WorkflowDraft,
        *,
        base_revision: int | None,
        require_executable: bool = False,
    ) -> StoredWorkflow:
        validated = validate_workflow_draft(
            workflow.model_copy(
                update={"name": workflow.name.strip() or "Untitled Workflow"}
            )
        )
        try:
            compile_workflow_spec(validated.spec)
        except ValueError:
            if require_executable:
                raise
            executable = False
        else:
            executable = True
        return await self.scheduler.save_workflow(
            validated,
            base_revision=base_revision,
            executable=executable,
        )

    async def delete_workflow(self, workflow_id: str) -> StoredWorkflow:
        workflow = self.get_workflow(workflow_id)
        await self.scheduler.delete(workflow_id)
        self.store.delete_workflow(workflow_id)
        return workflow

    async def run_workflow(
        self,
        workflow_id: str,
        *,
        default_input: str = "",
        input_values: Mapping[str, str] | None = None,
        timer_node_id: str = "",
        trigger: Literal["manual", "schedule"] = "manual",
        run_id: str | None = None,
        workflow_revision: int | None = None,
        workflow_depth: int = 0,
    ) -> WorkflowRunResponse:
        revision = (
            self.get_workflow_revision(workflow_id, workflow_revision)
            if workflow_revision is not None
            else self.get_active_revision(workflow_id)
        )
        connection = (
            selected_connection(self.store.read_state())
            if workflow_requires_connection(revision.spec)
            else None
        )
        result = await run_workflow_spec(
            connection=connection,
            default_input=default_input,
            input_values=input_values,
            runtime=self.agent_runtime,
            run_id=run_id,
            spec=revision.spec,
            timer_node_id=timer_node_id,
            trigger=trigger,
            workflow_depth=workflow_depth,
            workflow_id=workflow_id,
            workflow_revision=revision.revision,
        )
        current_task = asyncio.current_task()
        if current_task is not None and current_task.cancelling():
            raise asyncio.CancelledError
        stored_run = result.model_dump(mode="json")
        stored_run["inputs"] = {
            "default_input": default_input,
            "values": dict(input_values or {}),
        }
        self.store.save_workflow_run(stored_run)
        return result
