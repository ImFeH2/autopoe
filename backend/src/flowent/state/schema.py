import sqlite3


def migrate(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS workflows (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            definition TEXT NOT NULL,
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        );

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


def table_columns(connection: sqlite3.Connection, table: str) -> set[str]:
    return {row["name"] for row in connection.execute(f"PRAGMA table_info({table})")}
