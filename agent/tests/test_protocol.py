import io
import json

from flowent.domain import OrganizationState
from flowent.protocol import serve


def run_requests(*requests: object) -> list[dict[str, object]]:
    input_stream = io.StringIO(
        "".join(json.dumps(request) + "\n" for request in requests)
    )
    output_stream = io.StringIO()

    serve(input_stream, output_stream, OrganizationState())

    return [json.loads(line) for line in output_stream.getvalue().splitlines()]


def test_dispatches_mutations_and_returns_complete_snapshot() -> None:
    responses = run_requests(
        {"id": 1, "method": "organization.create_agent", "params": {"name": "Ada"}},
        {
            "id": 2,
            "method": "discussion.create",
            "params": {"topic": "Plan", "creator_id": 1, "member_ids": [2]},
        },
        {
            "id": 3,
            "method": "discussion.send",
            "params": {"discussion_id": 1, "sender_id": 1, "body": "Begin."},
        },
    )

    snapshot = responses[-1]["result"]
    assert isinstance(snapshot, dict)
    assert snapshot["members"][1]["name"] == "Ada"
    assert snapshot["discussions"][0]["messages"] == [
        {"id": 1, "sender_id": 1, "body": "Begin.", "mentions": []}
    ]


def test_returns_structured_errors_without_stopping_the_stream() -> None:
    input_stream = io.StringIO(
        "{invalid}\n"
        + json.dumps({"id": 1, "method": "missing", "params": {}})
        + "\n"
        + json.dumps({"id": 2, "method": "organization.get", "params": {}})
        + "\n"
    )
    output_stream = io.StringIO()

    serve(input_stream, output_stream, OrganizationState())

    responses = [json.loads(line) for line in output_stream.getvalue().splitlines()]
    assert responses[0]["error"]["code"] == "invalid_json"
    assert responses[1]["error"] == {
        "code": "method_not_found",
        "message": "Unknown method: missing",
    }
    assert responses[2]["result"]["organization"] == {"id": 1}


def test_rejects_boolean_request_id_without_stopping_the_stream() -> None:
    responses = run_requests(
        {"id": True, "method": "organization.get", "params": {}},
        {"id": 2, "method": "organization.get", "params": {}},
    )

    assert responses[0]["error"] == {
        "code": "invalid_request",
        "message": "Request id must be a positive integer",
    }
    assert responses[1]["result"]["organization"] == {"id": 1}


def test_rejects_invalid_params_as_a_request_error() -> None:
    responses = run_requests(
        {"id": 1, "method": "organization.create_agent", "params": {}},
        {
            "id": 2,
            "method": "organization.create_agent",
            "params": {"name": 42},
        },
        {"id": 3, "method": "organization.get", "params": {}},
    )

    assert responses[0]["error"] == {
        "code": "invalid_request",
        "message": "name must be a string",
    }
    assert responses[1]["error"] == {
        "code": "invalid_request",
        "message": "name must be a string",
    }
    assert responses[2]["result"]["members"] == [
        {"id": 1, "type": "human", "name": "You"}
    ]
