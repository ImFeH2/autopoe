from pathlib import Path

from flowent_agent.persistence import Database, RuntimeServices
from flowent_agent.persistence.database import utc_now


async def test_event_store_assigns_stable_sequences(tmp_path: Path) -> None:
    services = await RuntimeServices.create(tmp_path)

    first = await services.events.append(
        "event-1",
        "run:one",
        "agent.started",
        {},
        {"run_id": "one"},
    )
    second = await services.events.append(
        "event-2",
        "run:one",
        "agent.completed",
        {},
        {"run_id": "one"},
    )

    assert first.sequence == 0
    assert second.sequence == 1
    assert await services.events.list_stream("run:one") == [first, second]
    await services.close()

    reopened = await RuntimeServices.create(tmp_path)
    third = await reopened.events.append(
        "event-3",
        "run:one",
        "agent.resumed",
        {},
        {"run_id": "one"},
    )

    assert third.sequence == 2
    await reopened.close()


async def test_artifact_store_uses_content_hashes(tmp_path: Path) -> None:
    services = await RuntimeServices.create(tmp_path)

    artifact = await services.artifacts.write_json(
        {"status": "passed"},
        "test_report",
        "Test report",
    )

    assert artifact.content_hash
    assert await services.artifacts.read_bytes(artifact) == b'{"status":"passed"}'
    await services.close()


async def test_database_recovers_running_records(tmp_path: Path) -> None:
    database = await Database.open(tmp_path)
    timestamp = utc_now()
    await database.connection.execute(
        "INSERT INTO workflow_runs(id, status, created_at, updated_at) VALUES ('run-1', 'running', ?, ?)",
        (timestamp, timestamp),
    )
    await database.connection.execute(
        "INSERT INTO work_items(id, workflow_run_id, node_id, status, created_at, updated_at) "
        "VALUES ('work-1', 'run-1', 'node-1', 'running', ?, ?)",
        (timestamp, timestamp),
    )
    await database.connection.commit()

    recovered = await database.recover_interrupted_runs()
    run = await (
        await database.connection.execute(
            "SELECT status FROM workflow_runs WHERE id = 'run-1'"
        )
    ).fetchone()
    work = await (
        await database.connection.execute(
            "SELECT status, attempt FROM work_items WHERE id = 'work-1'"
        )
    ).fetchone()

    assert recovered.workflow_runs == 1
    assert recovered.work_items == 1
    assert run["status"] == "interrupted"
    assert work["status"] == "pending"
    assert work["attempt"] == 1
    await database.close()
