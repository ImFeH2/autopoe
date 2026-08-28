import io
import json
import sqlite3
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread

from huddol.domain import OrganizationState
from huddol.history import AgentHistory
from huddol.memory import AgentMemory
from huddol.model_runner import ModelRuntime
from huddol.operations import OrganizationOperations
from huddol.persistence import SQLiteStore
from huddol.protocol import Dispatcher, JsonLineWriter, serve
from huddol.todos import AgentTodos
from huddol.wsl_host_tools import ExecutionSettings, WslProbe


def authorized_dispatcher(
    state: OrganizationState,
    data_directory: Path,
    **kwargs: object,
) -> Dispatcher:
    store = SQLiteStore(data_directory)
    store.save_organization(state.prepare_management_replacement().persistence_data)
    return Dispatcher(
        state,
        operations=OrganizationOperations(state, store),
        **kwargs,
    )


def run_requests(*requests: object) -> list[dict[str, object]]:
    input_stream = io.StringIO(
        "".join(json.dumps(request) + "\n" for request in requests)
    )
    output_stream = io.StringIO()
    with TemporaryDirectory() as directory:
        store = SQLiteStore(Path(directory))
        state = OrganizationState(
            persisted=store.load_organization(),
            on_persist=store.save_organization,
        )
        serve(
            input_stream,
            output_stream,
            state,
            operations=OrganizationOperations(state, store),
        )

    return [json.loads(line) for line in output_stream.getvalue().splitlines()]


def test_dispatches_mutations_and_returns_summary_snapshot() -> None:
    responses = run_requests(
        {
            "id": 1,
            "method": "organization.create_agent",
            "params": {"name": "Ada", "expected_revision": 0},
        },
        {
            "id": 2,
            "method": "discussion.create",
            "params": {"topic": "Plan", "member_ids": [2], "expected_revision": 1},
        },
        {
            "id": 3,
            "method": "discussion.send",
            "params": {"discussion_id": 1, "body": "Begin."},
        },
    )

    snapshot = responses[-1]["result"]
    assert isinstance(snapshot, dict)
    assert snapshot["members"][1]["name"] == "Ada"
    discussion = snapshot["discussions"][0]
    assert "messages" not in discussion
    assert discussion["message_count"] == 1
    assert discussion["latest_message_id"] == 1


def test_discussion_send_derives_mentions_from_body_only() -> None:
    responses = run_requests(
        {
            "id": 1,
            "method": "organization.create_agent",
            "params": {"name": "Ada", "expected_revision": 0},
        },
        {
            "id": 2,
            "method": "discussion.create",
            "params": {"topic": "Plan", "member_ids": [2], "expected_revision": 1},
        },
        {
            "id": 3,
            "method": "discussion.send",
            "params": {
                "discussion_id": 1,
                "body": "No notification",
                "mention_ids": [2],
            },
        },
        {
            "id": 4,
            "method": "discussion.send",
            "params": {"discussion_id": 1, "body": "@Ada please begin"},
        },
        {
            "id": 5,
            "method": "human.discussion.messages.page",
            "params": {"discussion_id": 1},
        },
    )

    messages = responses[-1]["result"]["messages"]
    assert messages[0]["mentions"] == []
    assert messages[1]["mentions"] == [{"member_id": 2, "status": "pending"}]


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
    store.save_organization(state.prepare_management_replacement().persistence_data)
    dispatcher = Dispatcher(
        state,
        history=AgentHistory(store),
        todos=todos,
        memories=memories,
        operations=OrganizationOperations(
            state,
            store,
            history=AgentHistory(store),
            todos=todos,
            memories=memories,
        ),
    )

    discussion_response = dispatcher.dispatch(
        {
            "id": 1,
            "method": "discussion.delete",
            "params": {
                "discussion_id": 1,
                "expected_revision": 0,
                "confirm_topic": "Ada work",
            },
        }
    )
    agent_response = dispatcher.dispatch(
        {
            "id": 2,
            "method": "organization.delete_agent",
            "params": {"agent_id": 3, "expected_revision": 1},
        }
    )

    assert [item["topic"] for item in discussion_response["result"]["discussions"]] == [
        "Lin work"
    ]
    assert agent_response["result"]["members"] == [
        {"id": 1, "type": "human", "name": "You"},
        {"id": 2, "type": "agent", "name": "Ada", "status": "idle"},
    ]
    remaining = agent_response["result"]["discussions"][0]
    assert remaining["id"] == 2
    assert remaining["message_count"] == 0
    assert "messages" not in remaining
    assert todos.list(3)["todos"] == []
    assert memories.list(2) == {"paths": ["MEMORY.md"], "count": 1}
    assert memories.list(3) == {"paths": [], "count": 0}


