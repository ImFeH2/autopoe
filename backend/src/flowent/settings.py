from __future__ import annotations

import json
import os
import tempfile
import threading
from dataclasses import asdict, dataclass, field
from math import isfinite
from pathlib import Path

from loguru import logger

from flowent.prompts.steward import STEWARD_ROLE_SYSTEM_PROMPT

APP_DATA_DIR_ENV_VAR = "FLOWENT_APP_DATA_DIR"
WORKING_DIR = Path(os.getcwd()).resolve()


def _resolve_path_from_base(
    raw_path: str | Path,
    *,
    base_dir: str | Path | None = None,
    strict: bool = False,
) -> Path:
    path = Path(raw_path).expanduser()
    if not path.is_absolute():
        anchor = Path(base_dir).expanduser() if base_dir is not None else WORKING_DIR
        path = anchor / path
    return path.resolve(strict=strict)


def _resolve_startup_app_data_dir() -> Path:
    raw_app_data_dir = os.environ.get(APP_DATA_DIR_ENV_VAR)
    if isinstance(raw_app_data_dir, str) and raw_app_data_dir.strip():
        return _resolve_path_from_base(raw_app_data_dir.strip(), strict=False)
    return Path("~/.flowent").expanduser().resolve(strict=False)


APP_DATA_DIR = _resolve_startup_app_data_dir()
_SETTINGS_FILE = APP_DATA_DIR / "settings.json"
STEWARD_ROLE_NAME = "Steward"
WORKER_ROLE_NAME = "Worker"
CONDUCTOR_ROLE_NAME = "Conductor"
DESIGNER_ROLE_NAME = "Designer"
STEWARD_ROLE_DESCRIPTION = "Human-facing system entry role for task intake and workspace-level boundary management."
WORKER_ROLE_DESCRIPTION = "General execution role for narrow implementation, research, and file-oriented task work inside a workflow."
CONDUCTOR_ROLE_DESCRIPTION = "Default Leader role for workflow-level planning, Workflow Graph orchestration, and result synthesis."
DESIGNER_ROLE_DESCRIPTION = "Frontend implementation and visual design role for UI, layout, styling, and interaction refinement tasks."
STEWARD_ROLE_INCLUDED_TOOLS = [
    "create_workflow",
    "delete_workflow",
    "set_permissions",
    "list_workflows",
    "list_roles",
    "list_tools",
    "manage_providers",
    "manage_roles",
    "manage_settings",
    "manage_prompts",
]
WORKER_ROLE_SYSTEM_PROMPT = (
    "You are the Worker role - a narrow execution node inside a workflow. "
    "Follow the assigned subtask, use the tools you were given to complete it, "
    "and report back clearly. You are not the Human-facing system entrypoint "
    "and you are not the workflow-level orchestrator."
)
CONDUCTOR_ROLE_SYSTEM_PROMPT = """\
You are the Conductor role currently used by a workflow's Leader.

Your responsibilities:
- Receive execution briefs from the Assistant for this workflow through the workflow's Leader identity
- Decide how the task should be decomposed inside the current workflow
- Design, expand, adjust, and simplify this workflow's Workflow Graph as the work evolves
- Coordinate agents, aggregate their results, and return a coherent result upstream to the Assistant

## Ownership

- This role is the default behavior template for a workflow's Leader, not a separate product identity outside the Leader
- The workflow's Leader is the only owner-level entrypoint for this workflow
- You are not a global orchestrator shared across workflows
- The Assistant owns Human-facing intake and task-boundary management; the Leader owns this workflow's internal execution structure
- Regular task-node results should usually come back to you first, then you summarize and escalate upstream when appropriate

## Decision Framework

- Start from the Assistant's brief, not from the Human directly.
- Analyze the task first, then choose the structure that best fits it: one Worker, fan-out, pipeline, fan-out-fan-in, reviewer loop, or another topology that matches the work.
- Do not default to creating a single Worker and handing it the entire task. Only choose that structure when the task is truly atomic and there is no clear orchestration, review, parallelism, or synthesis value.
- Prefer multi-agent parallelism over serial single-agent execution. If subtasks are independent, create separate nodes for them rather than assigning everything to one Worker.
- Prefer adding peer nodes to the current workflow with `create_agent`, then wire them with `connect` to match the topology you want.
- Treat this workflow as the execution boundary. Do not push internal Workflow Graph design back to the Assistant.
- Do not treat any single topology as the default. Match the network design to the task's decomposition, dependencies, and coordination needs.

## Workflow

1. **Receive** the brief from the Assistant as the current workflow's Leader
2. **Plan** using `todo` - break into subtasks, decide what to delegate, and design the network structure that best fits the work
3. **Inspect roles** with `list_roles`; use `list_tools` for a full tool inventory
4. **Create the network structure** with `create_agent` and `connect`
5. **Dispatch immediately** after creation: use `send` to give each node that should begin working its first concrete task, including where its result should go; creating nodes does not begin execution by itself
6. **Adjust topology dynamically** with `create_agent` and `connect` when the structure needs to change during execution
7. **Coordinate** as results arrive; update your plan when needed
8. **Aggregate** and return the final result or escalation upstream to the Assistant

## Guidelines

- Prefer `create_agent` and `connect` as the primary control plane for the current workflow
- Do not create a node and then `idle` without dispatching work unless you intentionally want the new node to stay idle
- Your default posture is orchestration, not being the long-running executor for specialized work
- When a task is primarily frontend implementation, UI design, visual design, page redesign, or interaction refinement, prefer creating a Designer node for that work
- When a task needs execution-heavy tools such as `read`, `exec`, `edit`, or `fetch` outside that frontend or UI design scope, create a Worker node to do that work
- Create agents with only the tools they need
- Use `write_dirs` for file write access
- When dispatching tasks to nodes, specify where each node should send its result and use `send` for that handoff. Use `connect` to wire direct communication paths between nodes, so results flow directly to the right destination without relaying through you.
- Prefer explicit network topology over ad-hoc relaying: wire synthesizers, reviewers, and feedback loops with `connect` rather than manually relaying every message yourself
- Once delegation is clearly the right move, execute it directly without asking the Assistant or Human
- Keep the overall workflow graph understandable; add complexity only when it materially improves throughput, quality, or resilience
"""
DESIGNER_ROLE_SYSTEM_PROMPT = """\
You are the Designer role - a frontend implementation and visual design node inside a workflow.

Your responsibilities:
- Implement and refine frontend surfaces such as pages, components, layouts, and interaction details
- Make concrete design decisions about typography, spacing, color, motion, and overall visual direction when the task calls for them
- Produce polished UI changes directly with the tools you were given
- Report back clearly on what changed, what remains open, and any design tradeoffs that matter

## Boundaries

- You are not the Human-facing system entrypoint
- You are not the workflow-level orchestrator
- You are not the default executor for unrelated backend or general-purpose coding work
- If the task is not actually about frontend implementation, UI design, or visual styling, hand it back or ask for a more suitable node
"""
BUILTIN_ROLE_NAMES = frozenset(
    {STEWARD_ROLE_NAME, WORKER_ROLE_NAME, CONDUCTOR_ROLE_NAME, DESIGNER_ROLE_NAME}
)
WORKER_ROLE_INCLUDED_TOOLS = ["read", "exec"]
CONDUCTOR_ROLE_INCLUDED_TOOLS = [
    "create_agent",
    "connect",
    "list_workflows",
    "list_roles",
    "list_tools",
]
DESIGNER_ROLE_INCLUDED_TOOLS = ["read", "edit", "exec"]
MODEL_REASONING_EFFORT_OPTIONS = frozenset({"none", "low", "medium", "high", "xhigh"})
MODEL_VERBOSITY_OPTIONS = frozenset({"low", "medium", "high"})
MODEL_RETRY_POLICY_OPTIONS = frozenset({"no_retry", "limited", "unlimited"})
PROVIDER_MODEL_SOURCE_OPTIONS = frozenset({"discovered", "manual"})
MCP_TRANSPORT_OPTIONS = frozenset({"stdio", "streamable_http"})
REMOVED_TOOL_NAMES = frozenset({"exit", "list_connections"})
RENAMED_TOOL_NAMES = {
    "create_tab": "create_workflow",
    "delete_tab": "delete_workflow",
    "list_tabs": "list_workflows",
}
DEFAULT_LLM_TIMEOUT_MS = 10000
DEFAULT_LLM_MAX_RETRIES = 5
DEFAULT_LLM_RETRY_POLICY = "limited"
DEFAULT_LLM_RETRY_INITIAL_DELAY_SECONDS = 0.5
DEFAULT_LLM_RETRY_MAX_DELAY_SECONDS = 8.0
DEFAULT_LLM_RETRY_BACKOFF_CAP_RETRIES = 5
DEFAULT_LLM_AUTO_COMPACT_TOKEN_LIMIT: int | None = None
DEFAULT_ASSISTANT_ALLOW_NETWORK = True
DEFAULT_MCP_SERVER_STARTUP_TIMEOUT_SEC = 10
DEFAULT_MCP_SERVER_TOOL_TIMEOUT_SEC = 30


def build_default_app_data_dir() -> str:
    return str(Path(_SETTINGS_FILE).parent.resolve(strict=False))


def build_default_working_dir() -> str:
    return str(WORKING_DIR)


def get_app_data_dir_path() -> Path:
    return Path(_SETTINGS_FILE).parent.resolve(strict=False)


def get_runtime_working_dir_path() -> Path:
    return Path(get_settings().working_dir).resolve(strict=False)


def resolve_path(
    raw_path: str | Path,
    *,
    base_dir: str | Path | None = None,
    strict: bool = False,
) -> Path:
    base_path = base_dir if base_dir is not None else get_runtime_working_dir_path()
    return _resolve_path_from_base(raw_path, base_dir=base_path, strict=strict)


def build_default_assistant_write_dirs(
    working_dir: str | Path | None = None,
) -> list[str]:
    target_working_dir = working_dir if working_dir is not None else WORKING_DIR
    return [str(resolve_path(target_working_dir, base_dir=WORKING_DIR, strict=False))]


