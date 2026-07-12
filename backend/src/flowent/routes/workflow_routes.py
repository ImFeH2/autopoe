from fastapi import Body, FastAPI, HTTPException
from fastapi.responses import JSONResponse

from flowent.api_models import (
    WorkflowRunRequest,
    WorkflowScheduleResponse,
    WorkflowScheduleStartRequest,
)
from flowent.storage import (
    StoredWorkflow,
    WorkflowRevisionConflictError,
    WorkflowSaveRequest,
)
from flowent.workflow_service import WorkflowService
from flowent.workflows import WorkflowRunResponse

OPTIONAL_WORKFLOW_RUN_BODY = Body(default=None)
OPTIONAL_WORKFLOW_SCHEDULE_BODY = Body(default=None)


def schedule_response(schedule) -> WorkflowScheduleResponse:
    return WorkflowScheduleResponse(
        workflow_id=schedule.workflow_id,
        status=schedule.status,
        timezone=schedule.timezone,
        next_run_at=min(
            (
                item.next_run_at
                for item in schedule.timers
                if item.next_run_at is not None
            ),
            default=None,
        ),
        last_run_at=schedule.last_run_at,
        last_result=schedule.last_result,
        last_error=schedule.last_error,
    )


def register_workflow_routes(
    app: FastAPI,
    *,
    workflow_service: WorkflowService,
) -> None:
    @app.put("/api/workflows", response_model=StoredWorkflow)
    async def save_workflow(request: WorkflowSaveRequest):
        try:
            return await workflow_service.save_workflow(
                request.workflow,
                base_revision=request.base_revision,
            )
        except WorkflowRevisionConflictError as error:
            return JSONResponse(
                status_code=409,
                content={
                    "detail": str(error),
                    "workflow": error.workflow.model_dump(mode="json", by_alias=True),
                },
            )
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error

    @app.delete("/api/workflows/{workflow_id}")
    async def delete_workflow(workflow_id: str) -> dict[str, bool]:
        try:
            await workflow_service.delete_workflow(workflow_id)
            return {"ok": True}
        except ValueError as error:
            if str(error) == "Workflow not found.":
                return {"ok": True}
            raise

    @app.get("/api/workflows/{workflow_id}/schedule")
    async def get_schedule(workflow_id: str) -> WorkflowScheduleResponse:
        try:
            return schedule_response(workflow_service.scheduler.get(workflow_id))
        except ValueError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error

    @app.post("/api/workflows/{workflow_id}/schedule/start")
    async def start_schedule(
        workflow_id: str,
        request: WorkflowScheduleStartRequest | None = OPTIONAL_WORKFLOW_SCHEDULE_BODY,
    ) -> WorkflowScheduleResponse:
        body = request or WorkflowScheduleStartRequest()
        try:
            schedule = await workflow_service.scheduler.start_schedule(
                workflow_id,
                default_input=body.input,
                inputs=body.inputs,
                timezone=body.timezone,
                workflow_revision=body.workflow_revision,
            )
            return schedule_response(schedule)
        except ValueError as error:
            status = 404 if str(error) == "Workflow not found." else 400
            raise HTTPException(status_code=status, detail=str(error)) from error

    @app.post("/api/workflows/{workflow_id}/schedule/stop")
    async def stop_schedule(workflow_id: str) -> WorkflowScheduleResponse:
        try:
            return schedule_response(
                await workflow_service.scheduler.stop_schedule(workflow_id)
            )
        except ValueError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error

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
                workflow_revision=run_request.workflow_revision,
            )
        except ValueError as error:
            status_code = 404 if str(error) == "Workflow not found." else 400
            raise HTTPException(status_code=status_code, detail=str(error)) from error
