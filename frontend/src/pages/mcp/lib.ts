import { formatLocalTimestamp } from "@/lib/datetime";
import type {
  MCPActivityRecord,
  MCPPromptDescriptor,
  MCPServerConfig,
  MCPServerRecord,
} from "@/types";

export type DetailTab = "overview" | "capabilities" | "activity";
export type CapabilityTab =
  | "tools"
  | "resources"
  | "resource_templates"
  | "prompts";
export type ServerStatusFilter =
  | "all"
  | "connected"
  | "auth_required"
  | "error"
  | "disabled"
  | "connecting";
export type ActivityFilter =
  | "all"
  | "refresh"
  | "auth"
  | "tool"
  | "resource"
  | "prompt";

export interface ServerSummaryCounts {
  authRequired: number;
  configured: number;
  connected: number;
  error: number;
}

export interface McpServerDialogState {
  draft: MCPServerConfig;
  editingServerName: string | null;
  open: boolean;
  openCreateDialog: () => void;
  openEditDialog: (record: MCPServerRecord) => void;
  pending: boolean;
  saveServer: () => Promise<void>;
  setDraft: (draft: MCPServerConfig) => void;
  setOpen: (open: boolean) => void;
}

export interface QuickAddState {
  error: string | null;
  input: string;
  nameValue: string;
  parse: {
    draft: MCPServerConfig | null;
    error: string | null;
  };
  pending: boolean;
  setInput: (value: string) => void;
  setName: (value: string) => void;
  submit: () => Promise<void>;
}

export interface PromptPreviewState {
  argumentsText: string;
  loading: boolean;
  preview: Record<string, unknown> | null;
  previewCurrent: () => void;
  selectPrompt: (serverName: string, promptName: string) => void;
  selectedPrompt: MCPPromptDescriptor | null;
  selectedPromptName: string | null;
  setArgumentsText: (value: string) => void;
}

export interface McpServerActions {
  deleteServer: (serverName: string) => Promise<void>;
  login: (serverName: string) => Promise<void>;
  logout: (serverName: string) => Promise<void>;
  refreshAll: () => Promise<void>;
  refreshServer: (serverName: string) => Promise<void>;
  toggleEnabled: (record: MCPServerRecord) => Promise<void>;
}

export const DETAIL_TABS: DetailTab[] = [
  "overview",
  "capabilities",
  "activity",
];

export const CAPABILITY_TABS: CapabilityTab[] = [
  "tools",
  "resources",
  "resource_templates",
  "prompts",
];

export const SERVER_FILTER_OPTIONS: Array<{
  value: ServerStatusFilter;
  label: string;
}> = [
  { value: "all", label: "All" },
  { value: "connected", label: "Connected" },
  { value: "auth_required", label: "Auth Required" },
  { value: "error", label: "Error" },
  { value: "disabled", label: "Disabled" },
  { value: "connecting", label: "Connecting" },
];

export const ACTIVITY_FILTER_OPTIONS: Array<{
  value: ActivityFilter;
  label: string;
}> = [
  { value: "all", label: "All" },
  { value: "refresh", label: "Refresh" },
  { value: "auth", label: "Auth" },
  { value: "tool", label: "Tool" },
  { value: "resource", label: "Resource" },
  { value: "prompt", label: "Prompt" },
];

export const EMPTY_SERVER_DRAFT: MCPServerConfig = {
  name: "",
  transport: "stdio",
  enabled: true,
  required: false,
  startup_timeout_sec: 10,
  tool_timeout_sec: 30,
  enabled_tools: [],
  disabled_tools: [],
  scopes: [],
  oauth_resource: "",
  launcher: "",
  command: "",
  args: [],
  env: {},
  env_vars: [],
  cwd: "",
  url: "",
  bearer_token_env_var: "",
  http_headers: {},
  env_http_headers: [],
};

export function formatTimestamp(value?: number | null) {
  return formatLocalTimestamp(value, { fallback: "Never" });
}

