import json
import sqlite3
from pathlib import Path

from flowent.llm import ChatMessage, ReasoningEffort
from flowent.state.database import SQLiteDatabase
from flowent.state.models import (
    StoredAssistantOutputGroup,
    StoredCompactionCheckpoint,
    StoredMcpServer,
    StoredMcpTool,
    StoredMessage,
    StoredProvider,
    StoredSettings,
    StoredState,
    StoredTelegramBot,
    StoredTelegramSession,
    StoredToolItem,
    StoredWritablePath,
)
from flowent.state.workflow_repository import WorkflowRepository
from flowent.usage import TokenUsageInfo


class StateStore:
    def __init__(
        self,
        directory: Path | None = None,
        *,
        database: SQLiteDatabase | None = None,
    ) -> None:
        self.database = database or SQLiteDatabase(directory)
        self.directory = self.database.directory
        self.database_path = self.database.path

    def connect(self) -> sqlite3.Connection:
        return self.database.connect()

    def read_state(self) -> StoredState:
        workflows = WorkflowRepository(self.database).read_workflows()
        with self.connect() as connection:
            mcp_servers = self._read_mcp_servers(connection)
            telegram_bot = self._read_telegram_bot(connection)
            writable_paths = self._read_writable_paths(connection)
            providers = [
                StoredProvider(
                    api_key=row["api_key"],
                    base_url=row["base_url"],
                    id=row["id"],
                    models=self._provider_models(connection, row["id"]),
                    name=row["name"],
                    type=row["type"],
                )
                for row in connection.execute(
                    """
                    SELECT id, name, type, base_url, api_key
                    FROM providers
                    ORDER BY created_at, id
                    """
                )
            ]
            settings_row = connection.execute(
                """
                SELECT selected_provider_id, selected_model, reasoning_effort, agent_prompt, context_window_limit
                FROM settings
                WHERE id = 1
                """
            ).fetchone()
            messages = [
                StoredMessage(
                    author=row["author"],
                    content=row["content"],
                    groups=[
                        StoredAssistantOutputGroup.model_validate(group)
                        for group in json.loads(row["groups"] or "[]")
                    ],
                    id=row["id"],
                    status=row["status"],
                    summary=row["summary"],
                    thinking=row["thinking"],
                    tools=[
                        StoredToolItem.model_validate(tool)
                        for tool in json.loads(row["tools"] or "[]")
                    ],
                    usage_info=TokenUsageInfo.model_validate_json(row["usage_info"])
                    if row["usage_info"]
                    else None,
                )
                for row in connection.execute(
                    """
                    SELECT id, author, content, summary, tools, thinking, groups, status, usage_info
                    FROM messages
                    ORDER BY position, id
                    """
                )
            ]
            usage_row = connection.execute(
                """
                SELECT is_compacting, usage_info
                FROM workspace_context
                WHERE id = 1
                """
            ).fetchone()
            usage_info = (
                TokenUsageInfo.model_validate_json(usage_row["usage_info"])
                if usage_row and usage_row["usage_info"]
                else None
            )

        return StoredState(
            mcp_servers=mcp_servers,
            is_compacting=bool(usage_row["is_compacting"]) if usage_row else False,
            messages=messages,
            providers=providers,
            settings=StoredSettings(
                agent_prompt=settings_row["agent_prompt"] if settings_row else "",
                context_window_limit=settings_row["context_window_limit"]
                if settings_row
                else None,
                reasoning_effort=settings_row["reasoning_effort"]
                if settings_row
                else ReasoningEffort.DEFAULT,
                selected_model=settings_row["selected_model"] if settings_row else "",
                selected_provider_id=settings_row["selected_provider_id"]
                if settings_row
                else "",
            ),
            skills=[],
            telegram_bot=telegram_bot,
            usage_info=usage_info,
            writable_paths=writable_paths,
            workflows=workflows,
        )

    def read_writable_paths(self) -> list[StoredWritablePath]:
        with self.connect() as connection:
            return self._read_writable_paths(connection)

    def save_writable_path(self, path: Path) -> StoredWritablePath:
        normalized_path = str(path.expanduser().resolve(strict=False))
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO writable_paths (path)
                VALUES (?)
                ON CONFLICT(path) DO NOTHING
                """,
                (normalized_path,),
            )
            row = connection.execute(
                """
                SELECT path, created_at
                FROM writable_paths
                WHERE path = ?
                """,
                (normalized_path,),
            ).fetchone()
        return StoredWritablePath(path=row["path"], created_at=row["created_at"])

    def delete_writable_path(self, path: Path) -> list[StoredWritablePath]:
        normalized_path = str(path.expanduser().resolve(strict=False))
        with self.connect() as connection:
            connection.execute(
                "DELETE FROM writable_paths WHERE path = ?", (normalized_path,)
            )
            return self._read_writable_paths(connection)

    def read_skill_enabled(self) -> dict[str, bool]:
        with self.connect() as connection:
            return {
                row["id"]: bool(row["enabled"])
                for row in connection.execute(
                    """
                    SELECT id, enabled
                    FROM skill_settings
                    ORDER BY id
                    """
                )
            }

    def save_skill_enabled(self, skill_id: str, enabled: bool) -> None:
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO skill_settings (id, enabled)
                VALUES (?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    enabled = excluded.enabled,
                    updated_at = unixepoch()
                """,
                (skill_id, int(enabled)),
            )

    def read_mcp_servers(self) -> list[StoredMcpServer]:
        with self.connect() as connection:
            return self._read_mcp_servers(connection)

    def save_mcp_server(self, server: StoredMcpServer) -> StoredMcpServer:
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO mcp_servers (
                    id,
                    name,
                    type,
                    command,
                    args,
                    config,
                    url,
                    enabled
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    type = excluded.type,
                    command = excluded.command,
                    args = excluded.args,
                    config = excluded.config,
                    url = excluded.url,
                    enabled = excluded.enabled,
                    updated_at = unixepoch()
                """,
                (
                    server.id,
                    server.name,
                    server.type,
                    server.command,
                    json.dumps(server.args),
                    json.dumps(server.config, ensure_ascii=False),
                    server.url,
                    int(server.enabled),
                ),
            )
            existing = [
                current_server
                for current_server in self._read_mcp_servers(connection)
                if current_server.id == server.id
            ]
        return existing[0] if existing else server

    def save_mcp_tools(
        self, server_id: str, tools: list[StoredMcpTool]
    ) -> list[StoredMcpTool]:
        with self.connect() as connection:
            connection.execute(
                "DELETE FROM mcp_tools WHERE server_id = ?", (server_id,)
            )
            connection.executemany(
                """
                INSERT INTO mcp_tools (
                    server_id,
                    name,
                    description,
                    input_schema,
                    output_schema,
                    position
                )
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        server_id,
                        tool.name,
                        tool.description,
                        json.dumps(tool.input_schema),
                        json.dumps(tool.output_schema)
                        if tool.output_schema is not None
                        else None,
                        position,
                    )
                    for position, tool in enumerate(tools)
                ],
            )
        return tools

    def delete_mcp_server(self, server_id: str) -> None:
        with self.connect() as connection:
            connection.execute("DELETE FROM mcp_servers WHERE id = ?", (server_id,))

    def read_telegram_bot(self) -> StoredTelegramBot:
        with self.connect() as connection:
            return self._read_telegram_bot(connection)

    def read_provider(self, provider_id: str) -> StoredProvider:
        with self.connect() as connection:
            return self._read_provider(connection, provider_id)

    def save_telegram_bot(self, telegram_bot: StoredTelegramBot) -> StoredTelegramBot:
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO telegram_bot (
                    id,
                    enabled,
                    bot_token
                )
                VALUES (1, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    enabled = excluded.enabled,
                    bot_token = CASE
                        WHEN excluded.bot_token <> '' THEN excluded.bot_token
                        ELSE telegram_bot.bot_token
                    END,
                    updated_at = unixepoch()
                """,
                (
                    int(telegram_bot.enabled),
                    telegram_bot.bot_token,
                ),
            )
            return self._read_telegram_bot(connection)

    def save_telegram_session(
        self, session: StoredTelegramSession
    ) -> StoredTelegramSession:
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO telegram_sessions (
                    chat_id,
                    user_id,
                    username,
                    display_name,
                    recent_message,
                    status
                )
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(chat_id) DO UPDATE SET
                    user_id = excluded.user_id,
                    username = excluded.username,
                    display_name = excluded.display_name,
                    recent_message = excluded.recent_message,
                    status = excluded.status,
                    updated_at = unixepoch()
                """,
                (
                    session.chat_id,
                    session.user_id,
                    session.username,
                    session.display_name,
                    session.recent_message,
                    session.status,
                ),
            )
        return session

    def approve_telegram_session(self, chat_id: str) -> StoredTelegramSession:
        with self.connect() as connection:
            connection.execute(
                """
                UPDATE telegram_sessions
                SET status = 'approved',
                    updated_at = unixepoch()
                WHERE chat_id = ?
                """,
                (chat_id,),
            )
            row = connection.execute(
                """
                SELECT
                    chat_id,
                    user_id,
                    username,
                    display_name,
                    recent_message,
                    status,
                    updated_at
                FROM telegram_sessions
                WHERE chat_id = ?
                """,
                (chat_id,),
            ).fetchone()
        if row is None:
            raise KeyError(chat_id)
        return StoredTelegramSession(
            chat_id=row["chat_id"],
            display_name=row["display_name"],
            recent_message=row["recent_message"],
            status=row["status"],
            updated_at=row["updated_at"],
            user_id=row["user_id"],
            username=row["username"],
        )

    def save_provider(self, provider: StoredProvider) -> StoredProvider:
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO providers (id, name, type, base_url, api_key)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    type = excluded.type,
                    base_url = excluded.base_url,
                    api_key = CASE
                        WHEN excluded.api_key <> '' THEN excluded.api_key
                        ELSE providers.api_key
                    END,
                    updated_at = unixepoch()
                """,
                (
                    provider.id,
                    provider.name,
                    provider.type.value,
                    provider.base_url,
                    provider.api_key,
                ),
            )
            connection.execute(
                "DELETE FROM provider_models WHERE provider_id = ?", (provider.id,)
            )
            connection.executemany(
                """
                INSERT INTO provider_models (provider_id, model, position)
                VALUES (?, ?, ?)
                """,
                [
                    (provider.id, model, position)
                    for position, model in enumerate(provider.models)
                ],
            )
            return self._read_provider(connection, provider.id)

    def delete_provider(self, provider_id: str) -> None:
        with self.connect() as connection:
            settings_row = connection.execute(
                """
                SELECT selected_provider_id
                FROM settings
                WHERE id = 1
                """
            ).fetchone()
            provider_rows = connection.execute(
                """
                SELECT id
                FROM providers
                ORDER BY created_at, id
                """
            ).fetchall()
            removed_index = next(
                (
                    index
                    for index, provider_row in enumerate(provider_rows)
                    if provider_row["id"] == provider_id
                ),
                -1,
            )
            remaining_provider_ids = [
                provider_row["id"]
                for provider_row in provider_rows
                if provider_row["id"] != provider_id
            ]
            connection.execute("DELETE FROM providers WHERE id = ?", (provider_id,))
            if settings_row and settings_row["selected_provider_id"] == provider_id:
                next_provider_id = ""
                if removed_index >= 0:
                    next_provider_id = (
                        remaining_provider_ids[removed_index]
                        if removed_index < len(remaining_provider_ids)
                        else remaining_provider_ids[removed_index - 1]
                        if remaining_provider_ids
                        else ""
                    )
                next_model = ""
                if next_provider_id:
                    model_row = connection.execute(
                        """
                        SELECT model
                        FROM provider_models
                        WHERE provider_id = ?
                        ORDER BY position, model
                        LIMIT 1
                        """,
                        (next_provider_id,),
                    ).fetchone()
                    next_model = model_row["model"] if model_row else ""
                connection.execute(
                    """
                    UPDATE settings
                    SET selected_provider_id = ?,
                        selected_model = ?,
                        updated_at = unixepoch()
                    WHERE id = 1
                    """,
                    (next_provider_id, next_model),
                )

    def save_settings(self, settings: StoredSettings) -> StoredSettings:
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO settings (
                    id,
                    selected_provider_id,
                    selected_model,
                    reasoning_effort,
                    agent_prompt,
                    context_window_limit
                )
                VALUES (1, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    selected_provider_id = excluded.selected_provider_id,
                    selected_model = excluded.selected_model,
                    reasoning_effort = excluded.reasoning_effort,
                    agent_prompt = excluded.agent_prompt,
                    context_window_limit = excluded.context_window_limit,
                    updated_at = unixepoch()
                """,
                (
                    settings.selected_provider_id,
                    settings.selected_model,
                    settings.reasoning_effort.value,
                    settings.agent_prompt,
                    settings.context_window_limit,
                ),
            )
        return settings

    def save_messages(self, messages: list[StoredMessage]) -> list[StoredMessage]:
        with self.connect() as connection:
            connection.execute("DELETE FROM messages")
            if messages:
                latest_usage_info = next(
                    (
                        message.usage_info
                        for message in reversed(messages)
                        if message.usage_info is not None
                    ),
                    None,
                )
                if latest_usage_info is not None:
                    connection.execute(
                        """
                        INSERT INTO workspace_context (id, usage_info)
                        VALUES (1, ?)
                        ON CONFLICT(id) DO UPDATE SET
                            usage_info = excluded.usage_info,
                            updated_at = unixepoch()
                        """,
                        (latest_usage_info.model_dump_json(),),
                    )
            connection.executemany(
                """
                INSERT INTO messages (
                    id,
                    author,
                    content,
                    summary,
                    tools,
                    thinking,
                    groups,
                    status,
                    usage_info,
                    position
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        message.id,
                        message.author,
                        message.content,
                        message.summary,
                        json.dumps(
                            [
                                tool.model_dump(exclude_none=True)
                                for tool in message.tools
                            ]
                        ),
                        message.thinking,
                        json.dumps(
                            [
                                group.model_dump(exclude_none=True)
                                for group in message.groups
                            ],
                            ensure_ascii=False,
                        ),
                        message.status,
                        message.usage_info.model_dump_json()
                        if message.usage_info
                        else None,
                        position,
                    )
                    for position, message in enumerate(messages)
                ],
            )
            if not messages:
                connection.execute("DELETE FROM workspace_context WHERE id = 1")
        return messages

    def upsert_message(self, message: StoredMessage) -> StoredMessage:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT position FROM messages WHERE id = ?", (message.id,)
            ).fetchone()
            if row:
                position = row["position"]
            else:
                position_row = connection.execute(
                    "SELECT COALESCE(MAX(position) + 1, 0) AS position FROM messages"
                ).fetchone()
                position = position_row["position"]
            connection.execute(
                """
                INSERT INTO messages (
                    id,
                    author,
                    content,
                    summary,
                    tools,
                    thinking,
                    groups,
                    status,
                    usage_info,
                    position
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    author = excluded.author,
                    content = excluded.content,
                    summary = excluded.summary,
                    tools = excluded.tools,
                    thinking = excluded.thinking,
                    groups = excluded.groups,
                    status = excluded.status,
                    usage_info = excluded.usage_info,
                    position = excluded.position
                """,
                (
                    message.id,
                    message.author,
                    message.content,
                    message.summary,
                    json.dumps(
                        [tool.model_dump(exclude_none=True) for tool in message.tools]
                    ),
                    message.thinking,
                    json.dumps(
                        [
                            group.model_dump(exclude_none=True)
                            for group in message.groups
                        ],
                        ensure_ascii=False,
                    ),
                    message.status,
                    message.usage_info.model_dump_json()
                    if message.usage_info
                    else None,
                    position,
                ),
            )
            if message.usage_info is not None:
                connection.execute(
                    """
                    INSERT INTO workspace_context (id, usage_info)
                    VALUES (1, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        usage_info = excluded.usage_info,
                        updated_at = unixepoch()
                    """,
                    (message.usage_info.model_dump_json(),),
                )
        return message

    def read_usage_info(self) -> TokenUsageInfo | None:
        with self.connect() as connection:
            row = connection.execute(
                """
                SELECT usage_info
                FROM workspace_context
                WHERE id = 1
                """
            ).fetchone()
        if row is None or not row["usage_info"]:
            return None
        return TokenUsageInfo.model_validate_json(row["usage_info"])

    def save_usage_info(self, usage_info: TokenUsageInfo) -> TokenUsageInfo:
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO workspace_context (id, usage_info)
                VALUES (1, ?)
                ON CONFLICT(id) DO UPDATE SET
                    usage_info = excluded.usage_info,
                    updated_at = unixepoch()
                """,
                (usage_info.model_dump_json(),),
            )
        return usage_info

    def read_compacted_context(self) -> str:
        with self.connect() as connection:
            row = connection.execute(
                """
                SELECT compacted_summary
                FROM workspace_context
                WHERE id = 1
                """
            ).fetchone()
        return row["compacted_summary"] if row else ""

    def save_compacted_context(self, summary: str) -> str:
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO workspace_context (id, compacted_summary)
                VALUES (1, ?)
                ON CONFLICT(id) DO UPDATE SET
                    compacted_summary = excluded.compacted_summary,
                    active_compaction_id = NULL,
                    usage_info = NULL,
                    updated_at = unixepoch()
                """,
                (summary,),
            )
        return summary

    def read_is_compacting(self) -> bool:
        with self.connect() as connection:
            row = connection.execute(
                """
                SELECT is_compacting
                FROM workspace_context
                WHERE id = 1
                """
            ).fetchone()
        return bool(row["is_compacting"]) if row else False

    def save_is_compacting(self, is_compacting: bool) -> bool:
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO workspace_context (id, is_compacting)
                VALUES (1, ?)
                ON CONFLICT(id) DO UPDATE SET
                    is_compacting = excluded.is_compacting,
                    updated_at = unixepoch()
                """,
                (int(is_compacting),),
            )
        return is_compacting

    def read_active_compaction_checkpoint(
        self,
    ) -> StoredCompactionCheckpoint | None:
        with self.connect() as connection:
            row = connection.execute(
                """
                SELECT
                    checkpoint.id,
                    checkpoint.trigger,
                    checkpoint.method,
                    checkpoint.summary,
                    checkpoint.replacement_history,
                    checkpoint.source_message_id,
                    checkpoint.token_before,
                    checkpoint.token_after,
                    checkpoint.created_at
                FROM workspace_context context
                JOIN compaction_checkpoints checkpoint
                    ON checkpoint.id = context.active_compaction_id
                WHERE context.id = 1
                """
            ).fetchone()
        if row is None:
            return None
        return StoredCompactionCheckpoint(
            created_at=row["created_at"],
            id=row["id"],
            method=row["method"],
            replacement_history=[
                ChatMessage.model_validate(message)
                for message in json.loads(row["replacement_history"] or "[]")
            ],
            source_message_id=row["source_message_id"],
            summary=row["summary"],
            token_after=row["token_after"],
            token_before=row["token_before"],
            trigger=row["trigger"],
        )

    def save_compaction_checkpoint(
        self, checkpoint: StoredCompactionCheckpoint
    ) -> StoredCompactionCheckpoint:
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO compaction_checkpoints (
                    id,
                    trigger,
                    method,
                    summary,
                    replacement_history,
                    source_message_id,
                    token_before,
                    token_after
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    trigger = excluded.trigger,
                    method = excluded.method,
                    summary = excluded.summary,
                    replacement_history = excluded.replacement_history,
                    source_message_id = excluded.source_message_id,
                    token_before = excluded.token_before,
                    token_after = excluded.token_after
                """,
                (
                    checkpoint.id,
                    checkpoint.trigger,
                    checkpoint.method,
                    checkpoint.summary,
                    json.dumps(
                        [
                            message.model_dump()
                            for message in checkpoint.replacement_history
                        ],
                        ensure_ascii=False,
                    ),
                    checkpoint.source_message_id,
                    checkpoint.token_before,
                    checkpoint.token_after,
                ),
            )
            connection.execute(
                """
                INSERT INTO workspace_context (
                    id,
                    compacted_summary,
                    active_compaction_id
                )
                VALUES (1, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    compacted_summary = excluded.compacted_summary,
                    active_compaction_id = excluded.active_compaction_id,
                    updated_at = unixepoch()
                """,
                (checkpoint.summary, checkpoint.id),
            )
            row = connection.execute(
                """
                SELECT created_at
                FROM compaction_checkpoints
                WHERE id = ?
                """,
                (checkpoint.id,),
            ).fetchone()
        return checkpoint.model_copy(update={"created_at": row["created_at"]})

    def _provider_models(
        self, connection: sqlite3.Connection, provider_id: str
    ) -> list[str]:
        return [
            row["model"]
            for row in connection.execute(
                """
                SELECT model
                FROM provider_models
                WHERE provider_id = ?
                ORDER BY position, model
                """,
                (provider_id,),
            )
        ]

    def _read_provider(
        self, connection: sqlite3.Connection, provider_id: str
    ) -> StoredProvider:
        row = connection.execute(
            """
            SELECT id, name, type, base_url, api_key
            FROM providers
            WHERE id = ?
            """,
            (provider_id,),
        ).fetchone()
        if row is None:
            raise KeyError(provider_id)
        return StoredProvider(
            api_key=row["api_key"],
            base_url=row["base_url"],
            id=row["id"],
            models=self._provider_models(connection, row["id"]),
            name=row["name"],
            type=row["type"],
        )

    def _read_telegram_bot(self, connection: sqlite3.Connection) -> StoredTelegramBot:
        bot_row = connection.execute(
            """
            SELECT enabled, bot_token
            FROM telegram_bot
            WHERE id = 1
            """
        ).fetchone()
        sessions = [
            StoredTelegramSession(
                chat_id=row["chat_id"],
                display_name=row["display_name"],
                recent_message=row["recent_message"],
                status=row["status"],
                updated_at=row["updated_at"],
                user_id=row["user_id"],
                username=row["username"],
            )
            for row in connection.execute(
                """
                SELECT
                    chat_id,
                    user_id,
                    username,
                    display_name,
                    recent_message,
                    status,
                    updated_at
                FROM telegram_sessions
                ORDER BY status DESC, updated_at DESC, chat_id
                """
            )
        ]
        return StoredTelegramBot(
            bot_token=bot_row["bot_token"] if bot_row else "",
            enabled=bool(bot_row["enabled"]) if bot_row else False,
            sessions=sessions,
        )

    def _read_mcp_servers(
        self, connection: sqlite3.Connection
    ) -> list[StoredMcpServer]:
        servers: list[StoredMcpServer] = []
        for row in connection.execute(
            """
            SELECT id, name, type, command, args, config, url, enabled
            FROM mcp_servers
            ORDER BY created_at, id
            """
        ):
            tools = [
                StoredMcpTool(
                    description=tool_row["description"],
                    input_schema=json.loads(tool_row["input_schema"] or "{}"),
                    name=tool_row["name"],
                    output_schema=json.loads(tool_row["output_schema"])
                    if tool_row["output_schema"]
                    else None,
                )
                for tool_row in connection.execute(
                    """
                    SELECT name, description, input_schema, output_schema
                    FROM mcp_tools
                    WHERE server_id = ?
                    ORDER BY position, name
                    """,
                    (row["id"],),
                )
            ]
            servers.append(
                StoredMcpServer(
                    args=json.loads(row["args"] or "[]"),
                    command=row["command"],
                    config=json.loads(row["config"] or "{}"),
                    enabled=bool(row["enabled"]),
                    id=row["id"],
                    name=row["name"],
                    status="disabled",
                    tools=tools,
                    type=row["type"],
                    url=row["url"],
                )
            )
        return servers

    def _read_writable_paths(
        self, connection: sqlite3.Connection
    ) -> list[StoredWritablePath]:
        return [
            StoredWritablePath(created_at=row["created_at"], path=row["path"])
            for row in connection.execute(
                """
                SELECT path, created_at
                FROM writable_paths
                ORDER BY path
                """
            )
        ]
