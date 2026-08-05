from collections.abc import Awaitable, Callable
from typing import Annotated, Any

from pydantic import Field

ChatId = Annotated[str, Field(min_length=1, max_length=64)]
ChatTitle = Annotated[str, Field(min_length=1, max_length=80)]
ChatPurpose = Annotated[str, Field(max_length=500)]
ChatMembers = Annotated[list[str], Field(min_length=1, max_length=64)]
MessageContent = Annotated[str, Field(min_length=1, max_length=20_000)]
MessageId = Annotated[str, Field(min_length=1, max_length=64)]
AgentDirectory = Callable[[], list[dict[str, Any]]]
ListChats = Callable[[str], Awaitable[list[dict[str, Any]]]]
CreateChat = Callable[[str, str, list[str], str], Awaitable[dict[str, Any]]]
ReadChat = Callable[[str, str], Awaitable[dict[str, Any]]]
SendMessage = Callable[[str, str, str], Awaitable[dict[str, Any]]]
MarkProcessed = Callable[[str, str, str], Awaitable[int]]


class ChatTools:
    def __init__(
        self,
        agent_id: str,
        agents: AgentDirectory,
        chats: ListChats,
        create: CreateChat,
        read: ReadChat,
        send: SendMessage,
        process: MarkProcessed,
    ):
        self.agent_id = agent_id
        self.agents = agents
        self.chats = chats
        self.create = create
        self.read = read
        self.send = send
        self.process = process

    @property
    def functions(self) -> list[Callable[..., Any]]:
        return [
            self.list_agents,
            self.list_chats,
            self.create_chat,
            self.read_chat,
            self.send_message,
            self.mark_processed,
        ]

    def list_agents(self) -> list[dict[str, Any]]:
        """List active Agents available for Chat membership."""
        return self.agents()

    async def list_chats(self) -> list[dict[str, Any]]:
        """List Chats joined by this Agent and their pending message counts."""
        return await self.chats(self.agent_id)

    async def create_chat(
        self,
        title: ChatTitle,
        purpose: ChatPurpose,
        members: ChatMembers,
    ) -> dict[str, Any]:
        """Create a Chat and include this Agent as a member."""
        return await self.create(title, purpose, members, self.agent_id)

    async def read_chat(self, chat_id: ChatId) -> dict[str, Any]:
        """Read a joined Chat without marking any message processed."""
        return await self.read(chat_id, self.agent_id)

    async def send_message(
        self,
        chat_id: ChatId,
        content: MessageContent,
    ) -> dict[str, Any]:
        """Send a message to a joined Chat as this Agent."""
        return await self.send(chat_id, content, self.agent_id)

    async def mark_processed(
        self,
        chat_id: ChatId,
        through_message_id: MessageId,
    ) -> dict[str, int]:
        """Mark pending messages through one message as processed."""
        return {
            "processed": await self.process(
                chat_id,
                self.agent_id,
                through_message_id,
            )
        }