@dataclass
class EventLogSettings:
    timestamp_format: str = "absolute"


@dataclass
class AccessSettings:
    code: str = ""
    code_hash: str = ""
    code_salt: str = ""
    session_generation: int = 0
    session_signing_secret: str = ""


@dataclass
class ProviderModelCatalogEntry:
    model: str
    source: str = "manual"
    context_window_tokens: int | None = None
    input_image: bool | None = None
    output_image: bool | None = None
    structured_output: bool | None = None


@dataclass
class ProviderConfig:
    id: str
    name: str
    type: str
    base_url: str
    api_key: str
    headers: dict[str, str] = field(default_factory=dict)
    retry_429_delay_seconds: int = 0
    models: list[ProviderModelCatalogEntry] = field(default_factory=list)


@dataclass
class RoleModelConfig:
    provider_id: str
    model: str


@dataclass
class ModelParams:
    reasoning_effort: str | None = None
    verbosity: str | None = None
    max_output_tokens: int | None = None
    temperature: float | None = None
    top_p: float | None = None


def build_default_model_params() -> ModelParams:
    return ModelParams()


def _normalize_assistant_write_dir(
    raw_write_dir: str,
    *,
    base_dir: str | Path | None = None,
) -> str:
    return str(resolve_path(raw_write_dir, base_dir=base_dir, strict=False))


def _normalize_mcp_server_cwd(
    raw_cwd: str,
    *,
    base_dir: str | Path | None = None,
) -> str:
    return str(resolve_path(raw_cwd, base_dir=base_dir, strict=False))


def build_working_dir(
    raw_working_dir: object,
    *,
    field_name: str = "working_dir",
) -> str:
    if not isinstance(raw_working_dir, str):
        raise ValueError(f"{field_name} must be a string")
    stripped = raw_working_dir.strip()
    if not stripped:
        raise ValueError(f"{field_name} must not be empty")
    try:
        normalized = str(_resolve_path_from_base(stripped, strict=True))
    except FileNotFoundError as exc:
        raise ValueError(f"{field_name} must be an existing directory") from exc
    except OSError as exc:
        raise ValueError(f"{field_name} must be an accessible directory") from exc
    path = Path(normalized)
    if not path.is_dir():
        raise ValueError(f"{field_name} must be an existing directory")
    if not os.access(path, os.R_OK | os.X_OK):
        raise ValueError(f"{field_name} must be an accessible directory")
    return normalized


@dataclass
class RoleConfig:
    name: str
    system_prompt: str
    description: str = ""
    model: RoleModelConfig | None = None
    model_params: ModelParams | None = None
    included_tools: list[str] = field(default_factory=list)
    excluded_tools: list[str] = field(default_factory=list)


@dataclass
class MCPServerConfig:
    name: str
    transport: str
    enabled: bool = True
    required: bool = False
    startup_timeout_sec: int = DEFAULT_MCP_SERVER_STARTUP_TIMEOUT_SEC
    tool_timeout_sec: int = DEFAULT_MCP_SERVER_TOOL_TIMEOUT_SEC
    enabled_tools: list[str] = field(default_factory=list)
    disabled_tools: list[str] = field(default_factory=list)
    scopes: list[str] = field(default_factory=list)
    oauth_resource: str = ""
    launcher: str = ""
    command: str = ""
    args: list[str] = field(default_factory=list)
    env: dict[str, str] = field(default_factory=dict)
    env_vars: list[str] = field(default_factory=list)
    cwd: str = ""
    url: str = ""
    bearer_token_env_var: str = ""
    http_headers: dict[str, str] = field(default_factory=dict)
    env_http_headers: list[str] = field(default_factory=list)


@dataclass
class ModelSettings:
    active_provider_id: str = ""
    active_model: str = ""
    input_image: bool | None = None
    output_image: bool | None = None
    structured_output: bool | None = None
    context_window_tokens: int | None = None
    params: ModelParams = field(default_factory=build_default_model_params)
    timeout_ms: int = DEFAULT_LLM_TIMEOUT_MS
    retry_policy: str = DEFAULT_LLM_RETRY_POLICY
    max_retries: int = DEFAULT_LLM_MAX_RETRIES
    retry_initial_delay_seconds: float = DEFAULT_LLM_RETRY_INITIAL_DELAY_SECONDS
    retry_max_delay_seconds: float = DEFAULT_LLM_RETRY_MAX_DELAY_SECONDS
    retry_backoff_cap_retries: int = DEFAULT_LLM_RETRY_BACKOFF_CAP_RETRIES
    auto_compact_token_limit: int | None = DEFAULT_LLM_AUTO_COMPACT_TOKEN_LIMIT


@dataclass
class AssistantSettings:
    role_name: str = STEWARD_ROLE_NAME
    allow_network: bool = DEFAULT_ASSISTANT_ALLOW_NETWORK
    write_dirs: list[str] = field(default_factory=build_default_assistant_write_dirs)


@dataclass
class LeaderSettings:
    role_name: str = CONDUCTOR_ROLE_NAME


@dataclass
class TelegramPendingChat:
    chat_id: int
    username: str | None = None
    display_name: str = ""
    first_seen_at: float = 0.0
    last_seen_at: float = 0.0


@dataclass
class TelegramApprovedChat:
    chat_id: int
    username: str | None = None
    display_name: str = ""
    approved_at: float = 0.0


@dataclass
class TelegramSettings:
    bot_token: str = ""
    pending_chats: list[TelegramPendingChat] = field(default_factory=list)
    approved_chats: list[TelegramApprovedChat] = field(default_factory=list)


@dataclass
class Settings:
    app_data_dir: str = field(default_factory=build_default_app_data_dir)
    working_dir: str = field(default_factory=build_default_working_dir)
    event_log: EventLogSettings = field(default_factory=EventLogSettings)
    access: AccessSettings = field(default_factory=AccessSettings)
    assistant: AssistantSettings = field(default_factory=AssistantSettings)
    leader: LeaderSettings = field(default_factory=LeaderSettings)
    telegram: TelegramSettings = field(default_factory=TelegramSettings)
    model: ModelSettings = field(default_factory=ModelSettings)
    custom_prompt: str = ""
    custom_post_prompt: str = ""
    providers: list[ProviderConfig] = field(default_factory=list)
    roles: list[RoleConfig] = field(default_factory=list)
    mcp_servers: list[MCPServerConfig] = field(default_factory=list)


_cached_settings: Settings | None = None
_cached_settings_file_signature: tuple[int, int] | None = None
_settings_lock = threading.Lock()


def normalize_tool_names(tool_names: list[str]) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for tool_name in tool_names:
        stripped = tool_name.strip()
        name = RENAMED_TOOL_NAMES.get(stripped, stripped)
        if not name or name in seen or name in REMOVED_TOOL_NAMES:
            continue
        normalized.append(name)
        seen.add(name)
    return normalized


def validate_role_tool_config(
    included_tools: list[str],
    excluded_tools: list[str],
) -> None:
    overlap = sorted(set(included_tools) & set(excluded_tools))
    if overlap:
        raise ValueError(
            "included_tools and excluded_tools cannot overlap: " + ", ".join(overlap)
        )


def serialize_role_model(
    role_model: RoleModelConfig | None,
) -> dict[str, str] | None:
    if role_model is None:
        return None
    return {
        "provider_id": role_model.provider_id,
        "model": role_model.model,
    }


def serialize_model_params(
    model_params: ModelParams | None,
) -> dict[str, object] | None:
    if model_params is None:
        return None
    return {
        "reasoning_effort": model_params.reasoning_effort,
        "verbosity": model_params.verbosity,
        "max_output_tokens": model_params.max_output_tokens,
        "temperature": model_params.temperature,
        "top_p": model_params.top_p,
    }


def is_empty_model_params(model_params: ModelParams | None) -> bool:
    return model_params is None or all(
        value is None for value in asdict(model_params).values()
    )


def merge_model_params(
    defaults: ModelParams | None,
    override: ModelParams | None,
) -> ModelParams | None:
    merged = asdict(defaults) if defaults is not None else asdict(ModelParams())
    if override is not None:
        for key, value in asdict(override).items():
            if value is not None:
                merged[key] = value
    params = ModelParams(**merged)
    return None if is_empty_model_params(params) else params


def build_model_params_from_mapping(raw_model_params: object) -> ModelParams | None:
    if raw_model_params is None:
        return None
    if not isinstance(raw_model_params, dict):
        raise ValueError("model_params must be an object or null")

    raw_reasoning_effort = raw_model_params.get("reasoning_effort")
    raw_verbosity = raw_model_params.get("verbosity")
    raw_max_output_tokens = raw_model_params.get("max_output_tokens")
    raw_temperature = raw_model_params.get("temperature")
    raw_top_p = raw_model_params.get("top_p")

    if raw_reasoning_effort is not None:
        if not isinstance(raw_reasoning_effort, str):
            raise ValueError("model_params.reasoning_effort must be a string")
        reasoning_effort = raw_reasoning_effort.strip().lower()
        if reasoning_effort and reasoning_effort not in MODEL_REASONING_EFFORT_OPTIONS:
            raise ValueError(
                "model_params.reasoning_effort must be one of: "
                + ", ".join(sorted(MODEL_REASONING_EFFORT_OPTIONS))
            )
    else:
        reasoning_effort = None

    if raw_verbosity is not None:
        if not isinstance(raw_verbosity, str):
            raise ValueError("model_params.verbosity must be a string")
        verbosity = raw_verbosity.strip().lower()
        if verbosity and verbosity not in MODEL_VERBOSITY_OPTIONS:
            raise ValueError(
                "model_params.verbosity must be one of: "
                + ", ".join(sorted(MODEL_VERBOSITY_OPTIONS))
            )
    else:
        verbosity = None

    if raw_max_output_tokens is not None:
        if isinstance(raw_max_output_tokens, bool) or not isinstance(
            raw_max_output_tokens, int
        ):
            raise ValueError("model_params.max_output_tokens must be an integer")
        if raw_max_output_tokens <= 0:
            raise ValueError("model_params.max_output_tokens must be greater than 0")
        max_output_tokens = raw_max_output_tokens
    else:
        max_output_tokens = None

    if raw_temperature is not None:
        if isinstance(raw_temperature, bool) or not isinstance(
            raw_temperature, (int, float)
        ):
            raise ValueError("model_params.temperature must be a number")
        temperature = float(raw_temperature)
        if not isfinite(temperature) or temperature < 0 or temperature > 2:
            raise ValueError("model_params.temperature must be between 0 and 2")
    else:
        temperature = None

    if raw_top_p is not None:
        if isinstance(raw_top_p, bool) or not isinstance(raw_top_p, (int, float)):
            raise ValueError("model_params.top_p must be a number")
        top_p = float(raw_top_p)
        if not isfinite(top_p) or top_p <= 0 or top_p > 1:
            raise ValueError("model_params.top_p must be greater than 0 and at most 1")
    else:
        top_p = None

    params = ModelParams(
        reasoning_effort=reasoning_effort or None,
        verbosity=verbosity or None,
        max_output_tokens=max_output_tokens,
        temperature=temperature,
        top_p=top_p,
    )
    return None if is_empty_model_params(params) else params


