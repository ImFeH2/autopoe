import json
import sqlite3


def migrate(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS workflows (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            spec TEXT NOT NULL,
            presentation TEXT NOT NULL,
            revision INTEGER NOT NULL,
            active_revision INTEGER,
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE TABLE IF NOT EXISTS workflow_revisions (
            workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
            revision INTEGER NOT NULL,
            spec TEXT NOT NULL,
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            PRIMARY KEY (workflow_id, revision)
        );

        CREATE TABLE IF NOT EXISTS workflow_runs (
            run_id TEXT PRIMARY KEY,
            workflow_id TEXT NOT NULL,
            workflow_revision INTEGER NOT NULL,
            status TEXT NOT NULL,
            trigger TEXT NOT NULL,
            inputs TEXT NOT NULL DEFAULT '{}',
            node_results TEXT NOT NULL DEFAULT '[]',
            outputs TEXT NOT NULL DEFAULT '{}',
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
            FOREIGN KEY (workflow_id, workflow_revision)
                REFERENCES workflow_revisions(workflow_id, revision)
                ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS workflow_runs_workflow_created
        ON workflow_runs(workflow_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS workflow_agent_histories (
            workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
            node_id TEXT NOT NULL,
            messages TEXT NOT NULL DEFAULT '[]',
            updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
            PRIMARY KEY (workflow_id, node_id)
        );

        CREATE TABLE IF NOT EXISTS workflow_schedules (
            workflow_id TEXT PRIMARY KEY REFERENCES workflows(id) ON DELETE CASCADE,
            status TEXT NOT NULL DEFAULT 'stopped',
            generation INTEGER NOT NULL DEFAULT 0,
            scheduled_revision INTEGER,
            running_revision INTEGER,
            running_run_id TEXT NOT NULL DEFAULT '',
            running_timer_node_id TEXT NOT NULL DEFAULT '',
            default_input TEXT NOT NULL DEFAULT '',
            inputs TEXT NOT NULL DEFAULT '{}',
            timezone TEXT NOT NULL DEFAULT 'UTC',
            last_run_at REAL,
            last_result TEXT,
            last_error TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE TABLE IF NOT EXISTS workflow_schedule_timers (
            workflow_id TEXT NOT NULL REFERENCES workflow_schedules(workflow_id) ON DELETE CASCADE,
            timer_node_id TEXT NOT NULL,
            next_run_at REAL,
            PRIMARY KEY (workflow_id, timer_node_id)
        );

        CREATE INDEX IF NOT EXISTS workflow_schedule_timers_next_run
        ON workflow_schedule_timers(next_run_at);

        CREATE TABLE IF NOT EXISTS mcp_servers (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            command TEXT NOT NULL DEFAULT '',
            args TEXT NOT NULL DEFAULT '[]',
            config TEXT NOT NULL DEFAULT '{}',
            url TEXT NOT NULL DEFAULT '',
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE TABLE IF NOT EXISTS mcp_tools (
            server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            input_schema TEXT NOT NULL DEFAULT '{}',
            output_schema TEXT,
            position INTEGER NOT NULL,
            PRIMARY KEY (server_id, name)
        );

        CREATE TABLE IF NOT EXISTS telegram_bot (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            enabled INTEGER NOT NULL DEFAULT 0,
            bot_token TEXT NOT NULL,
            updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE TABLE IF NOT EXISTS telegram_sessions (
            chat_id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL DEFAULT '',
            username TEXT NOT NULL DEFAULT '',
            display_name TEXT NOT NULL DEFAULT '',
            recent_message TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL,
            updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE TABLE IF NOT EXISTS providers (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            base_url TEXT NOT NULL,
            api_key TEXT NOT NULL,
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE TABLE IF NOT EXISTS provider_models (
            provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
            model TEXT NOT NULL,
            position INTEGER NOT NULL,
            PRIMARY KEY (provider_id, model)
        );

        CREATE TABLE IF NOT EXISTS settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            selected_provider_id TEXT NOT NULL DEFAULT '',
            selected_model TEXT NOT NULL DEFAULT '',
            reasoning_effort TEXT NOT NULL DEFAULT 'default',
            agent_prompt TEXT NOT NULL DEFAULT '',
            context_window_limit INTEGER,
            updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            author TEXT NOT NULL,
            content TEXT NOT NULL,
            summary TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'completed',
            usage_info TEXT,
            position INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS workspace_context (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            compacted_summary TEXT NOT NULL DEFAULT '',
            active_compaction_id TEXT,
            is_compacting INTEGER NOT NULL DEFAULT 0,
            usage_info TEXT,
            updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE TABLE IF NOT EXISTS compaction_checkpoints (
            id TEXT PRIMARY KEY,
            trigger TEXT NOT NULL,
            method TEXT NOT NULL,
            summary TEXT NOT NULL,
            replacement_history TEXT NOT NULL DEFAULT '[]',
            source_message_id TEXT,
            token_before INTEGER NOT NULL DEFAULT 0,
            token_after INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE TABLE IF NOT EXISTS skill_settings (
            id TEXT PRIMARY KEY,
            enabled INTEGER NOT NULL DEFAULT 1,
            updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE TABLE IF NOT EXISTS writable_paths (
            path TEXT PRIMARY KEY,
            created_at INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY
        );

        INSERT OR IGNORE INTO schema_migrations (version) VALUES (1);
        """
    )
    mcp_server_columns = table_columns(connection, "mcp_servers")
    if "config" not in mcp_server_columns:
        connection.execute(
            """
            ALTER TABLE mcp_servers
            ADD COLUMN config TEXT NOT NULL DEFAULT '{}'
            """
        )
    message_columns = table_columns(connection, "messages")
    if "tools" not in message_columns:
        connection.execute(
            "ALTER TABLE messages ADD COLUMN tools TEXT NOT NULL DEFAULT '[]'"
        )
    if "thinking" not in message_columns:
        connection.execute(
            "ALTER TABLE messages ADD COLUMN thinking TEXT NOT NULL DEFAULT ''"
        )
    if "status" not in message_columns:
        connection.execute(
            "ALTER TABLE messages ADD COLUMN status TEXT NOT NULL DEFAULT 'completed'"
        )
    if "groups" not in message_columns:
        connection.execute(
            "ALTER TABLE messages ADD COLUMN groups TEXT NOT NULL DEFAULT '[]'"
        )
    if "usage_info" not in message_columns:
        connection.execute("ALTER TABLE messages ADD COLUMN usage_info TEXT")
    if "summary" not in message_columns:
        connection.execute(
            "ALTER TABLE messages ADD COLUMN summary TEXT NOT NULL DEFAULT ''"
        )
    settings_columns = table_columns(connection, "settings")
    if "reasoning_effort" not in settings_columns:
        connection.execute(
            "ALTER TABLE settings "
            "ADD COLUMN reasoning_effort TEXT NOT NULL DEFAULT 'default'"
        )
    if "agent_prompt" not in settings_columns:
        connection.execute(
            "ALTER TABLE settings ADD COLUMN agent_prompt TEXT NOT NULL DEFAULT ''"
        )
    if "context_window_limit" not in settings_columns:
        connection.execute(
            "ALTER TABLE settings ADD COLUMN context_window_limit INTEGER"
        )
    workspace_context_columns = table_columns(connection, "workspace_context")
    if "active_compaction_id" not in workspace_context_columns:
        connection.execute(
            "ALTER TABLE workspace_context ADD COLUMN active_compaction_id TEXT"
        )
    if "usage_info" not in workspace_context_columns:
        connection.execute("ALTER TABLE workspace_context ADD COLUMN usage_info TEXT")
    if "is_compacting" not in workspace_context_columns:
        connection.execute(
            "ALTER TABLE workspace_context "
            "ADD COLUMN is_compacting INTEGER NOT NULL DEFAULT 0"
        )
    if not migration_version_exists(connection, 2):
        migrate_tool_result_items(connection)
        connection.execute("INSERT INTO schema_migrations (version) VALUES (2)")
    if not migration_version_exists(connection, 3):
        migrate_workflow_contract(connection)
        connection.execute("INSERT INTO schema_migrations (version) VALUES (3)")
    if not migration_version_exists(connection, 4):
        migrate_workflow_schedule_state(connection)
        connection.execute("INSERT INTO schema_migrations (version) VALUES (4)")


def table_columns(connection: sqlite3.Connection, table: str) -> set[str]:
    return {row["name"] for row in connection.execute(f"PRAGMA table_info({table})")}


def migration_version_exists(connection: sqlite3.Connection, version: int) -> bool:
    return (
        connection.execute(
            "SELECT 1 FROM schema_migrations WHERE version = ?",
            (version,),
        ).fetchone()
        is not None
    )


def migrate_workflow_contract(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        DROP TABLE IF EXISTS workflow_schedule_timers;
        DROP TABLE IF EXISTS workflow_schedules;
        DROP TABLE IF EXISTS workflow_runs;
        DROP TABLE IF EXISTS workflow_revisions;
        DROP TABLE IF EXISTS workflow_agent_histories;
        DROP TABLE IF EXISTS workflows;

        CREATE TABLE workflows (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            spec TEXT NOT NULL,
            presentation TEXT NOT NULL,
            revision INTEGER NOT NULL,
            active_revision INTEGER,
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE TABLE workflow_revisions (
            workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
            revision INTEGER NOT NULL,
            spec TEXT NOT NULL,
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            PRIMARY KEY (workflow_id, revision)
        );

        CREATE TABLE workflow_runs (
            run_id TEXT PRIMARY KEY,
            workflow_id TEXT NOT NULL,
            workflow_revision INTEGER NOT NULL,
            status TEXT NOT NULL,
            trigger TEXT NOT NULL,
            inputs TEXT NOT NULL DEFAULT '{}',
            node_results TEXT NOT NULL DEFAULT '[]',
            outputs TEXT NOT NULL DEFAULT '{}',
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
            FOREIGN KEY (workflow_id, workflow_revision)
                REFERENCES workflow_revisions(workflow_id, revision)
                ON DELETE CASCADE
        );

        CREATE INDEX workflow_runs_workflow_created
        ON workflow_runs(workflow_id, created_at DESC);

        CREATE TABLE workflow_agent_histories (
            workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
            node_id TEXT NOT NULL,
            messages TEXT NOT NULL DEFAULT '[]',
            updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
            PRIMARY KEY (workflow_id, node_id)
        );

        CREATE TABLE workflow_schedules (
            workflow_id TEXT PRIMARY KEY REFERENCES workflows(id) ON DELETE CASCADE,
            status TEXT NOT NULL DEFAULT 'stopped',
            generation INTEGER NOT NULL DEFAULT 0,
            scheduled_revision INTEGER,
            running_revision INTEGER,
            running_run_id TEXT NOT NULL DEFAULT '',
            running_timer_node_id TEXT NOT NULL DEFAULT '',
            default_input TEXT NOT NULL DEFAULT '',
            inputs TEXT NOT NULL DEFAULT '{}',
            timezone TEXT NOT NULL DEFAULT 'UTC',
            last_run_at REAL,
            last_result TEXT,
            last_error TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE TABLE workflow_schedule_timers (
            workflow_id TEXT NOT NULL REFERENCES workflow_schedules(workflow_id) ON DELETE CASCADE,
            timer_node_id TEXT NOT NULL,
            next_run_at REAL,
            PRIMARY KEY (workflow_id, timer_node_id)
        );

        CREATE INDEX workflow_schedule_timers_next_run
        ON workflow_schedule_timers(next_run_at);
        """
    )


def migrate_workflow_schedule_state(connection: sqlite3.Connection) -> None:
    columns = table_columns(connection, "workflow_schedules")
    additions = {
        "scheduled_revision": "INTEGER",
        "running_revision": "INTEGER",
        "running_run_id": "TEXT NOT NULL DEFAULT ''",
        "running_timer_node_id": "TEXT NOT NULL DEFAULT ''",
    }
    for name, definition in additions.items():
        if name not in columns:
            connection.execute(
                f"ALTER TABLE workflow_schedules ADD COLUMN {name} {definition}"
            )


def migrate_tool_result_items(connection: sqlite3.Connection) -> None:
    for row in connection.execute("SELECT id, tools, groups FROM messages"):
        tools, tools_changed = migrate_tool_list(json.loads(row["tools"] or "[]"))
        groups, groups_changed = migrate_tool_groups(json.loads(row["groups"] or "[]"))
        if not tools_changed and not groups_changed:
            continue
        connection.execute(
            "UPDATE messages SET tools = ?, groups = ? WHERE id = ?",
            (
                json.dumps(tools, ensure_ascii=False),
                json.dumps(groups, ensure_ascii=False),
                row["id"],
            ),
        )


def migrate_tool_groups(groups: object) -> tuple[object, bool]:
    if not isinstance(groups, list):
        return groups, False
    changed = False
    next_groups: list[object] = []
    for group in groups:
        if not isinstance(group, dict):
            next_groups.append(group)
            continue
        items = group.get("items")
        if not isinstance(items, list):
            next_groups.append(group)
            continue
        next_items: list[object] = []
        for item in items:
            if not isinstance(item, dict) or item.get("type") != "tool":
                next_items.append(item)
                continue
            tool, tool_changed = migrate_tool_item(item.get("tool"))
            changed = changed or tool_changed
            next_items.append({**item, "tool": tool})
        next_groups.append({**group, "items": next_items})
    return next_groups, changed


def migrate_tool_list(tools: object) -> tuple[object, bool]:
    if not isinstance(tools, list):
        return tools, False
    changed = False
    next_tools: list[object] = []
    for tool in tools:
        next_tool, tool_changed = migrate_tool_item(tool)
        changed = changed or tool_changed
        next_tools.append(next_tool)
    return next_tools, changed


def migrate_tool_item(tool: object) -> tuple[object, bool]:
    if not isinstance(tool, dict):
        return tool, False
    if "content" not in tool and "data" not in tool:
        return tool, False
    legacy_content = tool.get("content")
    legacy_data = tool.get("data")
    result = tool.get("result")
    if not isinstance(result, dict):
        result = legacy_tool_result(legacy_content, legacy_data)
    return (
        {
            key: value
            for key, value in {**tool, "result": result}.items()
            if key not in {"content", "data"}
        },
        True,
    )


def legacy_tool_result(content: object, data: object) -> dict[str, object]:
    text = content if isinstance(content, str) else ""
    payload = data if isinstance(data, dict) else {}
    if {"command", "exit_code", "stderr", "stdout"}.issubset(payload):
        return {
            "type": "command",
            "command": str(payload.get("command") or ""),
            "exit_code": payload.get("exit_code"),
            "stderr": str(payload.get("stderr") or ""),
            "stdout": str(payload.get("stdout") or ""),
            "output": text or str(payload.get("stdout") or payload.get("stderr") or ""),
        }
    if "server" in payload and "tool" in payload and "result" in payload:
        return {
            "type": "mcp",
            "output": text,
            "server": payload.get("server"),
            "tool": payload.get("tool"),
            "raw_result": payload.get("result"),
        }
    if "items" in payload:
        return {"type": "plan", "output": text, **payload}
    if "results" in payload and "query" in payload:
        return {"type": "web_search", "output": text, **payload}
    if "files" in payload:
        return {"type": "patch", "output": text, **payload}
    return {"type": "text", "text": text, **payload}
