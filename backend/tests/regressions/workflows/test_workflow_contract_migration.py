import sqlite3

from flowent.storage import SQLiteDatabase, StateStore


def test_workflow_contract_migration_clears_only_workflow_records(tmp_path) -> None:
    database_path = tmp_path / "flowent.db"
    with sqlite3.connect(database_path) as connection:
        connection.executescript(
            """
            CREATE TABLE workflows (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                definition TEXT NOT NULL,
                created_at INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE workflow_agent_histories (
                workflow_id TEXT NOT NULL,
                node_id TEXT NOT NULL,
                messages TEXT NOT NULL DEFAULT '[]',
                PRIMARY KEY (workflow_id, node_id)
            );
            CREATE TABLE workflow_schedules (
                workflow_id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                generation INTEGER NOT NULL,
                default_input TEXT NOT NULL,
                inputs TEXT NOT NULL,
                timezone TEXT NOT NULL,
                last_run_at REAL,
                last_result TEXT,
                last_error TEXT NOT NULL
            );
            CREATE TABLE workflow_schedule_timers (
                workflow_id TEXT NOT NULL,
                timer_node_id TEXT NOT NULL,
                next_run_at REAL,
                PRIMARY KEY (workflow_id, timer_node_id)
            );
            CREATE TABLE workflow_runs (
                run_id TEXT PRIMARY KEY,
                workflow_id TEXT NOT NULL,
                workflow_revision INTEGER NOT NULL,
                status TEXT NOT NULL,
                trigger TEXT NOT NULL,
                inputs TEXT NOT NULL,
                node_results TEXT NOT NULL,
                outputs TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE providers (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                type TEXT NOT NULL,
                base_url TEXT NOT NULL,
                api_key TEXT NOT NULL,
                created_at INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE provider_models (
                provider_id TEXT NOT NULL,
                model TEXT NOT NULL,
                position INTEGER NOT NULL,
                PRIMARY KEY (provider_id, model)
            );
            CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY);
            INSERT INTO schema_migrations (version) VALUES (1), (2);
            INSERT INTO workflows (id, name, definition)
            VALUES ('old-workflow', 'Old Workflow', '{"nodes":[],"edges":[]}');
            INSERT INTO workflow_schedules (
                workflow_id, status, generation, default_input, inputs,
                timezone, last_error
            ) VALUES ('old-workflow', 'scheduled', 1, '', '{}', 'UTC', '');
            INSERT INTO workflow_schedule_timers (
                workflow_id, timer_node_id, next_run_at
            ) VALUES ('old-workflow', 'timer', 1);
            INSERT INTO workflow_runs (
                run_id, workflow_id, workflow_revision, status, trigger,
                inputs, node_results, outputs, created_at, updated_at
            ) VALUES (
                'old-run', 'old-workflow', 1, 'success', 'manual',
                '{}', '[]', '{}', 0, 0
            );
            INSERT INTO providers (id, name, type, base_url, api_key)
            VALUES ('provider', 'Provider', 'openai', '', 'secret');
            INSERT INTO provider_models (provider_id, model, position)
            VALUES ('provider', 'model', 0);
            """
        )

    database = SQLiteDatabase(tmp_path)
    store = StateStore(database=database)
    state = store.read_state()

    assert state.workflows == []
    assert [provider.id for provider in state.providers] == ["provider"]
    with database.connect() as connection:
        assert (
            connection.execute("SELECT COUNT(*) FROM workflow_runs").fetchone()[0] == 0
        )
        assert (
            connection.execute("SELECT COUNT(*) FROM workflow_schedules").fetchone()[0]
            == 0
        )
        workflow_columns = {
            row[1] for row in connection.execute("PRAGMA table_info(workflows)")
        }
    assert {"spec", "presentation", "revision", "active_revision"}.issubset(
        workflow_columns
    )
