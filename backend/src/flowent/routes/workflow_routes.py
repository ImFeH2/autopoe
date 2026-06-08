from fastapi import FastAPI, HTTPException

from flowent.llm import CompletionCallable
from flowent.provider_connections import selected_connection
from flowent.storage import StateStore, StoredWorkflow
from flowent.workflows import (
    WorkflowRunResponse,
    run_workflow_definition,
    validate_workflow,
    workflow_requires_connection,
)


def register_workflow_routes(
    app: FastAPI,
    *,
    chat_completion: CompletionCallable | None,
    store: StateStore,
) -> None:
    @app.put("/api/workflows")
    async def save_workflow(workflow: StoredWorkflow) -> StoredWorkflow:
        try:
            return store.save_workflow(
                validate_workflow(
                    workflow.model_copy(
                        update={"name": workflow.name.strip() or "Untitled Workflow"}
                    )
                )
            )
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error

    @app.delete("/api/workflows/{workflow_id}")
    async def delete_workflow(workflow_id: str) -> dict[str, bool]:
        store.delete_workflow(workflow_id)
        return {"ok": True}

    @app.post("/api/workflows/{workflow_id}/run")
    async def run_workflow(workflow_id: str) -> WorkflowRunResponse:
        workflow = next(
            (
                current_workflow
                for current_workflow in store.read_workflows()
                if current_workflow.id == workflow_id
            ),
            None,
        )
        if workflow is None:
            raise HTTPException(status_code=404, detail="Workflow not found.")
        try:
            connection = (
                selected_connection(store.read_state())
                if workflow_requires_connection(workflow.definition)
                else None
            )
            return await run_workflow_definition(
                completion=chat_completion,
                connection=connection,
                definition=workflow.definition,
                workflow_id=workflow.id,
            )
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
