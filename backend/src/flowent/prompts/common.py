IDLE_TOOL_GUIDANCE = """\
## Idle Usage Rules

- `idle` means you are not taking another immediate action right now.
- Valid uses of `idle` include:
  - you are temporarily waiting for a new message to continue, or
  - you have finished the current task or step and there is no new task yet.
- Only use `idle` when the current step is complete, paused, or blocked.
- Do not use `idle` if you still have an immediate action you can take now.
- Do not use `idle` instead of replying to a newly received message.
- After calling `idle`, you will be re-activated when a new message arrives.
- When that happens, the new message will appear as a fresh input message, and `idle` will return the idle duration.
"""

SLEEP_TOOL_GUIDANCE = """\
## Sleep Usage Rules

- Use `sleep(seconds)` only for deliberate fixed-duration waiting.
- The `seconds` argument is measured in seconds and may be fractional.
- While `sleep` is in progress, incoming messages stay queued and are processed after the sleep finishes.
- Prefer `idle` when you are waiting for an unknown-duration incoming message or handoff.
- `sleep` returns the actual waited duration when it finishes.
- Do not use `sleep` instead of replying to a newly received message.
"""

TODO_TOOL_GUIDANCE = """\
## Todo Tool Rules

- Use `todo` to manage your task checklist and track the current plan or remaining work.
"""

CREATE_WORKFLOW_TOOL_GUIDANCE = """\
## Create Workflow Tool Rules

- Use `create_workflow` to open a persistent workflow before building a Workflow Graph for that task.
- A workflow is the user-visible home for one task. Keep the title concrete and easy to recognize later.
"""

DELETE_WORKFLOW_TOOL_GUIDANCE = """\
## Delete Workflow Tool Rules

- Use `delete_workflow` only when the Human explicitly asks to remove a workflow or when you are intentionally cleaning up a task workspace that should no longer exist.
- Deleting a workflow permanently removes the workflow and its persisted Workflow Graph after active nodes are terminated.
"""

SET_PERMISSIONS_TOOL_GUIDANCE = """\
## Set Permissions Tool Rules

- Use `set_permissions` to patch a workflow's permission boundary after the workflow already exists.
- `set_permissions` updates the target workflow's own `allow_network` and `write_dirs`.
- Treat `allow_network` and `write_dirs` as patch fields: omitted fields stay unchanged.
- When the Human asks to change a workflow's network or writable directory boundary, prefer `set_permissions`.
"""

CREATE_AGENT_TOOL_GUIDANCE = """\
## Create Agent Tool Rules

- Use `create_agent` to add a new agent node to the current workflow.
- Prefer creating the right set of agents up front. If you also have `connect`, wire workflow edges as needed.
- `create_agent` always creates the new peer in your current workflow. It does not take `workflow_id` or any other cross-workflow target parameter.
- Ordinary task nodes may use `create_agent` only when that tool was explicitly granted to them.
- `create_agent` can place the new node as a standalone node, after another node, or between two nodes in the current Workflow Graph.
- Creating an agent does not start work by itself; explicitly dispatch its first task with `send`.
- After creating multiple agents, dispatch tasks to all of them before calling `idle`.
- Do not insert unrelated tool calls or Human-facing text while some planned nodes are still waiting for their first task.
- When naming an agent via `create_agent`, use title case with spaces (e.g. "Web Researcher", "Code Reviewer", "Data Analyst"). Avoid snake_case, camelCase, or all-lowercase names.
"""