def build_model_max_retries(
    raw_max_retries: object,
    *,
    field_name: str = "model.max_retries",
) -> int:
    if isinstance(raw_max_retries, bool) or not isinstance(raw_max_retries, int):
        raise ValueError(f"{field_name} must be an integer")
    if raw_max_retries <= 0:
        raise ValueError(f"{field_name} must be greater than 0")
    return raw_max_retries


def build_model_input_image(
    raw_input_image: object,
    *,
    field_name: str = "model.input_image",
) -> bool | None:
    if raw_input_image is None:
        return None
    if not isinstance(raw_input_image, bool):
        raise ValueError(f"{field_name} must be a boolean or null")
    return raw_input_image


def build_model_output_image(
    raw_output_image: object,
    *,
    field_name: str = "model.output_image",
) -> bool | None:
    if raw_output_image is None:
        return None
    if not isinstance(raw_output_image, bool):
        raise ValueError(f"{field_name} must be a boolean or null")
    return raw_output_image


def build_model_structured_output(
    raw_structured_output: object,
    *,
    field_name: str = "model.structured_output",
) -> bool | None:
    if raw_structured_output is None:
        return None
    if not isinstance(raw_structured_output, bool):
        raise ValueError(f"{field_name} must be a boolean or null")
    return raw_structured_output


def build_model_context_window_tokens(
    raw_context_window_tokens: object,
    *,
    field_name: str = "model.context_window_tokens",
) -> int | None:
    if raw_context_window_tokens is None:
        return None
    if isinstance(raw_context_window_tokens, bool) or not isinstance(
        raw_context_window_tokens, int
    ):
        raise ValueError(f"{field_name} must be an integer or null")
    if raw_context_window_tokens <= 0:
        raise ValueError(f"{field_name} must be greater than 0")
    return raw_context_window_tokens


def build_model_auto_compact_token_limit(
    raw_auto_compact_token_limit: object,
    *,
    field_name: str = "model.auto_compact_token_limit",
) -> int | None:
    if raw_auto_compact_token_limit is None:
        return None
    if isinstance(raw_auto_compact_token_limit, bool) or not isinstance(
        raw_auto_compact_token_limit, int
    ):
        raise ValueError(f"{field_name} must be an integer or null")
    if raw_auto_compact_token_limit <= 0:
        raise ValueError(f"{field_name} must be greater than 0")
    return raw_auto_compact_token_limit


def build_assistant_allow_network(
    raw_allow_network: object,
    *,
    field_name: str = "assistant.allow_network",
) -> bool:
    if not isinstance(raw_allow_network, bool):
        raise ValueError(f"{field_name} must be a boolean")
    return raw_allow_network


def build_assistant_write_dirs(
    raw_write_dirs: object,
    *,
    field_name: str = "assistant.write_dirs",
    base_dir: str | Path | None = None,
) -> list[str]:
    if not isinstance(raw_write_dirs, list):
        raise ValueError(f"{field_name} must be an array of strings")

    normalized: list[str] = []
    seen: set[str] = set()
    for raw_item in raw_write_dirs:
        if not isinstance(raw_item, str):
            raise ValueError(f"{field_name} must be an array of strings")
        stripped = raw_item.strip()
        if not stripped:
            continue
        normalized_item = _normalize_assistant_write_dir(
            stripped,
            base_dir=base_dir,
        )
        if normalized_item in seen:
            continue
        seen.add(normalized_item)
        normalized.append(normalized_item)
    return normalized


def build_mcp_server_mounts(
    raw_server_names: object,
    *,
    field_name: str,
) -> list[str]:
    if not isinstance(raw_server_names, list):
        raise ValueError(f"{field_name} must be an array of strings")

    normalized: list[str] = []
    seen: set[str] = set()
    for raw_item in raw_server_names:
        if not isinstance(raw_item, str):
            raise ValueError(f"{field_name} must be an array of strings")
        name = raw_item.strip()
        if not name or name in seen:
            continue
        normalized.append(name)
        seen.add(name)
    return normalized


def build_model_retry_policy(
    raw_retry_policy: object,
    *,
    field_name: str = "model.retry_policy",
) -> str:
    if not isinstance(raw_retry_policy, str):
        raise ValueError(f"{field_name} must be a string")
    retry_policy = raw_retry_policy.strip().lower()
    if retry_policy not in MODEL_RETRY_POLICY_OPTIONS:
        raise ValueError(
            f"{field_name} must be one of: "
            + ", ".join(sorted(MODEL_RETRY_POLICY_OPTIONS))
        )
    return retry_policy


def build_model_retry_initial_delay_seconds(
    raw_delay_seconds: object,
    *,
    field_name: str = "model.retry_initial_delay_seconds",
) -> float:
    if isinstance(raw_delay_seconds, bool) or not isinstance(
        raw_delay_seconds, (int, float)
    ):
        raise ValueError(f"{field_name} must be a number")
    delay_seconds = float(raw_delay_seconds)
    if not isfinite(delay_seconds) or delay_seconds <= 0:
        raise ValueError(f"{field_name} must be greater than 0")
    return delay_seconds


def build_model_retry_max_delay_seconds(
    raw_delay_seconds: object,
    *,
    field_name: str = "model.retry_max_delay_seconds",
) -> float:
    if isinstance(raw_delay_seconds, bool) or not isinstance(
        raw_delay_seconds, (int, float)
    ):
        raise ValueError(f"{field_name} must be a number")
    delay_seconds = float(raw_delay_seconds)
    if not isfinite(delay_seconds) or delay_seconds <= 0:
        raise ValueError(f"{field_name} must be greater than 0")
    return delay_seconds


def build_model_retry_backoff_cap_retries(
    raw_cap_retries: object,
    *,
    field_name: str = "model.retry_backoff_cap_retries",
) -> int:
    if isinstance(raw_cap_retries, bool) or not isinstance(raw_cap_retries, int):
        raise ValueError(f"{field_name} must be an integer")
    if raw_cap_retries <= 0:
        raise ValueError(f"{field_name} must be greater than 0")
    return raw_cap_retries


def validate_model_retry_backoff_settings(
    *,
    retry_initial_delay_seconds: float,
    retry_max_delay_seconds: float,
) -> None:
    if retry_max_delay_seconds < retry_initial_delay_seconds:
        raise ValueError(
            "model.retry_max_delay_seconds must be greater than or equal to "
            "model.retry_initial_delay_seconds"
        )


def build_model_timeout_ms(
    raw_timeout_ms: object,
    *,
    field_name: str = "model.timeout_ms",
) -> int:
    if isinstance(raw_timeout_ms, bool) or not isinstance(raw_timeout_ms, int):
        raise ValueError(f"{field_name} must be an integer")
    if raw_timeout_ms <= 0:
        raise ValueError(f"{field_name} must be greater than 0")
    return raw_timeout_ms


def build_mcp_transport(
    raw_transport: object,
    *,
    field_name: str = "transport",
) -> str:
    if not isinstance(raw_transport, str):
        raise ValueError(f"{field_name} must be a string")
    transport = raw_transport.strip().lower()
    if transport not in MCP_TRANSPORT_OPTIONS:
        raise ValueError(
            f"{field_name} must be one of: " + ", ".join(sorted(MCP_TRANSPORT_OPTIONS))
        )
    return transport


def build_mcp_timeout_seconds(
    raw_timeout_seconds: object,
    *,
    field_name: str,
) -> int:
    if isinstance(raw_timeout_seconds, bool) or not isinstance(
        raw_timeout_seconds, int
    ):
        raise ValueError(f"{field_name} must be an integer")
    if raw_timeout_seconds <= 0:
        raise ValueError(f"{field_name} must be greater than 0")
    return raw_timeout_seconds


def build_mcp_string_list(
    raw_items: object,
    *,
    field_name: str,
) -> list[str]:
    if not isinstance(raw_items, list):
        raise ValueError(f"{field_name} must be an array of strings")
    normalized: list[str] = []
    seen: set[str] = set()
    for raw_item in raw_items:
        if not isinstance(raw_item, str):
            raise ValueError(f"{field_name} must be an array of strings")
        item = raw_item.strip()
        if not item or item in seen:
            continue
        normalized.append(item)
        seen.add(item)
    return normalized


def build_mcp_env_var_names(
    raw_items: object,
    *,
    field_name: str,
) -> list[str]:
    return build_mcp_string_list(raw_items, field_name=field_name)


def build_mcp_cwd(
    raw_cwd: object,
    *,
    field_name: str,
    base_dir: str | Path | None = None,
) -> str:
    if raw_cwd is None:
        return ""
    if not isinstance(raw_cwd, str):
        raise ValueError(f"{field_name} must be a string")
    cwd = raw_cwd.strip()
    if not cwd:
        return ""
    return _normalize_mcp_server_cwd(cwd, base_dir=base_dir)


