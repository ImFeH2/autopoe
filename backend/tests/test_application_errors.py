import pytest

from flowent.application_errors import (
    ApplicationError,
    InvalidRequestError,
    OperationConflictError,
    ResourceNotFoundError,
)
from flowent.routes.errors import application_error_status_code


@pytest.mark.parametrize(
    ("error", "status_code"),
    [
        (InvalidRequestError("Invalid request."), 400),
        (ResourceNotFoundError("Missing resource."), 404),
        (OperationConflictError("Operation conflict."), 409),
    ],
)
def test_application_errors_have_explicit_http_mapping(
    error: ApplicationError,
    status_code: int,
) -> None:
    assert application_error_status_code(error) == status_code