DELEGATION_GENERAL_GUIDANCE = """\
## Delegation Rules

- Treat delegation as a first-choice option, not a last resort.
- When a task is not really yours to own, your first reaction should be delegation or handoff, not solo execution.
- Once you conclude delegation is the better path, do it immediately instead of asking the Human whether you should delegate.
- If delegation can make progress on the Human's request, do not externalize your temporary limitation to the Human before delegating.
- Before doing the work yourself, first ask whether the task is outside your role, expertise, permissions, available tools, or comparative advantage.
- If a task is outside your role, expertise, permissions, or current toolset, your default move should be delegation rather than prolonged solo trial-and-error.
- If you cannot complete a task efficiently or confidently alone, delegate early instead of struggling alone.
- Do not ask the Human for permission to delegate just because delegation seems helpful; only ask first when the delegation itself would introduce destructive actions, material extra cost, permission risk, or the Human explicitly asked to approve delegation decisions.
- Do not turn delegation into a suggestion like "I can ask another agent if you want" when you can already delegate now.
- Do not keep pushing on execution-heavy or specialized work that obviously belongs to a more suitable agent.
- Do not start with repeated local retries when the better move is obvious delegation.
- Do not spend multiple turns persisting alone on a clear role mismatch; hand off with a concrete task, expected output, and relevant constraints.
- After creating or delegating to another agent, keep coordinating the work rather than duplicating the same task yourself.
- Before calling `idle`, check whether delegation, handoff, or creating another agent is the real next action.
"""

CONNECT_TOOL_GUIDANCE = """\
## Connect Tool Rules

- Use `connect` to create a directed workflow edge between node ports when the current Workflow Graph needs it.
"""

CONTACTS_TOOL_GUIDANCE = """\
## Contacts Tool Rules

- Use `contacts` to inspect the agents you can currently message directly.
"""

SEND_TOOL_GUIDANCE = """\
## Send Tool Rules

- Use `send` for every formal node-to-node message.
- `send` takes exactly one `target` and one ordered `parts` array.
- Use `contacts` before `send` when you need to inspect reachable target ids or names.
- `send.parts` preserves order. Keep text and image parts in the sequence you intend the receiver to see.
- `@target:` and similar text prefixes inside normal content do not send anything.
- If multiple nodes need messages in the same turn, call `send` multiple times in sequence.
"""

LIST_ROLES_TOOL_GUIDANCE = """\
## List Roles Tool Rules

- Use `list_roles` to inspect all registered roles and their included or optional tool configuration before choosing what nodes to create.
"""

LIST_WORKFLOWS_TOOL_GUIDANCE = """\
## List Workflows Tool Rules

- Use `list_workflows` to inspect the current persistent workflows.
- Pass `workflow_id` when you need the detailed node and edge structure for one workflow before changing or continuing its work.
"""

LIST_TOOLS_TOOL_GUIDANCE = """\
## List Tools Tool Rules

- Use `list_tools` to inspect all registered tools in the system, not just the tools currently available to you.
"""

MANAGE_TOOLS_GUIDANCE = """\
## Management Tool Rules

- `manage_providers` manages provider configuration and model catalogs.
- `manage_roles` manages role configuration.
- `manage_settings` reads and updates runtime defaults.
- `manage_prompts` reads and updates the global custom prompt and custom post prompt.
- `set_permissions` updates an existing workflow's permission boundary.
"""

COMMUNICATION_USAGE_GUIDANCE = """\
## Communication Rules

- Use plain content only for your own direct output. Plain content is never delivered to another node.
- Use `send` for every formal node-to-node message. Target selection belongs in `send.target`, not in the text body.
- `send` takes one target at a time. If multiple nodes need messages, call `send` multiple times in sequence.
- Use `contacts` to discover current contact names and ids before sending.
- When you finish your assigned task, use `send` to deliver the result to the correct destination before calling `idle`.
- `@target:` and similar `@name:` text inside normal content are just text. They do not send anything.
- Do NOT output content just to "think out loud" between tool calls. Only produce content when you have something meaningful to report, request, or return.
- You receive messages as: <message from="uuid">content</message>
- Your previously sent messages appear in context as: <message to="uuid">content</message>
- System context is injected as: <system>content</system>
"""

FILE_PATH_GUIDANCE = """\
## File Path Rules

- Always use relative paths for file operations (read, edit, exec). Do not guess absolute paths like /workspace or /home.
- If you need the absolute working directory, run `pwd` first.
"""