def build_provider_headers(
    raw_headers: object,
    *,
    field_name: str = "headers",
) -> dict[str, str]:
    if raw_headers is None:
        return {}
    if not isinstance(raw_headers, dict):
        raise ValueError(f"{field_name} must be a JSON object")

    headers: dict[str, str] = {}
    for key, value in raw_headers.items():
        if not isinstance(key, str) or not isinstance(value, str):
            raise ValueError(f"{field_name} must be a JSON object of string values")
        headers[key] = value
    return headers


def build_provider_retry_429_delay_seconds(
    raw_delay_seconds: object,
    *,
    field_name: str = "retry_429_delay_seconds",
) -> int:
    if isinstance(raw_delay_seconds, bool) or not isinstance(raw_delay_seconds, int):
        raise ValueError(f"{field_name} must be an integer")
    if raw_delay_seconds < 0:
        raise ValueError(f"{field_name} must be greater than or equal to 0")
    return raw_delay_seconds


def _normalize_provider_headers(raw_headers: object) -> tuple[dict[str, str], bool]:
    if raw_headers is None:
        return {}, False
    if not isinstance(raw_headers, dict):
        return {}, True

    headers: dict[str, str] = {}
    migrated = False
    for key, value in raw_headers.items():
        if not isinstance(key, str) or not isinstance(value, str):
            migrated = True
            continue
        headers[key] = value
    return headers, migrated


def _normalize_provider_model_source(raw_source: object) -> tuple[str, bool]:
    if raw_source is None:
        return "manual", True
    if not isinstance(raw_source, str):
        return "manual", True
    normalized = raw_source.strip().lower()
    if normalized not in PROVIDER_MODEL_SOURCE_OPTIONS:
        return "manual", True
    return normalized, normalized != raw_source


def _normalize_provider_model_catalog_entries(
    raw_models: object,
) -> tuple[list[ProviderModelCatalogEntry], bool]:
    if raw_models is None:
        return [], False
    if not isinstance(raw_models, list):
        return [], True

    entries_by_model: dict[str, ProviderModelCatalogEntry] = {}
    migrated = False
    for raw_entry in raw_models:
        if not isinstance(raw_entry, dict):
            migrated = True
            continue
        raw_model = raw_entry.get("model")
        if not isinstance(raw_model, str) or not raw_model.strip():
            migrated = True
            continue
        model = raw_model.strip()
        source, source_migrated = _normalize_provider_model_source(
            raw_entry.get("source")
        )
        input_image, input_image_migrated = _normalize_nullable_bool(
            raw_entry.get("input_image")
        )
        output_image, output_image_migrated = _normalize_nullable_bool(
            raw_entry.get("output_image")
        )
        structured_output, structured_output_migrated = _normalize_nullable_bool(
            raw_entry.get("structured_output")
        )
        context_window_tokens, context_window_tokens_migrated = _normalize_positive_int(
            raw_entry.get("context_window_tokens")
        )
        migrated = (
            migrated
            or source_migrated
            or input_image_migrated
            or output_image_migrated
            or structured_output_migrated
            or context_window_tokens_migrated
            or model != raw_model
            or model in entries_by_model
        )
        entries_by_model[model] = ProviderModelCatalogEntry(
            model=model,
            source=source,
            context_window_tokens=context_window_tokens,
            input_image=input_image,
            output_image=output_image,
            structured_output=structured_output,
        )
    return list(entries_by_model.values()), migrated


def _fallback_role_description(role_name: str, system_prompt: str) -> str:
    for line in system_prompt.splitlines():
        stripped = " ".join(line.split())
        if stripped:
            return stripped[:160]
    normalized_role_name = " ".join(role_name.split())
    if normalized_role_name:
        return f"{normalized_role_name} role."
    return "Custom role."


def _normalize_role_description(
    raw_description: object,
    *,
    role_name: str,
    system_prompt: str,
) -> tuple[str, bool]:
    if isinstance(raw_description, str):
        stripped = " ".join(raw_description.split())
        if stripped:
            return stripped, stripped != raw_description
    return _fallback_role_description(role_name, system_prompt), True


def serialize_provider_model_catalog_entry(
    entry: ProviderModelCatalogEntry,
) -> dict[str, object]:
    return {
        "model": entry.model,
        "source": entry.source,
        "context_window_tokens": entry.context_window_tokens,
        "input_image": entry.input_image,
        "output_image": entry.output_image,
        "structured_output": entry.structured_output,
    }


def serialize_provider(provider: ProviderConfig) -> dict[str, object]:
    return {
        "id": provider.id,
        "name": provider.name,
        "type": provider.type,
        "base_url": provider.base_url,
        "api_key": provider.api_key,
        "headers": dict(provider.headers),
        "retry_429_delay_seconds": provider.retry_429_delay_seconds,
        "models": [
            serialize_provider_model_catalog_entry(entry) for entry in provider.models
        ],
    }


def serialize_mcp_server(server: MCPServerConfig) -> dict[str, object]:
    return {
        "name": server.name,
        "transport": server.transport,
        "enabled": server.enabled,
        "required": server.required,
        "startup_timeout_sec": server.startup_timeout_sec,
        "tool_timeout_sec": server.tool_timeout_sec,
        "enabled_tools": list(server.enabled_tools),
        "disabled_tools": list(server.disabled_tools),
        "scopes": list(server.scopes),
        "oauth_resource": server.oauth_resource,
        "launcher": server.launcher,
        "command": server.command,
        "args": list(server.args),
        "env": dict(server.env),
        "env_vars": list(server.env_vars),
        "cwd": server.cwd,
        "url": server.url,
        "bearer_token_env_var": server.bearer_token_env_var,
        "http_headers": dict(server.http_headers),
        "env_http_headers": list(server.env_http_headers),
    }


def serialize_role(role: RoleConfig) -> dict[str, object]:
    return {
        "name": role.name,
        "description": role.description,
        "system_prompt": role.system_prompt,
        "model": serialize_role_model(role.model),
        "model_params": serialize_model_params(role.model_params),
        "included_tools": list(role.included_tools),
        "excluded_tools": list(role.excluded_tools),
        "is_builtin": is_builtin_role_name(role.name),
    }


def mask_secret(secret: str) -> str:
    if not secret:
        return ""
    return f"sk-...{secret[-4:]}"


def serialize_telegram_settings(
    telegram: TelegramSettings,
    *,
    mask_token: bool = True,
) -> dict[str, object]:
    return {
        "bot_token": mask_secret(telegram.bot_token)
        if mask_token
        else telegram.bot_token,
        "pending_chats": [asdict(chat) for chat in telegram.pending_chats],
        "approved_chats": [asdict(chat) for chat in telegram.approved_chats],
    }


def serialize_settings(
    settings: Settings,
    *,
    mask_telegram_token: bool = True,
) -> dict[str, object]:
    data = asdict(settings)
    provider = find_provider(settings, settings.model.active_provider_id)
    if provider is None or not settings.model.active_model.strip():
        model_info = None
    else:
        model_info = resolve_model_info(
            provider=provider,
            model_id=settings.model.active_model,
            input_image=settings.model.input_image,
            output_image=settings.model.output_image,
            structured_output=settings.model.structured_output,
            context_window_tokens=settings.model.context_window_tokens,
        )
    data["model"]["capabilities"] = (
        asdict(model_info.capabilities) if model_info is not None else None
    )
    data["model"]["resolved_context_window_tokens"] = (
        model_info.context_window_tokens if model_info is not None else None
    )
    data["telegram"] = serialize_telegram_settings(
        settings.telegram,
        mask_token=mask_telegram_token,
    )
    data["access"] = {
        "configured": bool(
            settings.access.code.strip()
            and settings.access.code_hash.strip()
            and settings.access.code_salt.strip()
        )
    }
    data["mcp_servers"] = [
        serialize_mcp_server(server) for server in settings.mcp_servers
    ]
    return data


def find_provider_model_catalog_entry(
    provider: ProviderConfig,
    model_id: str,
) -> ProviderModelCatalogEntry | None:
    normalized_model_id = model_id.strip()
    if not normalized_model_id:
        return None
    for entry in provider.models:
        if entry.model.strip() == normalized_model_id:
            return entry
    return None


def resolve_model_info(
    *,
    provider: ProviderConfig,
    model_id: str,
    input_image: bool | None = None,
    output_image: bool | None = None,
    structured_output: bool | None = None,
    context_window_tokens: int | None = None,
):
    from flowent.model_metadata import build_model_info

    catalog_entry = find_provider_model_catalog_entry(provider, model_id)
    return build_model_info(
        provider_type=provider.type,
        model_id=model_id,
        input_image=(
            input_image
            if input_image is not None
            else catalog_entry.input_image
            if catalog_entry is not None
            else None
        ),
        output_image=(
            output_image
            if output_image is not None
            else catalog_entry.output_image
            if catalog_entry is not None
            else None
        ),
        structured_output=(
            structured_output
            if structured_output is not None
            else catalog_entry.structured_output
            if catalog_entry is not None
            else None
        ),
        context_window_tokens=(
            context_window_tokens
            if context_window_tokens is not None
            else catalog_entry.context_window_tokens
            if catalog_entry is not None
            else None
        ),
    )


def _normalize_role_model(
    raw_role_model: object,
    *,
    default_provider_id: str,
) -> tuple[RoleModelConfig | None, bool]:
    if raw_role_model is None:
        return None, False

    if isinstance(raw_role_model, dict):
        provider_id = str(raw_role_model.get("provider_id", "")).strip()
        model = str(raw_role_model.get("model", "")).strip()
        if provider_id and model:
            return RoleModelConfig(provider_id=provider_id, model=model), False
        if model and default_provider_id:
            return (
                RoleModelConfig(provider_id=default_provider_id, model=model),
                True,
            )
        return None, bool(provider_id or model)

    if isinstance(raw_role_model, str):
        model = raw_role_model.strip()
        if model and default_provider_id:
            return (
                RoleModelConfig(provider_id=default_provider_id, model=model),
                True,
            )
        return None, True

    return None, True


def _normalize_model_param_choice(
    raw_value: object,
    *,
    allowed: frozenset[str],
) -> tuple[str | None, bool]:
    if raw_value is None:
        return None, False
    if not isinstance(raw_value, str):
        return None, True

    value = raw_value.strip().lower()
    if not value:
        return None, raw_value != ""
    if value not in allowed:
        return None, True
    return value, value != raw_value


