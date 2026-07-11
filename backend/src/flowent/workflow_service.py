from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path

from flowent.agent_runtime import FlowentAgentRuntime
from flowent.llm import CompletionCallable
from flowent.mcp import McpManager
from flowent.provider_connections import selected_connection
from flowent.storage import StateStore, StoredWorkflow, StoredWorkflowDefinition
from flowent.workflow_scheduler import WorkflowScheduler
from flowent.workflows import (
    WorkflowRunResponse,
    run_workflow_definition,
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

    async def save_workflow(self, workflow: StoredWorkflow) -> StoredWorkflow:
        try:
            previous = self.get_workflow(workflow.id)
        except ValueError:
            previous = None
        validated = validate_workflow_draft(
            workflow.model_copy(
                update={"name": workflow.name.strip() or "Untitled Workflow"}
            )
        )
        if previous is None:
            return self.store.save_workflow(validated)
        return await self.scheduler.save_workflow(validated)

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
        workflow_depth: int = 0,
    ) -> WorkflowRunResponse:
        workflow = self.get_workflow(workflow_id)
        connection = (
            selected_connection(self.store.read_state())
            if workflow_requires_connection(workflow.definition)
            else None
        )
        return await run_workflow_definition(
            connection=connection,
            default_input=default_input,
            definition=workflow.definition,
            input_values=input_values,
            runtime=self.agent_runtime,
            timer_node_id=timer_node_id,
            workflow_depth=workflow_depth,
            workflow_id=workflow.id,
        )

    async def run_workflow_definition(
        self,
        *,
        default_input: str = "",
        definition: StoredWorkflowDefinition,
        input_values: Mapping[str, str] | None = None,
        timer_node_id: str = "",
        workflow_depth: int = 0,
        workflow_id: str,
    ) -> WorkflowRunResponse:
        connection = (
            selected_connection(self.store.read_state())
            if workflow_requires_connection(definition)
            else None
        )
        return await run_workflow_definition(
            connection=connection,
            default_input=default_input,
            definition=definition,
            input_values=input_values,
            runtime=self.agent_runtime,
            timer_node_id=timer_node_id,
            workflow_depth=workflow_depth,
            workflow_id=workflow_id,
        )
