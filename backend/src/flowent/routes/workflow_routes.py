from fastapi import Body, FastAPI, HTTPException

from flowent.api_models import WorkflowRunRequest
from flowent.storage import StoredWorkflow
from flowent.workflow_service import WorkflowService
from flowent.workflows import WorkflowRunResponse

OPTIONAL_WORKFLOW_RUN_BODY = Body(default=None)


def register_workflow_routes(
    app: FastAPI,
    *,
    workflow_service: WorkflowService,
) -> None:
    @app.put("/api/workflows")
    async def save_workflow(workflow: StoredWorkflow) -> StoredWorkflow:
        try:
            return workflow_service.save_workflow(workflow)
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error

    @app.delete("/api/workflows/{workflow_id}")
    async def delete_workflow(workflow_id: str) -> dict[str, bool]:
        workflow_service.store.delete_workflow(workflow_id)
        return {"ok": True}

    @app.post("/api/workflows/{workflow_id}/run")
    async def run_workflow(
        workflow_id: str,
        request: WorkflowRunRequest | None = OPTIONAL_WORKFLOW_RUN_BODY,
    ) -> WorkflowRunResponse:
        run_request = request or WorkflowRunRequest()
        try:
            return await workflow_service.run_workflow(
                workflow_id,
                default_input=run_request.input,
                input_values=run_request.inputs,
                timer_node_id=run_request.timer_id,
            )
        except ValueError as error:
            status_code = 404 if str(error) == "Workflow not found." else 400
            raise HTTPException(status_code=status_code, detail=str(error)) from error