def _normalize_positive_int(raw_value: object) -> tuple[int | None, bool]:
    if raw_value is None:
        return None, False
    if isinstance(raw_value, bool):
        return None, True
    if isinstance(raw_value, int):
        return (raw_value, False) if raw_value > 0 else (None, True)
    if isinstance(raw_value, float) and raw_value.is_integer():
        value = int(raw_value)
        return (value, True) if value > 0 else (None, True)
    return None, True


def _normalize_nullable_bool(raw_value: object) -> tuple[bool | None, bool]:
    if raw_value is None:
        return None, False
    if isinstance(raw_value, bool):
        return raw_value, False
    return None, True


def _normalize_temperature(raw_value: object) -> tuple[float | None, bool]:
    if raw_value is None:
        return None, False
    if isinstance(raw_value, bool):
        return None, True
    if not isinstance(raw_value, (int, float)):
        return None, True

    value = float(raw_value)
    if not isfinite(value) or value < 0 or value > 2:
        return None, True
    return value, False


def _normalize_top_p(raw_value: object) -> tuple[float | None, bool]:
    if raw_value is None:
        return None, False
    if isinstance(raw_value, bool):
        return None, True
    if not isinstance(raw_value, (int, float)):
        return None, True

    value = float(raw_value)
    if not isfinite(value) or value <= 0 or value > 1:
        return None, True
    return value, False


def _normalize_optional_model_params(
    raw_model_params: object,
) -> tuple[ModelParams | None, bool]:
    if raw_model_params is None:
        return None, False
    if not isinstance(raw_model_params, dict):
        return None, True

    reasoning_effort, migrated_reasoning = _normalize_model_param_choice(
        raw_model_params.get("reasoning_effort"),
        allowed=MODEL_REASONING_EFFORT_OPTIONS,
    )
    verbosity, migrated_verbosity = _normalize_model_param_choice(
        raw_model_params.get("verbosity"),
        allowed=MODEL_VERBOSITY_OPTIONS,
    )
    max_output_tokens, migrated_max_output_tokens = _normalize_positive_int(
        raw_model_params.get("max_output_tokens")
    )
    temperature, migrated_temperature = _normalize_temperature(
        raw_model_params.get("temperature")
    )
    top_p, migrated_top_p = _normalize_top_p(raw_model_params.get("top_p"))

    params = ModelParams(
        reasoning_effort=reasoning_effort,
        verbosity=verbosity,
        max_output_tokens=max_output_tokens,
        temperature=temperature,
        top_p=top_p,
    )
    migrated = (
        migrated_reasoning
        or migrated_verbosity
        or migrated_max_output_tokens
        or migrated_temperature
        or migrated_top_p
    )

    if is_empty_model_params(params):
        return None, migrated or bool(raw_model_params)

    return params, migrated


def _normalize_model_params_with_defaults(
    raw_model_params: object,
) -> tuple[ModelParams, bool]:
    params, migrated = _normalize_optional_model_params(raw_model_params)
    if params is not None:
        return params, migrated
    return build_default_model_params(), migrated or raw_model_params is None


def _normalize_int_list(raw_values: object) -> tuple[list[int], bool]:
    if raw_values is None:
        return [], False
    if not isinstance(raw_values, list):
        return [], True

    normalized: list[int] = []
    migrated = False
    for raw_value in raw_values:
        if isinstance(raw_value, bool):
            migrated = True
            continue
        if isinstance(raw_value, int):
            value = raw_value
        elif isinstance(raw_value, float) and raw_value.is_integer():
            value = int(raw_value)
            migrated = True
        elif isinstance(raw_value, str):
            stripped = raw_value.strip()
            if not stripped:
                migrated = True
                continue
            try:
                value = int(stripped)
            except ValueError:
                migrated = True
                continue
            migrated = True
        else:
            migrated = True
            continue

        if value in normalized:
            migrated = True
            continue
        normalized.append(value)

    return normalized, migrated


def _normalize_float(raw_value: object) -> tuple[float, bool]:
    if isinstance(raw_value, bool):
        return 0.0, True
    if isinstance(raw_value, (int, float)):
        value = float(raw_value)
        return value, False
    if isinstance(raw_value, str):
        stripped = raw_value.strip()
        if not stripped:
            return 0.0, True
        try:
            return float(stripped), True
        except ValueError:
            return 0.0, True
    return 0.0, raw_value is not None


def _normalize_optional_string(raw_value: object) -> tuple[str | None, bool]:
    if raw_value is None:
        return None, False
    if not isinstance(raw_value, str):
        return None, True
    stripped = raw_value.strip()
    if not stripped:
        return None, raw_value != ""
    return stripped, stripped != raw_value


def _normalize_required_string(raw_value: object) -> tuple[str, bool]:
    if not isinstance(raw_value, str):
        return "", raw_value is not None
    stripped = raw_value.strip()
    return stripped, stripped != raw_value


def _normalize_mcp_mount_list(raw_values: object) -> tuple[list[str], bool]:
    if raw_values is None:
        return [], False
    if not isinstance(raw_values, list):
        return [], True
    normalized: list[str] = []
    seen: set[str] = set()
    migrated = False
    for raw_value in raw_values:
        if not isinstance(raw_value, str):
            migrated = True
            continue
        value = raw_value.strip()
        if not value:
            migrated = True
            continue
        if value in seen:
            migrated = True
            continue
        if value != raw_value:
            migrated = True
        normalized.append(value)
        seen.add(value)
    return normalized, migrated


def _normalize_mcp_bool(raw_value: object, *, default: bool) -> tuple[bool, bool]:
    if raw_value is None:
        return default, True
    if not isinstance(raw_value, bool):
        return default, True
    return raw_value, False


def _normalize_mcp_timeout(
    raw_value: object,
    *,
    default: int,
) -> tuple[int, bool]:
    if raw_value is None:
        return default, True
    try:
        return build_mcp_timeout_seconds(raw_value, field_name="timeout"), False
    except ValueError:
        return default, True


def _normalize_mcp_headers(raw_headers: object) -> tuple[dict[str, str], bool]:
    if raw_headers is None:
        return {}, False
    try:
        return build_provider_headers(raw_headers, field_name="headers"), False
    except ValueError:
        return {}, True


def _build_mcp_server_config(
    raw_server: object,
    *,
    base_dir: str | Path | None = None,
) -> tuple[MCPServerConfig | None, bool]:
    if not isinstance(raw_server, dict):
        return None, True

    raw_name = raw_server.get("name", raw_server.get("server_name"))
    if not isinstance(raw_name, str) or not raw_name.strip():
        return None, True
    name = raw_name.strip()
    migrated = name != raw_name or "server_name" in raw_server

    raw_transport = raw_server.get("transport", "stdio")
    try:
        transport = build_mcp_transport(raw_transport)
    except ValueError:
        transport = "stdio"
        migrated = True

    enabled, enabled_migrated = _normalize_mcp_bool(
        raw_server.get("enabled"),
        default=True,
    )
    required, required_migrated = _normalize_mcp_bool(
        raw_server.get("required"),
        default=False,
    )
    startup_timeout_sec, startup_timeout_migrated = _normalize_mcp_timeout(
        raw_server.get("startup_timeout_sec"),
        default=DEFAULT_MCP_SERVER_STARTUP_TIMEOUT_SEC,
    )
    tool_timeout_sec, tool_timeout_migrated = _normalize_mcp_timeout(
        raw_server.get("tool_timeout_sec"),
        default=DEFAULT_MCP_SERVER_TOOL_TIMEOUT_SEC,
    )
    enabled_tools, enabled_tools_migrated = _normalize_mcp_mount_list(
        raw_server.get("enabled_tools")
    )
    disabled_tools, disabled_tools_migrated = _normalize_mcp_mount_list(
        raw_server.get("disabled_tools")
    )
    scopes, scopes_migrated = _normalize_mcp_mount_list(raw_server.get("scopes"))
    env_vars, env_vars_migrated = _normalize_mcp_mount_list(raw_server.get("env_vars"))
    env_http_headers, env_http_headers_migrated = _normalize_mcp_mount_list(
        raw_server.get("env_http_headers")
    )
    env, env_migrated = _normalize_mcp_headers(raw_server.get("env"))
    http_headers, http_headers_migrated = _normalize_mcp_headers(
        raw_server.get("http_headers")
    )

    raw_args = raw_server.get("args")
    if raw_args is None:
        args: list[str] = []
        args_migrated = False
    else:
        args, args_migrated = _normalize_mcp_mount_list(raw_args)

    raw_oauth_resource = raw_server.get("oauth_resource")
    oauth_resource = (
        raw_oauth_resource.strip() if isinstance(raw_oauth_resource, str) else ""
    )
    raw_launcher = raw_server.get("launcher")
    launcher = raw_launcher.strip() if isinstance(raw_launcher, str) else ""
    if isinstance(raw_launcher, str) and launcher != raw_launcher:
        migrated = True
    if raw_launcher not in {None, ""} and not isinstance(raw_launcher, str):
        migrated = True
    raw_command = raw_server.get("command")
    command = raw_command.strip() if isinstance(raw_command, str) else ""
    cwd_raw = raw_server.get("cwd")
    cwd = ""
    if isinstance(cwd_raw, str) and cwd_raw.strip():
        cwd = _normalize_mcp_server_cwd(cwd_raw.strip(), base_dir=base_dir)
        migrated = migrated or cwd != cwd_raw
    elif cwd_raw not in {None, ""}:
        migrated = True
    raw_url = raw_server.get("url")
    url = raw_url.strip() if isinstance(raw_url, str) else ""
    raw_bearer_token_env_var = raw_server.get("bearer_token_env_var")
    bearer_token_env_var = (
        raw_bearer_token_env_var.strip()
        if isinstance(raw_bearer_token_env_var, str)
        else ""
    )

    if transport == "stdio":
        if (
            scopes
            or oauth_resource
            or url
            or bearer_token_env_var
            or http_headers
            or env_http_headers
        ):
            migrated = True
        scopes = []
        oauth_resource = ""
        url = ""
        bearer_token_env_var = ""
        http_headers = {}
        env_http_headers = []
    else:
        if command or args or env or env_vars or cwd:
            migrated = True
        command = ""
        args = []
        env = {}
        env_vars = []
        cwd = ""

    migrated = (
        migrated
        or enabled_migrated
        or required_migrated
        or startup_timeout_migrated
        or tool_timeout_migrated
        or enabled_tools_migrated
        or disabled_tools_migrated
        or scopes_migrated
        or args_migrated
        or env_migrated
        or env_vars_migrated
        or http_headers_migrated
        or env_http_headers_migrated
    )

    return (
        MCPServerConfig(
            name=name,
            transport=transport,
            enabled=enabled,
            required=required,
            startup_timeout_sec=startup_timeout_sec,
            tool_timeout_sec=tool_timeout_sec,
            enabled_tools=enabled_tools,
            disabled_tools=disabled_tools,
            scopes=scopes,
            oauth_resource=oauth_resource,
            launcher=launcher,
            command=command,
            args=args,
            env=env,
            env_vars=env_vars,
            cwd=cwd,
            url=url,
            bearer_token_env_var=bearer_token_env_var,
            http_headers=http_headers,
            env_http_headers=env_http_headers,
        ),
        migrated,
    )