export function formatSentenceCase(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatAuthStatus(value: string) {
  switch (value) {
    case "unsupported":
      return "Unsupported";
    case "not_logged_in":
      return "Not logged in";
    case "logging_in":
      return "Logging in";
    case "connected":
      return "Connected";
    case "error":
      return "Error";
    default:
      return formatSentenceCase(value);
  }
}

export function formatTimestampShort(value?: number | null) {
  return formatLocalTimestamp(value, {
    fallback: "Never",
    format: {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    },
  });
}

export function statusLabel(status: string) {
  switch (status) {
    case "disabled":
      return "Disabled";
    case "connecting":
      return "Connecting";
    case "connected":
      return "Connected";
    case "auth_required":
      return "Auth required";
    case "error":
      return "Error";
    default:
      return status;
  }
}

export function statusClassName(status: string) {
  switch (status) {
    case "connected":
      return "border-graph-status-running/18 bg-graph-status-running/[0.12] text-graph-status-running";
    case "auth_required":
      return "border-graph-status-idle/18 bg-graph-status-idle/[0.12] text-graph-status-idle";
    case "error":
      return "border-destructive/30 bg-destructive/10 text-destructive";
    case "disabled":
      return "border-border bg-accent/20 text-muted-foreground";
    default:
      return "border-primary/20 bg-primary/[0.1] text-primary";
  }
}

export function resultClassName(result: string) {
  switch (result) {
    case "success":
      return "border-graph-status-running/18 bg-graph-status-running/[0.12] text-graph-status-running";
    case "rejected":
      return "border-graph-status-idle/18 bg-graph-status-idle/[0.12] text-graph-status-idle";
    default:
      return "border-destructive/30 bg-destructive/10 text-destructive";
  }
}

export function capabilitySummary(record: MCPServerRecord) {
  const counts = record.snapshot.capability_counts;
  return `${counts.tools} tools · ${counts.resources} resources · ${counts.prompts} prompts`;
}

export function globalAvailabilityLabel(record: MCPServerRecord) {
  if (!record.visibility.active) {
    return null;
  }
  return "Global";
}

function stripShellQuotes(token: string) {
  if (token.length < 2) {
    return token;
  }
  if (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'"))
  ) {
    return token.slice(1, -1);
  }
  return token;
}

export function tokenizeLauncher(value: string) {
  const matches = value.match(/'[^']*'|"[^"]*"|\S+/g);
  return (matches ?? []).map((token) => stripShellQuotes(token));
}

function normalizeSuggestedName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function deriveNameFromPackageToken(token: string) {
  const withoutVersion = token.startsWith("@")
    ? token.replace(/@[^/@]+$/u, "")
    : token.replace(/@[^/]+$/u, "");
  const segments = withoutVersion.split("/").filter(Boolean);
  return normalizeSuggestedName(segments.join("-"));
}

function deriveNameFromUrl(value: string) {
  try {
    const url = new URL(value);
    const candidates = url.hostname
      .replace(/^www\./u, "")
      .split(".")
      .filter((segment) => segment && !["mcp", "api"].includes(segment));
    return normalizeSuggestedName(candidates[0] ?? url.hostname);
  } catch {
    return "";
  }
}

export function suggestServerName(input: string, tokens: string[]) {
  if (/^https?:\/\//u.test(input)) {
    return deriveNameFromUrl(input);
  }
  const runner = tokens[0] ?? "";
  const packageTokenStart =
    runner === "pnpm" || runner === "yarn" ? 2 : runner === "npm" ? 3 : 1;
  const packageToken = tokens
    .slice(packageTokenStart)
    .find((token) => token && !token.startsWith("-"));
  if (packageToken) {
    const derived = deriveNameFromPackageToken(packageToken);
    if (derived) {
      return derived;
    }
  }
  if (!runner) {
    return "";
  }
  return normalizeSuggestedName(runner.split("/").pop() ?? runner);
}

export function buildQuickAddDraft(
  input: string,
  name: string,
): { draft: MCPServerConfig | null; error: string | null } {
  const trimmedInput = input.trim();
  const trimmedName = normalizeSuggestedName(name);
  if (!trimmedInput) {
    return { draft: null, error: "Enter a launcher command or URL." };
  }
  if (!trimmedName) {
    return { draft: null, error: "Quick Add needs a valid server name." };
  }
  if (/^https?:\/\//u.test(trimmedInput)) {
    try {
      const normalizedUrl = new URL(trimmedInput).toString();
      return {
        draft: {
          ...EMPTY_SERVER_DRAFT,
          name: trimmedName,
          transport: "streamable_http",
          launcher: trimmedInput,
          url: normalizedUrl,
        },
        error: null,
      };
    } catch {
      return { draft: null, error: "Quick Add URL is not valid." };
    }
  }
  const tokens = tokenizeLauncher(trimmedInput);
  if (tokens.length === 0) {
    return {
      draft: null,
      error: "Quick Add needs a single-line launcher command.",
    };
  }
  return {
    draft: {
      ...EMPTY_SERVER_DRAFT,
      name: trimmedName,
      transport: "stdio",
      launcher: trimmedInput,
      command: tokens[0],
      args: tokens.slice(1),
    },
    error: null,
  };
}

export function parsedLauncherSummary(record: MCPServerRecord) {
  if (record.config.transport === "streamable_http") {
    return record.config.url.trim() || "No URL configured";
  }
  return [record.config.command, ...record.config.args]
    .filter(Boolean)
    .join(" ");
}

export function buildPendingServerRecord(
  config: MCPServerConfig,
): MCPServerRecord {
  return {
    config,
    snapshot: {
      server_name: config.name,
      transport: config.transport,
      status: "connecting",
      auth_status:
        config.transport === "stdio" ? "unsupported" : "not_logged_in",
      last_auth_result: null,
      last_refresh_at: null,
      last_refresh_result: "never",
      last_error: null,
      tools: [],
      resources: [],
      resource_templates: [],
      prompts: [],
      capability_counts: {
        tools: 0,
        resources: 0,
        resource_templates: 0,
        prompts: 0,
      },
    },
    visibility: {
      scope: "global",
      active: false,
    },
    activity: [],
  };
}

export function toolFilterSummary(record: MCPServerRecord) {
  if (record.config.enabled_tools.length > 0) {
    return `Enabled tools limited to ${record.config.enabled_tools.length} entries`;
  }
  if (record.config.disabled_tools.length > 0) {
    return `${record.config.disabled_tools.length} tools excluded`;
  }
  return "All discovered tools remain available";
}

export function authActionLabel(record: MCPServerRecord) {
  if (record.config.transport === "stdio") {
    return "Auth N/A";
  }
  return record.snapshot.auth_status === "connected" ? "Logout" : "Login";
}

export function authActionDisabled(record: MCPServerRecord) {
  return record.config.transport === "stdio";
}

export function readonlyText(
  value: string | null | undefined,
  fallback = "Not set",
) {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed || fallback;
}

export function readonlyList(values: string[], fallback = "None") {
  if (values.length === 0) {
    return fallback;
  }
  return values.join("\n");
}

export function readonlyMapKeys(
  values: Record<string, string>,
  fallback = "None",
) {
  const keys = Object.keys(values);
  if (keys.length === 0) {
    return fallback;
  }
  return keys.join("\n");
}

function isAuthRelatedActivity(record: MCPActivityRecord) {
  if (record.action === "login" || record.action === "logout") {
    return true;
  }
  if (record.action !== "refresh") {
    return false;
  }
  const haystack = `${record.summary} ${record.target ?? ""}`.toLowerCase();
  return [
    "auth",
    "authentication",
    "oauth",
    "token",
    "bearer",
    "login",
    "logged out",
    "env var",
  ].some((keyword) => haystack.includes(keyword));
}

export function activityFilterForRecord(
  record: MCPActivityRecord,
): ActivityFilter {
  if (isAuthRelatedActivity(record)) {
    return "auth";
  }
  switch (record.action) {
    case "refresh":
      return "refresh";
    case "login":
    case "logout":
      return "auth";
    case "tool_call":
      return "tool";
    case "resource_read":
      return "resource";
    case "prompt_get":
      return "prompt";
    default:
      return "all";
  }
}

export function activityCategoryLabel(record: MCPActivityRecord) {
  switch (activityFilterForRecord(record)) {
    case "refresh":
      return "Refresh";
    case "auth":
      return "Auth";
    case "tool":
      return "Tool";
    case "resource":
      return "Resource";
    case "prompt":
      return "Prompt";
    default:
      return formatSentenceCase(record.action);
  }
}

export function matchesServerFilter(
  record: MCPServerRecord,
  statusFilter: ServerStatusFilter,
) {
  if (statusFilter !== "all" && record.snapshot.status !== statusFilter) {
    return false;
  }
  return true;
}

export function renderValueOrFallback(value: string, fallback = "Not set") {
  return value.trim() ? value : fallback;
}

export function buildPromptPreviewArguments(
  prompt: MCPPromptDescriptor | null | undefined,
) {
  return Object.fromEntries(
    (prompt?.arguments ?? [])
      .map((argument) => argument.name)
      .filter(
        (name): name is string => typeof name === "string" && name.length > 0,
      )
      .map((name) => [name, ""]),
  );
}