def test_dispatches_permissions_role_and_discussion_management() -> None:
    responses = run_requests(
        {
            "id": 1,
            "method": "organization.create_agent",
            "params": {"name": "Ada", "expected_revision": 0},
        },
        {
            "id": 2,
            "method": "organization.create_agent",
            "params": {"name": "Lin", "expected_revision": 1},
        },
        {
            "id": 3,
            "method": "organization.grant_admin",
            "params": {"agent_id": 2, "expected_revision": 2},
        },
        {
            "id": 4,
            "method": "discussion.create",
            "params": {
                "topic": "Lin private",
                "member_ids": [3],
                "expected_revision": 3,
            },
        },
        {
            "id": 5,
            "method": "discussion.members.update",
            "params": {
                "discussion_id": 1,
                "member_ids": [2, 3],
                "expected_revision": 4,
            },
        },
        {"id": 6, "method": "organization.permissions.get", "params": {}},
        {"id": 7, "method": "organization.audit.get", "params": {}},
    )

    permissions = responses[5]["result"]
    assert permissions["management_revision"] == 5
    assert permissions["role"] == "super_admin"
    assert permissions["admin_agent_ids"] == [2]
    audit = responses[6]["result"]["events"]
    assert [event["action"] for event in audit] == [
        "organization.agent.create",
        "organization.agent.create",
        "organization.role.grant",
        "discussion.create",
        "discussion.members.update",
    ]
    assert audit[-1]["metadata"]["after_agent_member_ids"] == [3, 2]


def test_dispatches_agent_pause_and_resume(tmp_path: Path) -> None:
    state = OrganizationState()
    state.create_agent("Ada")
    dispatcher = authorized_dispatcher(state, tmp_path / "data")

    paused = dispatcher.dispatch(
        {
            "id": 1,
            "method": "organization.pause_agent",
            "params": {"agent_id": 2, "expected_revision": 0},
        }
    )
    resumed = dispatcher.dispatch(
        {
            "id": 2,
            "method": "organization.resume_agent",
            "params": {"agent_id": 2, "expected_revision": 1},
        }
    )

    assert paused["result"]["members"][1]["status"] == "paused"
    assert resumed["result"]["members"][1]["status"] == "idle"


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
    assert responses[2]["result"]["organization"] == {
        "id": 1,
        "current_human_member_id": 1,
    }


def test_rejects_boolean_request_id_without_stopping_the_stream() -> None:
    responses = run_requests(
        {"id": True, "method": "organization.get", "params": {}},
        {"id": 2, "method": "organization.get", "params": {}},
    )

    assert responses[0]["error"] == {
        "code": "invalid_request",
        "message": "Request id must be a positive integer",
    }
    assert responses[1]["result"]["organization"] == {
        "id": 1,
        "current_human_member_id": 1,
    }


def test_execution_settings_are_shared_and_saved_for_restart() -> None:
    saved: list[str] = []
    settings = ExecutionSettings(
        "native",
        "native",
        WslProbe("Debian", "/home/ada", "x86_64"),
        saved.append,
    )
    input_stream = io.StringIO(
        "".join(
            json.dumps(request) + "\n"
            for request in [
                {"id": 1, "method": "settings.get_execution", "params": {}},
                {
                    "id": 2,
                    "method": "settings.update_execution",
                    "params": {"backend": "wsl"},
                },
                {"id": 3, "method": "settings.get_execution", "params": {}},
            ]
        )
    )
    output_stream = io.StringIO()

    serve(
        input_stream,
        output_stream,
        OrganizationState(),
        execution_settings=settings,
    )

    responses = [json.loads(line) for line in output_stream.getvalue().splitlines()]
    assert responses[0]["result"]["selected_backend"] == "native"
    assert responses[0]["result"]["restart_required"] is False
    assert responses[1]["result"] == responses[2]["result"]
    assert responses[2]["result"]["selected_backend"] == "wsl"
    assert responses[2]["result"]["active_backend"] == "native"
    assert responses[2]["result"]["restart_required"] is True
    assert saved == ["wsl"]


def test_execution_settings_reject_unavailable_wsl() -> None:
    response = Dispatcher(
        OrganizationState(),
        execution_settings=ExecutionSettings("native", "native", None),
    ).dispatch(
        {
            "id": 1,
            "method": "settings.update_execution",
            "params": {"backend": "wsl"},
        }
    )

    assert response["error"] == {
        "code": "invalid_request",
        "message": "WSL is unavailable",
    }


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
                        "context_window": 1_050_000,
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
            "context_window": 1_050_000,
            "has_api_key": True,
        }
    )
    assert secret not in output