def _normalize_mcp_servers(
    raw_servers: object,
    *,
    base_dir: str | Path | None = None,
) -> tuple[list[MCPServerConfig], bool]:
    if raw_servers is None:
        return [], False
    if not isinstance(raw_servers, list):
        return [], True

    normalized: list[MCPServerConfig] = []
    seen: set[str] = set()
    migrated = False
    for raw_server in raw_servers:
        server, server_migrated = _build_mcp_server_config(
            raw_server,
            base_dir=base_dir,
        )
        migrated = migrated or server_migrated
        if server is None:
            continue
        if server.name in seen:
            migrated = True
            continue
        seen.add(server.name)
        normalized.append(server)
    return normalized, migrated


def _build_pending_chat(raw_chat: object) -> tuple[TelegramPendingChat | None, bool]:
    if not isinstance(raw_chat, dict):
        return None, True

    chat_id_value = raw_chat.get("chat_id")
    if isinstance(chat_id_value, bool) or not isinstance(chat_id_value, int):
        return None, True

    username, username_migrated = _normalize_optional_string(raw_chat.get("username"))
    display_name, display_name_migrated = _normalize_required_string(
        raw_chat.get("display_name")
    )
    first_seen_at, first_seen_migrated = _normalize_float(raw_chat.get("first_seen_at"))
    last_seen_at, last_seen_migrated = _normalize_float(raw_chat.get("last_seen_at"))

    pending_chat = TelegramPendingChat(
        chat_id=chat_id_value,
        username=username,
        display_name=display_name,
        first_seen_at=first_seen_at,
        last_seen_at=last_seen_at,
    )
    migrated = (
        username_migrated
        or display_name_migrated
        or first_seen_migrated
        or last_seen_migrated
    )
    return pending_chat, migrated


def _build_approved_chat(
    raw_chat: object,
) -> tuple[TelegramApprovedChat | None, bool]:
    if not isinstance(raw_chat, dict):
        return None, True

    chat_id_value = raw_chat.get("chat_id")
    if isinstance(chat_id_value, bool) or not isinstance(chat_id_value, int):
        return None, True

    username, username_migrated = _normalize_optional_string(raw_chat.get("username"))
    display_name, display_name_migrated = _normalize_required_string(
        raw_chat.get("display_name")
    )
    approved_at, approved_at_migrated = _normalize_float(raw_chat.get("approved_at"))

    approved_chat = TelegramApprovedChat(
        chat_id=chat_id_value,
        username=username,
        display_name=display_name,
        approved_at=approved_at,
    )
    migrated = username_migrated or display_name_migrated or approved_at_migrated
    return approved_chat, migrated


def _normalize_pending_chats(
    raw_chats: object,
) -> tuple[list[TelegramPendingChat], bool]:
    if raw_chats is None:
        return [], False
    if not isinstance(raw_chats, list):
        return [], True

    normalized: list[TelegramPendingChat] = []
    seen_chat_ids: set[int] = set()
    migrated = False
    for raw_chat in raw_chats:
        chat, chat_migrated = _build_pending_chat(raw_chat)
        migrated = migrated or chat_migrated
        if chat is None:
            continue
        if chat.chat_id in seen_chat_ids:
            migrated = True
            continue
        seen_chat_ids.add(chat.chat_id)
        normalized.append(chat)
    return normalized, migrated


def _normalize_approved_chats(
    raw_chats: object,
) -> tuple[list[TelegramApprovedChat], bool]:
    if raw_chats is None:
        return [], False
    if not isinstance(raw_chats, list):
        return [], True

    normalized: list[TelegramApprovedChat] = []
    seen_chat_ids: set[int] = set()
    migrated = False
    for raw_chat in raw_chats:
        chat, chat_migrated = _build_approved_chat(raw_chat)
        migrated = migrated or chat_migrated
        if chat is None:
            continue
        if chat.chat_id in seen_chat_ids:
            migrated = True
            continue
        seen_chat_ids.add(chat.chat_id)
        normalized.append(chat)
    return normalized, migrated


