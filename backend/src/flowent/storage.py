import json
import sqlite3
from pathlib import Path
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, PositiveInt

from flowent.llm import ChatMessage, ProviderFormat, ReasoningEffort
from flowent.paths import data_directory
from flowent.usage import TokenUsageInfo


class StoredTelegramSession(BaseModel):
    model_config = ConfigDict(extra="forbid")

    chat_id: str
    display_name: str = ""
    recent_message: str = ""
    status: str
    updated_at: int = 0
    user_id: str = ""
    username: str = ""


class StoredTelegramBot(BaseModel):
    model_config = ConfigDict(extra="forbid")

    bot_token: str
    enabled: bool
    error: str = ""
    sessions: list[StoredTelegramSession] = Field(default_factory=list)
    status: str = "disabled"


class StoredMcpTool(BaseModel):
    model_config = ConfigDict(extra="forbid")

    description: str = ""
    input_schema: dict[str, object] = Field(default_factory=dict)
    name: str
    output_schema: dict[str, object] | None = None


class StoredMcpServer(BaseModel):
    model_config = ConfigDict(extra="forbid")

    args: list[str] = Field(default_factory=list)
    command: str = ""
    config: dict[str, object] = Field(default_factory=dict)
    enabled: bool = True
    error: str = ""
    id: str
    name: str
    status: str = "disabled"
    tools: list[StoredMcpTool] = Field(default_factory=list)
    type: str
    url: str = ""


class StoredSkill(BaseModel):
    model_config = ConfigDict(extra="forbid")

    description: str
    enabled: bool = True
    error: str = ""
    id: str
    name: str
    path: str
    scope: str
    slug: str


class StoredWritablePath(BaseModel):
    model_config = ConfigDict(extra="forbid")

    created_at: int = 0
    path: str


class StoredProvider(BaseModel):
    model_config = ConfigDict(extra="forbid")

    api_key: str
    base_url: str
    id: str
    models: list[str]
    name: str
    type: ProviderFormat


class StoredSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    agent_prompt: str = Field(default="", exclude_if=lambda value: value == "")
    context_window_limit: PositiveInt | None = None
    reasoning_effort: ReasoningEffort = ReasoningEffort.DEFAULT
    selected_model: str
    selected_provider_id: str


class StoredToolItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    status: str
    title: str
    arguments: dict[str, object] | None = None
    content: str | None = None
    data: dict[str, object] | None = None


class StoredThinkingOutputItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content: str
    id: str
    type: Literal["thinking"]


class StoredTextOutputItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content: str
    id: str
    type: Literal["text"]


class StoredErrorOutputItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    detail: str = Field(default="", exclude_if=lambda value: value == "")
    id: str
    message: str
    title: str
    type: Literal["error"]


class StoredToolOutputItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    tool: StoredToolItem
    type: Literal["tool"]


StoredOutputItem = Annotated[
    StoredThinkingOutputItem
    | StoredTextOutputItem
    | StoredErrorOutputItem
    | StoredToolOutputItem,
    Field(discriminator="type"),
]


class StoredAssistantOutputGroup(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    items: list[StoredOutputItem]


class StoredMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    author: str
    content: str
    groups: list[StoredAssistantOutputGroup] = Field(
        default_factory=list, exclude_if=lambda value: value == []
    )
    id: str
    status: str = Field(
        default="completed", exclude_if=lambda value: value == "completed"
    )
    thinking: str = Field(default="", exclude_if=lambda value: value == "")
    tools: list[StoredToolItem] = Field(default_factory=list)
    usage_info: TokenUsageInfo | None = Field(
        default=None, exclude_if=lambda value: value is None
    )


class StoredCompactionCheckpoint(BaseModel):
    model_config = ConfigDict(extra="forbid")

    created_at: int = 0
    id: str
    method: str
    replacement_history: list[ChatMessage]
    source_message_id: str | None = None
    summary: str
    token_after: int = 0
    token_before: int = 0
    trigger: str


class StoredState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    active_run_event_index: int = 0
    active_run_id: str | None = None
    is_compacting: bool = False
    mcp_servers: list[StoredMcpServer]
    messages: list[StoredMessage]
    providers: list[StoredProvider]
    settings: StoredSettings
    skills: list[StoredSkill]
    telegram_bot: StoredTelegramBot
    usage_info: TokenUsageInfo | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    writable_paths: list[StoredWritablePath] = Field(default_factory=list)


class StateStore:
    def __init__(self, directory: Path | None = None) -> None:
        self.directory = directory or data_directory()
        self.database_path = self.directory / "flowent.db"

    def connect(self) -> sqlite3.Connection:
        self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        connection = sqlite3.connect(self.database_path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA journal_mode = WAL")
        connection.execute("PRAGMA busy_timeout = 5000")
        self._migrate(connection)
        return connection

    def read_state(self) -> StoredState:
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
                    SELECT id, author, content, tools, thinking, groups, status, usage_info
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
                    bot_token = excluded.bot_token,
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
                    api_key = excluded.api_key,
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
        return provider

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
                    tools,
                    thinking,
                    groups,
                    status,
                    usage_info,
                    position
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        message.id,
                        message.author,
                        message.content,
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
                    tools,
                    thinking,
                    groups,
                    status,
                    usage_info,
                    position
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    author = excluded.author,
                    content = excluded.content,
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

    def _migrate(self, connection: sqlite3.Connection) -> None:
        connection.executescript(
            """
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
        columns = {
            row["name"] for row in connection.execute("PRAGMA table_info(mcp_servers)")
        }
        if "config" not in columns:
            connection.execute(
                """
                ALTER TABLE mcp_servers
                ADD COLUMN config TEXT NOT NULL DEFAULT '{}'
                """
            )
        columns = {
            row["name"] for row in connection.execute("PRAGMA table_info(messages)")
        }
        if "tools" not in columns:
            connection.execute(
                "ALTER TABLE messages ADD COLUMN tools TEXT NOT NULL DEFAULT '[]'"
            )
        if "thinking" not in columns:
            connection.execute(
                "ALTER TABLE messages ADD COLUMN thinking TEXT NOT NULL DEFAULT ''"
            )
        if "status" not in columns:
            connection.execute(
                "ALTER TABLE messages ADD COLUMN status TEXT NOT NULL DEFAULT 'completed'"
            )
        if "groups" not in columns:
            connection.execute(
                "ALTER TABLE messages ADD COLUMN groups TEXT NOT NULL DEFAULT '[]'"
            )
        if "usage_info" not in columns:
            connection.execute("ALTER TABLE messages ADD COLUMN usage_info TEXT")
        settings_columns = {
            row["name"] for row in connection.execute("PRAGMA table_info(settings)")
        }
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
        workspace_context_columns = {
            row["name"]
            for row in connection.execute("PRAGMA table_info(workspace_context)")
        }
        if "active_compaction_id" not in workspace_context_columns:
            connection.execute(
                "ALTER TABLE workspace_context ADD COLUMN active_compaction_id TEXT"
            )
        if "usage_info" not in workspace_context_columns:
            connection.execute(
                "ALTER TABLE workspace_context ADD COLUMN usage_info TEXT"
            )
        if "is_compacting" not in workspace_context_columns:
            connection.execute(
                "ALTER TABLE workspace_context "
                "ADD COLUMN is_compacting INTEGER NOT NULL DEFAULT 0"
            )