def test_model_settings_reject_invalid_context_window() -> None:
    response = Dispatcher(OrganizationState()).dispatch(
        {
            "id": 1,
            "method": "settings.update_model",
            "params": {
                "api_type": "openai-responses",
                "base_url": "https://example.invalid/v1",
                "api_key": "test-key",
                "model": "test-model",
                "context_window": 1,
            },
        }
    )

    assert response["error"] == {
        "code": "invalid_request",
        "message": "context_window must be an integer of at least 2 or null",
    }


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
            context_window: int | None = None,
        ) -> dict[str, object]:
            del api_type, base_url, api_key, model, context_window
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
        {
            "id": 1,
            "method": "organization.create_agent",
            "params": {"expected_revision": 0},
        },
        {
            "id": 2,
            "method": "organization.create_agent",
            "params": {"name": 42, "expected_revision": 0},
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


def test_dispatches_human_only_agent_memory_and_todo_reads(tmp_path: Path) -> None:
    state = OrganizationState()
    state.create_agent("Ada")
    store = SQLiteStore(tmp_path / "data")
    memories = AgentMemory(tmp_path / "data")
    memories.write(2, "topics/details.md", "private fixture details")
    memories.write(2, "MEMORY.md", "# Fixture index")
    todos = AgentTodos(store)
    todos.create(2, "Fixture task", "fixture description")
    dispatcher = Dispatcher(state, todos=todos, memories=memories)

    memory_page = dispatcher.dispatch(
        {
            "id": 1,
            "method": "agent.memory.list",
            "params": {"agent_id": 2, "offset": 0, "limit": 1},
        }
    )
    memory_file = dispatcher.dispatch(
        {
            "id": 2,
            "method": "agent.memory.read",
            "params": {"agent_id": 2, "path": "MEMORY.md", "limit": 10},
        }
    )
    todo_page = dispatcher.dispatch(
        {
            "id": 3,
            "method": "agent.todo.list",
            "params": {"agent_id": 2, "status": "pending", "limit": 5},
        }
    )
    todo = dispatcher.dispatch(
        {
            "id": 4,
            "method": "agent.todo.read",
            "params": {"agent_id": 2, "todo_id": 1},
        }
    )

    assert memory_page["result"]["paths"] == ["MEMORY.md"]
    assert memory_page["result"]["has_more"] is True
    assert memory_file["result"]["content"] == "# Fixture index"
    assert memory_file["result"]["max_bytes"] == 64 * 1024
    assert todo_page["result"]["todos"][0]["subject"] == "Fixture task"
    assert todo["result"]["todo"]["description"] == "fixture description"


def test_agent_state_reads_validate_target_member_and_params(tmp_path: Path) -> None:
    state = OrganizationState()
    state.create_agent("Ada")
    dispatcher = Dispatcher(
        state,
        todos=AgentTodos(SQLiteStore(tmp_path / "data")),
        memories=AgentMemory(tmp_path / "data"),
    )

    human = dispatcher.dispatch(
        {
            "id": 1,
            "method": "agent.memory.list",
            "params": {"agent_id": 1},
        }
    )
    missing = dispatcher.dispatch(
        {
            "id": 2,
            "method": "agent.todo.list",
            "params": {"agent_id": 99, "status": "pending"},
        }
    )
    invalid = dispatcher.dispatch(
        {
            "id": 3,
            "method": "agent.memory.list",
            "params": {"agent_id": 2, "offset": -1},
        }
    )

    assert human["error"]["code"] == "not_an_agent"
    assert missing["error"]["code"] == "member_not_found"
    assert invalid["error"]["code"] == "invalid_request"


def test_dispatches_human_message_seen_updates(tmp_path: Path) -> None:
    state = OrganizationState()
    state.create_agent("Ada")
    state.create_discussion("Unread", 1, [2])
    state.send_message(1, 2, "First")
    dispatcher = authorized_dispatcher(state, tmp_path / "data")

    response = dispatcher.dispatch(
        {
            "id": 1,
            "method": "human.discussion.see_messages",
            "params": {"discussion_id": 1, "message_ids": [1]},
        }
    )

    activity = response["result"]["discussions"][0]["human_activity"][0]
    assert activity["joined_after_message_id"] == 0
    assert activity["read_through_message_id"] == 1
    assert activity["unread_count"] == 0


def test_summary_activity_respects_human_join_frontier() -> None:
    state = OrganizationState(
        persisted={
            "members": [
                {"id": 1, "type": "human", "name": "Owner"},
                {"id": 2, "type": "agent", "name": "Ada"},
                {"id": 3, "type": "human", "name": "Guest"},
            ],
            "discussions": [
                {
                    "id": 1,
                    "topic": "Existing",
                    "member_ids": [1, 2],
                    "messages": [
                        {"id": 1, "sender_id": 2, "body": "Old one", "mentions": []},
                        {"id": 2, "sender_id": 2, "body": "Old two", "mentions": []},
                    ],
                }
            ],
        }
    )

    guest = state.summary()["discussions"][0]["human_activity"][1]
    assert guest["joined_after_message_id"] == 2
    assert guest["unread_count"] == 0
    assert guest["first_unread_message_id"] is None

    state.send_message(1, 2, "New")
    guest = state.summary()["discussions"][0]["human_activity"][1]
    assert guest["unread_count"] == 1
    assert guest["first_unread_message_id"] == 3


def test_dispatches_general_member_rename_and_rejects_legacy_actor_fields() -> None:
    responses = run_requests(
        {
            "id": 1,
            "method": "organization.create_agent",
            "params": {"name": "Ada", "expected_revision": 0},
        },
        {
            "id": 2,
            "method": "organization.rename_member",
            "params": {"member_id": 1, "name": "Owner"},
        },
        {
            "id": 3,
            "method": "discussion.send",
            "params": {"discussion_id": 1, "sender_id": 2, "body": "forged"},
        },
        {
            "id": 4,
            "method": "human.mention.read",
            "params": {"member_id": 1, "discussion_id": 1, "message_id": 1},
        },
    )
    assert responses[1]["result"]["members"][0]["name"] == "Owner"
    assert responses[2]["error"]["code"] == "invalid_request"
    assert responses[3]["error"]["code"] == "invalid_request"


def test_protocol_exposes_member_name_policy_and_length_error_codes() -> None:
    responses = run_requests(
        {"id": 1, "method": "organization.get"},
        {
            "id": 2,
            "method": "organization.create_agent",
            "params": {"name": "Ada", "expected_revision": 0},
        },
        {
            "id": 3,
            "method": "organization.create_agent",
            "params": {"name": "a" * 33, "expected_revision": 1},
        },
        {
            "id": 4,
            "method": "organization.rename_member",
            "params": {"member_id": 1, "name": "a" * 33},
        },
        {
            "id": 5,
            "method": "organization.rename_member",
            "params": {"member_id": 2, "name": "𐐀" * 32 + "a"},
        },
    )

    assert responses[0]["result"]["member_name_policy"] == {
        "normalization": "NFKC",
        "max_code_points": 32,
        "max_utf8_bytes": 128,
    }
    assert responses[2]["error"]["code"] == "name_too_long"
    assert responses[3]["error"]["code"] == "name_too_long"
    assert responses[4]["error"]["code"] == "name_too_large"


def test_dispatches_member_rename_and_returns_stable_error_codes() -> None:
    responses = run_requests(
        {
            "id": 1,
            "method": "organization.create_agent",
            "params": {"name": "Ada", "expected_revision": 0},
        },
        {
            "id": 2,
            "method": "organization.rename_member",
            "params": {"member_id": 2, "name": "Grace"},
        },
        {
            "id": 3,
            "method": "organization.rename_member",
            "params": {"member_id": 2, "name": " Grace"},
        },
    )

    assert responses[1]["result"]["members"][1]["name"] == "Grace"
    assert responses[2]["error"]["code"] == "invalid_name"


def test_dispatches_atomic_human_mark_all_and_explicit_ack(tmp_path: Path) -> None:
    state = OrganizationState()
    state.create_agent("Ada")
    state.create_discussion("Human", 1, [2])
    state.send_message(1, 2, "@You review")
    dispatcher = authorized_dispatcher(state, tmp_path / "data")

    marked = dispatcher.dispatch(
        {
            "id": 1,
            "method": "human.discussion.mark_all_read",
            "params": {"discussion_id": 1, "through_message_id": 1},
        }
    )
    marked_summary = marked["result"]["discussions"][0]
    assert "messages" not in marked_summary
    assert marked_summary["human_activity"][0]["unread_count"] == 0
    page_after_read = dispatcher.dispatch(
        {
            "id": 2,
            "method": "human.discussion.messages.page",
            "params": {"discussion_id": 1},
        }
    )
    recipient = page_after_read["result"]["messages"][0]["delivery"]["recipients"][0]
    assert recipient["read"] is True
    assert recipient["ack"] == "pending"

    acknowledged = dispatcher.dispatch(
        {
            "id": 3,
            "method": "human.mention.ack",
            "params": {"discussion_id": 1, "message_id": 1},
        }
    )
    assert "messages" not in acknowledged["result"]["discussions"][0]
    page_after_ack = dispatcher.dispatch(
        {
            "id": 4,
            "method": "human.discussion.messages.page",
            "params": {"discussion_id": 1},
        }
    )
    assert (
        page_after_ack["result"]["messages"][0]["delivery"]["recipients"][0]["ack"]
        == "acked"
    )