def _build_settings(data: dict[str, object]) -> tuple[Settings, bool]:
    migrated = False

    event_log_data = data.get("event_log", {})
    if not isinstance(event_log_data, dict):
        event_log_data = {}
    event_log = EventLogSettings(**event_log_data)

    app_data_dir = build_default_app_data_dir()
    raw_app_data_dir = data.get("app_data_dir")
    if (
        raw_app_data_dir is None
        or not isinstance(raw_app_data_dir, str)
        or raw_app_data_dir.strip() != app_data_dir
    ):
        migrated = True

    raw_working_dir = data.get("working_dir")
    if raw_working_dir is None:
        working_dir = build_default_working_dir()
        migrated = True
    else:
        try:
            working_dir = build_working_dir(raw_working_dir)
            if not isinstance(raw_working_dir, str) or working_dir != raw_working_dir:
                migrated = True
        except ValueError:
            working_dir = build_default_working_dir()
            migrated = True

    access_data = data.get("access", {})
    if access_data is None:
        access_data = {}
    if not isinstance(access_data, dict):
        access_data = {}
        migrated = True
    raw_access_code_hash = access_data.get("code_hash", "")
    raw_access_code_salt = access_data.get("code_salt", "")
    raw_access_code = access_data.get("code", "")
    raw_access_session_generation = access_data.get("session_generation", 0)
    raw_access_session_signing_secret = access_data.get("session_signing_secret", "")
    access_code = raw_access_code.strip() if isinstance(raw_access_code, str) else ""
    access_code_hash = (
        raw_access_code_hash.strip() if isinstance(raw_access_code_hash, str) else ""
    )
    access_code_salt = (
        raw_access_code_salt.strip() if isinstance(raw_access_code_salt, str) else ""
    )
    access_session_signing_secret = (
        raw_access_session_signing_secret.strip()
        if isinstance(raw_access_session_signing_secret, str)
        else ""
    )
    if raw_access_code is not None and not isinstance(raw_access_code, str):
        migrated = True
    if raw_access_code_hash is not None and not isinstance(raw_access_code_hash, str):
        migrated = True
    if raw_access_code_salt is not None and not isinstance(raw_access_code_salt, str):
        migrated = True
    if raw_access_session_signing_secret is not None and not isinstance(
        raw_access_session_signing_secret,
        str,
    ):
        migrated = True
    if isinstance(raw_access_session_generation, bool) or not isinstance(
        raw_access_session_generation,
        int,
    ):
        access_session_generation = 0
        if "session_generation" in access_data:
            migrated = True
    else:
        access_session_generation = max(raw_access_session_generation, 0)
        if access_session_generation != raw_access_session_generation:
            migrated = True
    if not access_code or not access_code_hash or not access_code_salt:
        if access_code or access_code_hash or access_code_salt:
            migrated = True
        access_code = ""
        access_code_hash = ""
        access_code_salt = ""
    access = AccessSettings(
        code=access_code,
        code_hash=access_code_hash,
        code_salt=access_code_salt,
        session_generation=access_session_generation,
        session_signing_secret=access_session_signing_secret,
    )

    assistant_data = data.get("assistant", {})
    if not isinstance(assistant_data, dict):
        assistant_data = {}
        migrated = True
    if "assistant" not in data:
        migrated = True
    assistant_role_name = assistant_data.get("role_name")
    raw_assistant_allow_network = assistant_data.get("allow_network")
    if raw_assistant_allow_network is None:
        assistant_allow_network = DEFAULT_ASSISTANT_ALLOW_NETWORK
        migrated = True
    else:
        try:
            assistant_allow_network = build_assistant_allow_network(
                raw_assistant_allow_network
            )
        except ValueError:
            assistant_allow_network = DEFAULT_ASSISTANT_ALLOW_NETWORK
            migrated = True
    raw_assistant_write_dirs = assistant_data.get("write_dirs")
    if raw_assistant_write_dirs is None or not isinstance(
        raw_assistant_write_dirs, list
    ):
        assistant_write_dirs = build_default_assistant_write_dirs(working_dir)
        migrated = True
    else:
        assistant_write_dirs = []
        seen_assistant_write_dirs: set[str] = set()
        for raw_item in raw_assistant_write_dirs:
            if not isinstance(raw_item, str):
                migrated = True
                continue
            stripped = raw_item.strip()
            if not stripped:
                migrated = True
                continue
            normalized_item = _normalize_assistant_write_dir(
                stripped,
                base_dir=working_dir,
            )
            if normalized_item != raw_item:
                migrated = True
            if normalized_item in seen_assistant_write_dirs:
                migrated = True
                continue
            seen_assistant_write_dirs.add(normalized_item)
            assistant_write_dirs.append(normalized_item)
    if "mcp_servers" in assistant_data:
        migrated = True
    assistant = AssistantSettings(
        role_name=assistant_role_name.strip()
        if isinstance(assistant_role_name, str) and assistant_role_name.strip()
        else STEWARD_ROLE_NAME,
        allow_network=assistant_allow_network,
        write_dirs=assistant_write_dirs,
    )
    if assistant.role_name == STEWARD_ROLE_NAME and (
        not isinstance(assistant_role_name, str) or not assistant_role_name.strip()
    ):
        migrated = True

    leader_data = data.get("leader", {})
    if not isinstance(leader_data, dict):
        leader_data = {}
        migrated = True
    if "leader" not in data:
        migrated = True
    leader_role_name = leader_data.get("role_name")
    leader = LeaderSettings(
        role_name=leader_role_name.strip()
        if isinstance(leader_role_name, str) and leader_role_name.strip()
        else CONDUCTOR_ROLE_NAME
    )
    if leader.role_name == CONDUCTOR_ROLE_NAME and (
        not isinstance(leader_role_name, str) or not leader_role_name.strip()
    ):
        migrated = True

    telegram_data = data.get("telegram", {})
    if not isinstance(telegram_data, dict):
        telegram_data = {}
        migrated = True
    if "telegram" not in data:
        migrated = True
    bot_token = telegram_data.get("bot_token", "")
    pending_chats, pending_chats_migrated = _normalize_pending_chats(
        telegram_data.get("pending_chats")
    )
    approved_chats, approved_chats_migrated = _normalize_approved_chats(
        telegram_data.get("approved_chats")
    )
    migrated = migrated or pending_chats_migrated or approved_chats_migrated
    if "pending_links" in telegram_data:
        migrated = True
    if "allowed_user_ids" in telegram_data or "registered_chat_ids" in telegram_data:
        migrated = True
        legacy_registered_chat_ids, _ = _normalize_int_list(
            telegram_data.get("registered_chat_ids")
        )
        for chat_id in legacy_registered_chat_ids:
            if any(chat.chat_id == chat_id for chat in approved_chats):
                continue
            approved_chats.append(
                TelegramApprovedChat(
                    chat_id=chat_id,
                    approved_at=0.0,
                )
            )
    telegram = TelegramSettings(
        bot_token=bot_token.strip() if isinstance(bot_token, str) else "",
        pending_chats=pending_chats,
        approved_chats=approved_chats,
    )
    if bot_token is not None and not isinstance(bot_token, str):
        migrated = True

    model_data = data.get("model", {})
    if not isinstance(model_data, dict):
        model_data = {}
        migrated = True
    model_params, model_params_migrated = _normalize_model_params_with_defaults(
        model_data.get("params")
    )
    migrated = migrated or model_params_migrated
    raw_model_retry_policy = model_data.get("retry_policy")
    if raw_model_retry_policy is None:
        model_retry_policy = DEFAULT_LLM_RETRY_POLICY
        migrated = True
    else:
        try:
            model_retry_policy = build_model_retry_policy(raw_model_retry_policy)
        except ValueError:
            model_retry_policy = DEFAULT_LLM_RETRY_POLICY
            migrated = True
    raw_model_max_retries = model_data.get("max_retries")
    if raw_model_max_retries is None:
        model_max_retries = DEFAULT_LLM_MAX_RETRIES
        migrated = True
    else:
        try:
            model_max_retries = build_model_max_retries(raw_model_max_retries)
        except ValueError:
            model_max_retries = DEFAULT_LLM_MAX_RETRIES
            migrated = True
    raw_retry_initial_delay_seconds = model_data.get("retry_initial_delay_seconds")
    if raw_retry_initial_delay_seconds is None:
        retry_initial_delay_seconds = DEFAULT_LLM_RETRY_INITIAL_DELAY_SECONDS
        migrated = True
    else:
        try:
            retry_initial_delay_seconds = build_model_retry_initial_delay_seconds(
                raw_retry_initial_delay_seconds
            )
        except ValueError:
            retry_initial_delay_seconds = DEFAULT_LLM_RETRY_INITIAL_DELAY_SECONDS
            migrated = True
    raw_retry_max_delay_seconds = model_data.get("retry_max_delay_seconds")
    if raw_retry_max_delay_seconds is None:
        retry_max_delay_seconds = DEFAULT_LLM_RETRY_MAX_DELAY_SECONDS
        migrated = True
    else:
        try:
            retry_max_delay_seconds = build_model_retry_max_delay_seconds(
                raw_retry_max_delay_seconds
            )
        except ValueError:
            retry_max_delay_seconds = DEFAULT_LLM_RETRY_MAX_DELAY_SECONDS
            migrated = True
    raw_retry_backoff_cap_retries = model_data.get("retry_backoff_cap_retries")
    if raw_retry_backoff_cap_retries is None:
        retry_backoff_cap_retries = DEFAULT_LLM_RETRY_BACKOFF_CAP_RETRIES
        migrated = True
    else:
        try:
            retry_backoff_cap_retries = build_model_retry_backoff_cap_retries(
                raw_retry_backoff_cap_retries
            )
        except ValueError:
            retry_backoff_cap_retries = DEFAULT_LLM_RETRY_BACKOFF_CAP_RETRIES
            migrated = True
    input_image, migrated_input_image = _normalize_nullable_bool(
        model_data.get("input_image")
    )
    output_image, migrated_output_image = _normalize_nullable_bool(
        model_data.get("output_image")
    )
    structured_output, migrated_structured_output = _normalize_nullable_bool(
        model_data.get("structured_output")
    )
    context_window_tokens, migrated_context_window_tokens = _normalize_positive_int(
        model_data.get("context_window_tokens")
    )
    auto_compact_token_limit, migrated_auto_compact_token_limit = (
        _normalize_positive_int(model_data.get("auto_compact_token_limit"))
    )
    if "auto_compact" in model_data or "auto_compact_threshold" in model_data:
        migrated = True
    try:
        validate_model_retry_backoff_settings(
            retry_initial_delay_seconds=retry_initial_delay_seconds,
            retry_max_delay_seconds=retry_max_delay_seconds,
        )
    except ValueError:
        retry_initial_delay_seconds = DEFAULT_LLM_RETRY_INITIAL_DELAY_SECONDS
        retry_max_delay_seconds = DEFAULT_LLM_RETRY_MAX_DELAY_SECONDS
        migrated = True
    raw_model_timeout_ms = model_data.get("timeout_ms")
    if raw_model_timeout_ms is None:
        model_timeout_ms = DEFAULT_LLM_TIMEOUT_MS
        migrated = True
    else:
        try:
            model_timeout_ms = build_model_timeout_ms(raw_model_timeout_ms)
        except ValueError:
            model_timeout_ms = DEFAULT_LLM_TIMEOUT_MS
            migrated = True
    model_settings = ModelSettings(
        active_provider_id=str(model_data.get("active_provider_id", "")),
        active_model=str(model_data.get("active_model", "")),
        input_image=input_image,
        output_image=output_image,
        structured_output=structured_output,
        context_window_tokens=context_window_tokens,
        params=model_params,
        timeout_ms=model_timeout_ms,
        retry_policy=model_retry_policy,
        max_retries=model_max_retries,
        retry_initial_delay_seconds=retry_initial_delay_seconds,
        retry_max_delay_seconds=retry_max_delay_seconds,
        retry_backoff_cap_retries=retry_backoff_cap_retries,
        auto_compact_token_limit=auto_compact_token_limit,
    )
    migrated = (
        migrated
        or migrated_input_image
        or migrated_output_image
        or migrated_structured_output
        or migrated_context_window_tokens
        or migrated_auto_compact_token_limit
    )
    custom_prompt = str(data.get("custom_prompt", ""))
    if "custom_post_prompt" in data:
        custom_post_prompt = str(data.get("custom_post_prompt", ""))
    else:
        custom_post_prompt = str(data.get("post_prompt", ""))
        if "post_prompt" in data:
            migrated = True

    providers_raw = data.get("providers", [])
    if not isinstance(providers_raw, list):
        providers_raw = []
    providers = []
    for provider in providers_raw:
        if not isinstance(provider, dict):
            continue
        headers, headers_migrated = _normalize_provider_headers(provider.get("headers"))
        models, models_migrated = _normalize_provider_model_catalog_entries(
            provider.get("models")
        )
        migrated = migrated or headers_migrated
        migrated = migrated or models_migrated
        raw_retry_429_delay_seconds = provider.get("retry_429_delay_seconds")
        if raw_retry_429_delay_seconds is None:
            retry_429_delay_seconds = 0
            migrated = True
        else:
            try:
                retry_429_delay_seconds = build_provider_retry_429_delay_seconds(
                    raw_retry_429_delay_seconds
                )
            except ValueError:
                retry_429_delay_seconds = 0
                migrated = True
        providers.append(
            ProviderConfig(
                id=str(provider.get("id", "")),
                name=str(provider.get("name", "")),
                type=str(provider.get("type", "openai_compatible")),
                base_url=str(provider.get("base_url", "")),
                api_key=str(provider.get("api_key", "")),
                headers=headers,
                retry_429_delay_seconds=retry_429_delay_seconds,
                models=models,
            )
        )

    roles_raw = data.get("roles", [])
    if not isinstance(roles_raw, list):
        roles_raw = []
    roles = []
    for role in roles_raw:
        if not isinstance(role, dict):
            continue
        role_name = str(role.get("name", ""))
        if "id" in role:
            migrated = True
            if not role_name:
                role_name = str(role.get("id", ""))
        if "included_tools" in role:
            included_tools_raw = role.get("included_tools", [])
        else:
            included_tools_raw = role.get("required_tools", [])
            if "required_tools" in role:
                migrated = True
        if not isinstance(included_tools_raw, list):
            included_tools_raw = []
        excluded_tools_raw = role.get("excluded_tools", [])
        if not isinstance(excluded_tools_raw, list):
            excluded_tools_raw = []

        role_model: RoleModelConfig | None = None
        role_model_params: ModelParams | None = None
        if "model" in role:
            role_model, role_model_migrated = _normalize_role_model(
                role.get("model"),
                default_provider_id=model_settings.active_provider_id.strip(),
            )
            migrated = migrated or role_model_migrated
        elif "model_override" in role:
            role_model, role_model_migrated = _normalize_role_model(
                role.get("model_override"),
                default_provider_id=model_settings.active_provider_id.strip(),
            )
            migrated = migrated or role_model_migrated or True
        if "model_params" in role:
            role_model_params, role_model_params_migrated = (
                _normalize_optional_model_params(role.get("model_params"))
            )
            migrated = migrated or role_model_params_migrated
        role_system_prompt = str(role.get("system_prompt", ""))
        role_description, role_description_migrated = _normalize_role_description(
            role.get("description"),
            role_name=role_name,
            system_prompt=role_system_prompt,
        )
        migrated = migrated or role_description_migrated

        roles.append(
            RoleConfig(
                name=role_name,
                system_prompt=role_system_prompt,
                description=role_description,
                model=role_model,
                model_params=role_model_params,
                included_tools=normalize_tool_names(
                    [name for name in included_tools_raw if isinstance(name, str)]
                ),
                excluded_tools=normalize_tool_names(
                    [name for name in excluded_tools_raw if isinstance(name, str)]
                ),
            )
        )

    mcp_servers, mcp_servers_migrated = _normalize_mcp_servers(
        data.get("mcp_servers"),
        base_dir=working_dir,
    )
    migrated = migrated or mcp_servers_migrated

    return (
        Settings(
            app_data_dir=app_data_dir,
            working_dir=working_dir,
            event_log=event_log,
            access=access,
            assistant=assistant,
            leader=leader,
            telegram=telegram,
            model=model_settings,
            custom_prompt=custom_prompt,
            custom_post_prompt=custom_post_prompt,
            providers=providers,
            roles=roles,
            mcp_servers=mcp_servers,
        ),
        migrated,
    )


