import io
import json
import sqlite3
from pathlib import Path
from threading import Thread

from flowent.domain import OrganizationState
from flowent.history import AgentHistory
from flowent.memory import AgentMemory
from flowent.model_runner import ModelRuntime
from flowent.persistence import SQLiteStore
from flowent.protocol import Dispatcher, JsonLineWriter, serve
from flowent.todos import AgentTodos


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


def test_returns_the_selected_agents_complete_history(tmp_path: Path) -> None:
    state = OrganizationState()
    state.create_agent("Ada")
    history = AgentHistory(SQLiteStore(tmp_path / "data"))

    response = Dispatcher(state, history=history).dispatch(
        {"id": 1, "method": "agent.history.get", "params": {"agent_id": 2}}
    )

    assert response == {"id": 1, "result": {"agent_id": 2, "runs": []}}


def test_dispatches_discussion_and_agent_deletion(tmp_path: Path) -> None:
    state = OrganizationState()
    state.create_agent("Ada")
    state.create_agent("Lin")
    state.create_discussion("Ada work", 1, [2])
    state.create_discussion("Lin work", 1, [3])
    store = SQLiteStore(tmp_path / "data")
    todos = AgentTodos(store)
    todos.create(3, "Lin private work")
    memories = AgentMemory(tmp_path / "data")
    memories.write(2, "MEMORY.md", "Ada private Memory")
    memories.write(3, "MEMORY.md", "Lin private Memory")
    dispatcher = Dispatcher(
        state,
        history=AgentHistory(store),
        todos=todos,
        memories=memories,
    )

    discussion_response = dispatcher.dispatch(
        {"id": 1, "method": "discussion.delete", "params": {"discussion_id": 1}}
    )
    agent_response = dispatcher.dispatch(
        {"id": 2, "method": "organization.delete_agent", "params": {"agent_id": 3}}
    )

    assert [item["topic"] for item in discussion_response["result"]["discussions"]] == [
        "Lin work"
    ]
    assert agent_response["result"]["members"] == [
        {"id": 1, "type": "human", "name": "You"},
        {"id": 2, "type": "agent", "name": "Ada", "status": "idle"},
    ]
    assert agent_response["result"]["discussions"] == [
        {
            "id": 2,
            "topic": "Lin work",
            "member_ids": [1],
            "messages": [],
        }
    ]
    assert todos.list(3)["todos"] == []
    assert memories.list(2) == {"paths": ["MEMORY.md"], "count": 1}
    assert memories.list(3) == {"paths": [], "count": 0}


