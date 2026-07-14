from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from flowent.application_errors import (
    ApplicationError,
    InvalidRequestError,
    OperationConflictError,
    ResourceNotFoundError,
)


def application_error_status_code(error: ApplicationError) -> int:
    if isinstance(error, InvalidRequestError):
        return 400
    if isinstance(error, ResourceNotFoundError):
        return 404
    if isinstance(error, OperationConflictError):
        return 409
    raise TypeError(f"Unsupported application error: {type(error).__name__}")


async def application_error_response(
    _: Request,
    error: Exception,
) -> JSONResponse:
    if not isinstance(error, ApplicationError):
        raise error
    return JSONResponse(
        status_code=application_error_status_code(error),
        content={"detail": str(error)},
    )


def register_application_error_handler(app: FastAPI) -> None:
    app.add_exception_handler(ApplicationError, application_error_response)