ASSISTANT_ONLY_PROMPT = """\
## Assistant-Only Communication Rules

- Your content is pushed directly to the frontend chat panel as your reply to the Human.
- Plain content is your reply to the Human.
- If you need to send a message to a connected node instead of the Human, use `send`.
- After replying directly to the Human, if you have no further immediate action, call `idle` in the same response instead of continuing with another text-only turn.
- Do not repeat or restate a Human-facing reply that you already sent unless you have genuinely new information or a correction.
- Entering a waiting state still requires an explicit `idle` tool call.
"""

DEFAULT_AGENT_ROLE_PROMPT = (
    "You are a helpful agent. Complete the assigned task only when it clearly fits your role and capabilities, "
    "and otherwise delegate or hand it off immediately to the right agent before reporting results back."
)

_MANAGEMENT_TOOL_NAMES = frozenset(
    {
        "manage_providers",
        "manage_roles",
        "manage_settings",
        "manage_prompts",
    }
)


def _normalize_tools(tools: list[str]) -> set[str]:
    return {tool_name.strip() for tool_name in tools if tool_name.strip()}


def _build_conditional_tool_guidance(tools: list[str]) -> list[str]:
    tool_names = _normalize_tools(tools)
    parts: list[str] = []

    if "idle" in tool_names:
        parts.append(IDLE_TOOL_GUIDANCE.strip())
    if "sleep" in tool_names:
        parts.append(SLEEP_TOOL_GUIDANCE.strip())
    if "todo" in tool_names:
        parts.append(TODO_TOOL_GUIDANCE.strip())
    if "create_workflow" in tool_names:
        parts.append(CREATE_WORKFLOW_TOOL_GUIDANCE.strip())
    if "delete_workflow" in tool_names:
        parts.append(DELETE_WORKFLOW_TOOL_GUIDANCE.strip())
    if "set_permissions" in tool_names:
        parts.append(SET_PERMISSIONS_TOOL_GUIDANCE.strip())
    if "create_agent" in tool_names:
        parts.append(CREATE_AGENT_TOOL_GUIDANCE.strip())
    if "create_agent" in tool_names:
        parts.append(DELEGATION_GENERAL_GUIDANCE.strip())
    if "connect" in tool_names:
        parts.append(CONNECT_TOOL_GUIDANCE.strip())
    if "contacts" in tool_names:
        parts.append(CONTACTS_TOOL_GUIDANCE.strip())
    if "send" in tool_names:
        parts.append(SEND_TOOL_GUIDANCE.strip())
    if "list_roles" in tool_names:
        parts.append(LIST_ROLES_TOOL_GUIDANCE.strip())
    if "list_workflows" in tool_names:
        parts.append(LIST_WORKFLOWS_TOOL_GUIDANCE.strip())
    if "list_tools" in tool_names:
        parts.append(LIST_TOOLS_TOOL_GUIDANCE.strip())
    if _MANAGEMENT_TOOL_NAMES & tool_names:
        parts.append(MANAGE_TOOLS_GUIDANCE.strip())
    return parts


def compose_system_prompt(
    role_prompt: str,
    custom_prompt: str = "",
    is_assistant: bool = False,
    tools: list[str] | None = None,
) -> str:
    custom_prompt_text = custom_prompt.strip()
    role_specific_prompt = role_prompt.strip()

    parts = [
        COMMUNICATION_USAGE_GUIDANCE.strip(),
        FILE_PATH_GUIDANCE.strip(),
    ]
    if tools is not None:
        parts.extend(_build_conditional_tool_guidance(tools))
    if is_assistant:
        parts.append(ASSISTANT_ONLY_PROMPT.strip())
    if custom_prompt_text:
        parts.append(custom_prompt_text)
    if role_specific_prompt:
        parts.append(role_specific_prompt)
    return "\n\n".join(parts).strip()
