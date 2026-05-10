from __future__ import annotations

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from typing import ClassVar

    from flowent.agent import Agent

MINIMUM_TOOLS = (
    "idle",
    "sleep",
    "todo",
    "contacts",
    "send",
)

ASSISTANT_ONLY_TOOLS = frozenset(
    {
        "create_workflow",
        "delete_workflow",
        "list_workflows",
        "manage_providers",
        "manage_roles",
        "manage_settings",
        "manage_prompts",
    }
)


def is_assistant_only_tool_name(tool_name: str) -> bool:
    return tool_name in ASSISTANT_ONLY_TOOLS


class Tool(ABC):
    name: str
    description: str
    parameters: ClassVar[dict[str, Any]]
    agent_visible: ClassVar[bool] = True
    llm_visible: ClassVar[bool] = True

    @abstractmethod
    def execute(
        self, agent: Agent, args: dict[str, Any], **kwargs: Any
    ) -> str | None: ...

    def to_schema(self) -> dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }


def re_raise_interrupt(agent: Agent, exc: BaseException) -> None:
    from flowent.agent import InterruptRequestedError

    if isinstance(exc, InterruptRequestedError) or agent.is_interrupt_requested():
        raise InterruptRequestedError() from exc


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, Tool] = {}

    def register(self, tool: Tool) -> None:
        self._tools[tool.name] = tool

    def get(self, name: str) -> Tool | None:
        return self._tools.get(name)

    def list_tools(self, *, agent_visible_only: bool = False) -> list[Tool]:
        tools = list(self._tools.values())
        if not agent_visible_only:
            return tools
        return [tool for tool in tools if tool.agent_visible]

    def get_tools_for_agent(self, agent: Agent) -> list[Tool]:
        from flowent.models import NodeType
        from flowent.settings import find_role, get_settings

        allowed = set(agent.config.tools) | set(MINIMUM_TOOLS)
        if agent.node_type != NodeType.ASSISTANT:
            allowed -= ASSISTANT_ONLY_TOOLS
        visible_tools = [
            t for t in self._tools.values() if t.name in allowed and t.llm_visible
        ]
        role = find_role(get_settings(), agent.config.role_name or "")
        excluded = set(role.excluded_tools) if role is not None else set()
        return [tool for tool in visible_tools if tool.name not in excluded]

    def get_tools_schema(self, agent: Agent) -> list[dict[str, Any]]:
        return [t.to_schema() for t in self.get_tools_for_agent(agent)]


def build_tool_registry() -> ToolRegistry:
    from flowent.tools.connect import ConnectTool
    from flowent.tools.contacts import ContactsTool
    from flowent.tools.create_agent import CreateAgentTool
    from flowent.tools.create_tab import CreateTabTool
    from flowent.tools.delete_tab import DeleteTabTool
    from flowent.tools.edit import EditTool
    from flowent.tools.exec import ExecTool
    from flowent.tools.fetch import FetchTool
    from flowent.tools.idle import IdleTool
    from flowent.tools.list_roles import ListRolesTool
    from flowent.tools.list_tabs import ListTabsTool
    from flowent.tools.list_tools import ListToolsTool
    from flowent.tools.manage_prompts import ManagePromptsTool
    from flowent.tools.manage_providers import ManageProvidersTool
    from flowent.tools.manage_roles import ManageRolesTool
    from flowent.tools.manage_settings import ManageSettingsTool
    from flowent.tools.read import ReadTool
    from flowent.tools.send import SendTool
    from flowent.tools.set_permissions import SetPermissionsTool
    from flowent.tools.sleep import SleepTool
    from flowent.tools.todo import TodoTool

    reg = ToolRegistry()
    for tool_cls in [
        IdleTool,
        SleepTool,
        TodoTool,
        ContactsTool,
        SendTool,
        CreateTabTool,
        DeleteTabTool,
        SetPermissionsTool,
        CreateAgentTool,
        ConnectTool,
        ManageProvidersTool,
        ManageRolesTool,
        ManageSettingsTool,
        ManagePromptsTool,
        ReadTool,
        EditTool,
        ExecTool,
        FetchTool,
        ListRolesTool,
        ListTabsTool,
        ListToolsTool,
    ]:
        reg.register(tool_cls())  # type: ignore[abstract]
    return reg


def list_agent_visible_tool_descriptors(
    *,
    include_assistant_only: bool = True,
) -> list[dict[str, Any]]:
    registry = build_tool_registry()

    descriptors: list[dict[str, Any]] = []
    for tool in registry.list_tools(agent_visible_only=True):
        if not include_assistant_only and is_assistant_only_tool_name(tool.name):
            continue
        schema = tool.to_schema()
        function = schema.get("function")
        parameters = (
            function.get("parameters")
            if isinstance(function, dict)
            else {"type": "object", "properties": {}, "required": []}
        )
        descriptors.append(
            {
                "name": tool.name,
                "description": tool.description,
                "parameters": parameters,
                "source": "builtin",
            }
        )
    return descriptors
