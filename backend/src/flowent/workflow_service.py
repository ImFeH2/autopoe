from __future__ import annotations

from collections.abc import Mapping

from flowent.llm import CompletionCallable
from flowent.provider_connections import selected_connection
from flowent.storage import StateStore, StoredWorkflow, StoredWorkflowDefinition
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
        store: StateStore,
    ) -> None:
        self.chat_completion = chat_completion
        self.store = store

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

    def save_workflow(self, workflow: StoredWorkflow) -> StoredWorkflow:
        return self.store.save_workflow(
            validate_workflow_draft(
                workflow.model_copy(
                    update={"name": workflow.name.strip() or "Untitled Workflow"}
                )
            )
        )

    async def run_workflow(
        self,
        workflow_id: str,
        *,
        default_input: str = "",
        input_values: Mapping[str, str] | None = None,
        timer_node_id: str = "",
    ) -> WorkflowRunResponse:
        workflow = self.get_workflow(workflow_id)
        connection = (
            selected_connection(self.store.read_state())
            if workflow_requires_connection(workflow.definition)
            else None
        )
        return await run_workflow_definition(
            completion=self.chat_completion,
            connection=connection,
            default_input=default_input,
            definition=workflow.definition,
            input_values=input_values,
            timer_node_id=timer_node_id,
            workflow_id=workflow.id,
        )

    async def run_workflow_definition(
        self,
        *,
        default_input: str = "",
        definition: StoredWorkflowDefinition,
        input_values: Mapping[str, str] | None = None,
        timer_node_id: str = "",
        workflow_id: str,
    ) -> WorkflowRunResponse:
        connection = (
            selected_connection(self.store.read_state())
            if workflow_requires_connection(definition)
            else None
        )
        return await run_workflow_definition(
            completion=self.chat_completion,
            connection=connection,
            default_input=default_input,
            definition=definition,
            input_values=input_values,
            timer_node_id=timer_node_id,
            workflow_id=workflow_id,
        )