def _read_settings_file() -> tuple[Settings, bool]:
    with _SETTINGS_FILE.open(encoding="utf-8") as settings_file:
        data = json.load(settings_file)
    if not isinstance(data, dict):
        raise ValueError("settings file must contain a JSON object")
    return _build_settings(data)


def _get_settings_file_signature() -> tuple[int, int] | None:
    try:
        stat_result = _SETTINGS_FILE.stat()
    except FileNotFoundError:
        return None
    return (stat_result.st_mtime_ns, stat_result.st_size)


def _preserve_newer_live_access(settings: Settings) -> None:
    if _get_settings_file_signature() is None:
        return
    try:
        live_settings, _ = _read_settings_file()
    except Exception as exc:
        logger.warning(
            "Failed to read live settings from {} while preserving access: {}",
            _SETTINGS_FILE,
            exc,
        )
        return
    if live_settings.access.session_generation > settings.access.session_generation:
        settings.access = live_settings.access
        return
    if (
        live_settings.access.session_signing_secret.strip()
        and not settings.access.session_signing_secret.strip()
    ):
        settings.access.session_signing_secret = (
            live_settings.access.session_signing_secret
        )


def load_settings() -> Settings:
    global _cached_settings, _cached_settings_file_signature
    current_signature = _get_settings_file_signature()
    with _settings_lock:
        if (
            _cached_settings is not None
            and _cached_settings_file_signature == current_signature
        ):
            return _cached_settings

    if current_signature is None:
        loaded_settings = Settings()
        loaded_signature = None
        with _settings_lock:
            _cached_settings = loaded_settings
            _cached_settings_file_signature = loaded_signature
            return _cached_settings

    try:
        loaded_settings, migrated = _read_settings_file()
        loaded_signature = _get_settings_file_signature()
    except Exception as exc:
        logger.warning(
            "Failed to load settings from {}: {}. Falling back to defaults.",
            _SETTINGS_FILE,
            exc,
        )
        loaded_settings = Settings()
        loaded_signature = current_signature
        migrated = False

    if migrated:
        try:
            save_settings(loaded_settings)
            loaded_signature = _get_settings_file_signature()
        except Exception as exc:
            logger.warning(
                "Failed to persist migrated settings to {}: {}",
                _SETTINGS_FILE,
                exc,
            )

    with _settings_lock:
        _cached_settings = loaded_settings
        _cached_settings_file_signature = loaded_signature
        return _cached_settings


def save_settings(settings: Settings) -> None:
    global _cached_settings, _cached_settings_file_signature
    temp_path: Path | None = None
    _SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    _preserve_newer_live_access(settings)

    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=_SETTINGS_FILE.parent,
            prefix=f"{_SETTINGS_FILE.name}.",
            suffix=".tmp",
            delete=False,
        ) as temp_file:
            temp_path = Path(temp_file.name)
            json.dump(asdict(settings), temp_file, indent=2)
            temp_file.flush()
            os.fsync(temp_file.fileno())

        os.replace(temp_path, _SETTINGS_FILE)
    except Exception:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)
        raise

    persisted_signature = _get_settings_file_signature()
    with _settings_lock:
        _cached_settings = settings
        _cached_settings_file_signature = persisted_signature


def get_settings() -> Settings:
    return load_settings()


def find_provider(settings: Settings, provider_id: str) -> ProviderConfig | None:
    for p in settings.providers:
        if p.id == provider_id:
            return p
    return None


def find_role(settings: Settings, role_name: str) -> RoleConfig | None:
    for r in settings.roles:
        if r.name == role_name:
            return r
    return None


def find_mcp_server(settings: Settings, server_name: str) -> MCPServerConfig | None:
    for server in settings.mcp_servers:
        if server.name == server_name:
            return server
    return None


def clear_provider_references(settings: Settings, provider_id: str) -> bool:
    changed = False

    if settings.model.active_provider_id == provider_id:
        settings.model.active_provider_id = ""
        settings.model.active_model = ""
        changed = True

    for role in settings.roles:
        if role.model is None or role.model.provider_id != provider_id:
            continue
        role.model = None
        changed = True
    return changed


def build_steward_role() -> RoleConfig:
    return RoleConfig(
        name=STEWARD_ROLE_NAME,
        system_prompt=STEWARD_ROLE_SYSTEM_PROMPT,
        description=STEWARD_ROLE_DESCRIPTION,
        included_tools=list(STEWARD_ROLE_INCLUDED_TOOLS),
        excluded_tools=[],
    )


def build_worker_role() -> RoleConfig:
    return RoleConfig(
        name=WORKER_ROLE_NAME,
        system_prompt=WORKER_ROLE_SYSTEM_PROMPT,
        description=WORKER_ROLE_DESCRIPTION,
        included_tools=list(WORKER_ROLE_INCLUDED_TOOLS),
        excluded_tools=[],
    )


def build_conductor_role() -> RoleConfig:
    return RoleConfig(
        name=CONDUCTOR_ROLE_NAME,
        system_prompt=CONDUCTOR_ROLE_SYSTEM_PROMPT,
        description=CONDUCTOR_ROLE_DESCRIPTION,
        included_tools=list(CONDUCTOR_ROLE_INCLUDED_TOOLS),
        excluded_tools=[],
    )


def build_designer_role() -> RoleConfig:
    return RoleConfig(
        name=DESIGNER_ROLE_NAME,
        system_prompt=DESIGNER_ROLE_SYSTEM_PROMPT,
        description=DESIGNER_ROLE_DESCRIPTION,
        included_tools=list(DESIGNER_ROLE_INCLUDED_TOOLS),
        excluded_tools=[],
    )


def rename_role_references(
    settings: Settings,
    old_role_name: str,
    new_role_name: str,
) -> bool:
    changed = False
    if settings.assistant.role_name == old_role_name:
        settings.assistant.role_name = new_role_name
        changed = True
    if settings.leader.role_name == old_role_name:
        settings.leader.role_name = new_role_name
        changed = True
    return changed


def clear_role_references(settings: Settings, role_name: str) -> bool:
    changed = False
    if settings.assistant.role_name == role_name:
        settings.assistant.role_name = STEWARD_ROLE_NAME
        changed = True
    if settings.leader.role_name == role_name:
        settings.leader.role_name = CONDUCTOR_ROLE_NAME
        changed = True
    return changed


def ensure_assistant_role(settings: Settings) -> bool:
    if find_role(settings, settings.assistant.role_name) is not None:
        return False
    settings.assistant.role_name = STEWARD_ROLE_NAME
    return True


def ensure_leader_role(settings: Settings) -> bool:
    if find_role(settings, settings.leader.role_name) is not None:
        return False
    settings.leader.role_name = CONDUCTOR_ROLE_NAME
    return True


def _ensure_builtin_role(settings: Settings, standard_role: RoleConfig) -> bool:
    current_role = find_role(settings, standard_role.name)
    if current_role is None:
        settings.roles.append(standard_role)
        return True
    if (
        current_role.description != standard_role.description
        or current_role.system_prompt != standard_role.system_prompt
        or current_role.included_tools != standard_role.included_tools
        or current_role.excluded_tools != standard_role.excluded_tools
    ):
        current_role.description = standard_role.description
        current_role.system_prompt = standard_role.system_prompt
        current_role.included_tools = list(standard_role.included_tools)
        current_role.excluded_tools = list(standard_role.excluded_tools)
        return True
    return False


def ensure_builtin_roles(settings: Settings) -> bool:
    changed = False
    builtin_role_order = [
        build_steward_role(),
        build_worker_role(),
        build_conductor_role(),
        build_designer_role(),
    ]
    for standard_role in builtin_role_order:
        changed = _ensure_builtin_role(settings, standard_role) or changed
    changed = ensure_assistant_role(settings) or changed
    changed = ensure_leader_role(settings) or changed

    ordered_roles: list[RoleConfig] = []
    builtin_role_names = {role.name for role in builtin_role_order}
    for standard_role in builtin_role_order:
        current_role = find_role(settings, standard_role.name)
        if current_role is not None:
            ordered_roles.append(current_role)
    for role in settings.roles:
        if role.name not in builtin_role_names:
            ordered_roles.append(role)
    if ordered_roles != settings.roles:
        settings.roles = ordered_roles
        changed = True
    return changed


def is_builtin_role_name(role_name: str) -> bool:
    return role_name in BUILTIN_ROLE_NAMES
