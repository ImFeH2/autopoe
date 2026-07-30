MIGRATIONS: tuple[tuple[int, str], ...] = (
    (
        1,
        """
        CREATE TABLE workflow_definitions (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            draft_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE workflow_versions (
            id TEXT PRIMARY KEY,
            workflow_id TEXT NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
            version INTEGER NOT NULL,
            definition_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(workflow_id, version)
        );

        CREATE TABLE workflow_runs (
            id TEXT PRIMARY KEY,
            workflow_version_id TEXT REFERENCES workflow_versions(id),
            status TEXT NOT NULL,
            input_json TEXT NOT NULL DEFAULT '{}',
            output_json TEXT,
            error TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            started_at TEXT,
            completed_at TEXT
        );

        CREATE TABLE agent_definitions (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            instructions TEXT NOT NULL,
            model TEXT NOT NULL,
            tools_json TEXT NOT NULL DEFAULT '[]',
            config_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE work_items (
            id TEXT PRIMARY KEY,
            workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
            node_id TEXT NOT NULL,
            status TEXT NOT NULL,
            input_json TEXT NOT NULL DEFAULT '{}',
            output_json TEXT,
            attempt INTEGER NOT NULL DEFAULT 0,
            max_attempts INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE agent_runs (
            id TEXT PRIMARY KEY,
            workflow_run_id TEXT REFERENCES workflow_runs(id) ON DELETE CASCADE,
            work_item_id TEXT REFERENCES work_items(id) ON DELETE SET NULL,
            agent_definition_id TEXT REFERENCES agent_definitions(id) ON DELETE SET NULL,
            node_id TEXT,
            status TEXT NOT NULL,
            attempt INTEGER NOT NULL DEFAULT 0,
            usage_json TEXT NOT NULL DEFAULT '{}',
            error TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            started_at TEXT,
            completed_at TEXT
        );

        CREATE TABLE messages (
            id TEXT PRIMARY KEY,
            agent_run_id TEXT REFERENCES agent_runs(id) ON DELETE CASCADE,
            role TEXT NOT NULL,
            content_json TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE event_streams (
            stream_id TEXT PRIMARY KEY,
            next_sequence INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_id TEXT NOT NULL UNIQUE,
            stream_id TEXT NOT NULL,
            sequence INTEGER NOT NULL,
            name TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            workflow_run_id TEXT,
            agent_run_id TEXT,
            run_id TEXT,
            created_at TEXT NOT NULL,
            UNIQUE(stream_id, sequence)
        );

        CREATE INDEX events_stream_sequence ON events(stream_id, sequence);
        CREATE INDEX events_workflow_run ON events(workflow_run_id, id);
        CREATE INDEX events_agent_run ON events(agent_run_id, id);

        CREATE TABLE artifacts (
            id TEXT PRIMARY KEY,
            workflow_run_id TEXT REFERENCES workflow_runs(id) ON DELETE SET NULL,
            agent_run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
            kind TEXT NOT NULL,
            name TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            storage_path TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            size INTEGER NOT NULL,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL
        );

        CREATE INDEX artifacts_workflow_run ON artifacts(workflow_run_id, created_at);
        CREATE INDEX artifacts_content_hash ON artifacts(content_hash);

        CREATE TABLE approvals (
            id TEXT PRIMARY KEY,
            workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
            agent_run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
            status TEXT NOT NULL,
            kind TEXT NOT NULL,
            prompt TEXT NOT NULL,
            response_json TEXT,
            created_at TEXT NOT NULL,
            resolved_at TEXT
        );

        CREATE TABLE settings (
            key TEXT PRIMARY KEY,
            value_json TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        """,
    ),
    (
        2,
        """
        ALTER TABLE agent_runs ADD COLUMN conversation_id TEXT;
        ALTER TABLE agent_runs ADD COLUMN provider TEXT NOT NULL DEFAULT 'unknown';
        ALTER TABLE agent_runs ADD COLUMN model TEXT NOT NULL DEFAULT 'unknown';

        CREATE INDEX agent_runs_conversation ON agent_runs(conversation_id, created_at);
        """,
    ),
    (
        3,
        """
        ALTER TABLE approvals RENAME TO approvals_legacy;

        CREATE TABLE approvals (
            id TEXT PRIMARY KEY,
            workflow_run_id TEXT REFERENCES workflow_runs(id) ON DELETE CASCADE,
            agent_run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
            run_id TEXT,
            tool_call_id TEXT,
            status TEXT NOT NULL,
            kind TEXT NOT NULL,
            prompt TEXT NOT NULL,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            response_json TEXT,
            created_at TEXT NOT NULL,
            resolved_at TEXT
        );

        INSERT INTO approvals(
            id, workflow_run_id, agent_run_id, status, kind, prompt,
            response_json, created_at, resolved_at
        )
        SELECT
            id, workflow_run_id, agent_run_id, status, kind, prompt,
            response_json, created_at, resolved_at
        FROM approvals_legacy;

        DROP TABLE approvals_legacy;

        CREATE INDEX approvals_workflow_run ON approvals(workflow_run_id, created_at);
        CREATE INDEX approvals_agent_run ON approvals(agent_run_id, created_at);

        ALTER TABLE workflow_runs ADD COLUMN workspace_json TEXT;
        """,
    ),
)