def test_json_line_writer_keeps_responses_and_events_atomic() -> None:
    output = io.StringIO()
    writer = JsonLineWriter(output)

    def write_responses() -> None:
        for request_id in range(1, 101):
            writer.write({"id": request_id, "result": {"ok": True}})

    def write_events() -> None:
        for sequence in range(1, 101):
            writer.write_event(
                "agent.history.updated",
                {"agent_id": 2, "sequence": sequence},
            )

    threads = [Thread(target=write_responses), Thread(target=write_events)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    messages = [json.loads(line) for line in output.getvalue().splitlines()]
    assert len(messages) == 200
    assert sum("id" in message for message in messages) == 100
    assert (
        sum(message.get("event") == "agent.history.updated" for message in messages)
        == 100
    )


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


def test_model_settings_are_shared_without_returning_the_api_key() -> None:
    secret = "must-not-be-returned"
    input_stream = io.StringIO(
        "".join(
            json.dumps(request) + "\n"
            for request in [
                {"id": 1, "method": "settings.get_model", "params": {}},
                {
                    "id": 2,
                    "method": "settings.update_model",
                    "params": {
                        "api_type": "openai-responses",
                        "base_url": "https://example.invalid/v1",
                        "api_key": secret,
                        "model": "test-model",
                    },
                },
                {"id": 3, "method": "settings.get_model", "params": {}},
            ]
        )
    )
    output_stream = io.StringIO()

    serve(
        input_stream,
        output_stream,
        OrganizationState(),
        model_runtime=ModelRuntime(),
    )

    output = output_stream.getvalue()
    responses = [json.loads(line) for line in output.splitlines()]
    assert responses[0]["result"]["has_api_key"] is False
    assert (
        responses[1]["result"]
        == responses[2]["result"]
        == {
            "api_type": "openai-responses",
            "base_url": "https://example.invalid/v1",
            "model": "test-model",
            "has_api_key": True,
        }
    )
    assert secret not in output


def test_observability_settings_never_return_the_secret_key() -> None:
    secret = "must-not-be-returned"
    runtime = ModelRuntime(observability_session_factory=lambda _config: None)
    input_stream = io.StringIO(
        "".join(
            json.dumps(request) + "\n"
            for request in [
                {"id": 1, "method": "settings.get_observability", "params": {}},
                {
                    "id": 2,
                    "method": "settings.update_observability",
                    "params": {
                        "enabled": True,
                        "base_url": "https://langfuse.invalid",
                        "public_key": "test-public",
                        "secret_key": secret,
                        "environment": "development",
                        "capture_content": True,
                    },
                },
                {"id": 3, "method": "settings.get_observability", "params": {}},
            ]
        )
    )
    output_stream = io.StringIO()

    serve(
        input_stream,
        output_stream,
        OrganizationState(),
        model_runtime=runtime,
    )

    output = output_stream.getvalue()
    responses = [json.loads(line) for line in output.splitlines()]
    assert responses[0]["result"] == {
        "enabled": False,
        "base_url": "",
        "public_key": "",
        "environment": "development",
        "capture_content": False,
        "has_secret_key": False,
    }
    assert (
        responses[1]["result"]
        == responses[2]["result"]
        == {
            "enabled": True,
            "base_url": "https://langfuse.invalid",
            "public_key": "test-public",
            "environment": "development",
            "capture_content": True,
            "has_secret_key": True,
        }
    )
    assert secret not in output


def test_observability_settings_reject_non_boolean_flags() -> None:
    response = Dispatcher(OrganizationState()).dispatch(
        {
            "id": 1,
            "method": "settings.update_observability",
            "params": {
                "enabled": 1,
                "base_url": "",
                "public_key": "",
                "secret_key": "",
                "environment": "",
                "capture_content": False,
            },
        }
    )

    assert response["error"] == {
        "code": "invalid_request",
        "message": "enabled must be a boolean",
    }


def test_persistence_error_does_not_stop_or_expose_request_data(capsys) -> None:
    secret = "must-not-leak-from-internal-error"

    class FailingModelRuntime(ModelRuntime):
        def configure(
            self,
            api_type: str,
            base_url: str,
            api_key: str,
            model: str,
        ) -> dict[str, object]:
            del api_type, base_url, api_key, model
            raise sqlite3.OperationalError(secret)

    input_stream = io.StringIO(
        json.dumps(
            {
                "id": 1,
                "method": "settings.update_model",
                "params": {
                    "api_type": "openai-chat",
                    "base_url": "https://example.invalid/v1",
                    "api_key": secret,
                    "model": "test-model",
                },
            }
        )
        + "\n"
        + json.dumps({"id": 2, "method": "organization.get", "params": {}})
        + "\n"
    )
    output_stream = io.StringIO()
    state = OrganizationState()

    serve(
        input_stream,
        output_stream,
        state,
        model_runtime=FailingModelRuntime(),
    )

    output = output_stream.getvalue()
    assert [json.loads(line) for line in output.splitlines()] == [
        {
            "id": 1,
            "error": {"code": "internal_error", "message": "Request failed"},
        },
        {"id": 2, "result": state.snapshot()},
    ]
    captured = capsys.readouterr()
    assert "OperationalError" in captured.err
    assert secret not in output
    assert secret not in captured.err


def test_shutdown_calls_cleanup_and_stops_processing() -> None:
    input_stream = io.StringIO(
        json.dumps({"id": 1, "method": "system.shutdown", "params": {}})
        + "\n"
        + json.dumps({"id": 2, "method": "organization.get", "params": {}})
        + "\n"
    )
    output_stream = io.StringIO()
    calls: list[str] = []

    serve(
        input_stream,
        output_stream,
        OrganizationState(),
        lambda: calls.append("stopped"),
    )

    assert calls == ["stopped"]
    assert [json.loads(line) for line in output_stream.getvalue().splitlines()] == [
        {"id": 1, "result": {"stopped": True}}
    ]


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
