export type NodeType =
  | "assistant"
  | "agent"
  | "trigger"
  | "llm"
  | "code"
  | "if"
  | "merge";

export type WorkflowNodeType = Exclude<NodeType, "assistant">;
export type WorkflowPortType = "parts" | "string" | "json";
export type WorkflowPortDirection = "in" | "out";

export interface AccessState {
  authenticated: boolean;
  configured: boolean;
  bootstrap_generated: boolean;
  requires_restart: boolean;
}

export type AgentState =
  | "initializing"
  | "idle"
  | "sleeping"
  | "running"
  | "error"
  | "terminated";

export type DisplayEventType =
  | "tab_created"
  | "tab_updated"
  | "tab_deleted"
  | "node_created"
  | "node_state_changed"
  | "node_todos_changed"
  | "node_message"
  | "node_terminated"
  | "node_deleted"
  | "node_connected"
  | "node_disconnected"
  | "assistant_content"
  | "tool_called";

export type UpdateEventType =
  | DisplayEventType
  | "history_cleared"
  | "history_replaced"
  | "history_entry_added"
  | "history_entry_delta";

export type EventType = UpdateEventType;

export interface TodoItem {
  text: string;
  type: string;
}

export interface Node {
  id: string;
  node_type: NodeType;
  tab_id?: string | null;
  is_leader: boolean;
  state: AgentState;
  connections: string[];
  name: string | null;
  todos: TodoItem[];
  role_name: string | null;
  capabilities?: ModelCapabilities | null;
  position?: {
    x: number;
    y: number;
  } | null;
  config?: Record<string, unknown>;
  inputs?: WorkflowPort[];
  outputs?: WorkflowPort[];
}

export interface AgentEvent {
  type: EventType;
  agent_id: string;
  data: Record<string, unknown>;
  timestamp: number;
}

export interface AssistantChatMessage {
  id: string;
  content: string;
  parts?: ContentPart[] | null;
  message_id?: string | null;
  timestamp: number;
  from: "human" | "assistant";
}

export interface PendingAssistantChatMessage extends AssistantChatMessage {
  type: "PendingHumanMessage";
}

export interface PendingSendChatMessage extends AssistantChatMessage {
  type: "PendingSendMessage";
  target_id: string;
  target_state?: AgentState | null;
  history_entry: AssistantInputHistoryEntry;
  history_entry_scope: string;
  send_failed?: boolean;
}

export interface AssistantInputHistoryImage {
  assetId: string;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  name: string;
}

export interface AssistantInputHistoryEntry {
  text: string;
  images: AssistantInputHistoryImage[];
  timestamp: number;
}

export type HistoryEntryType =
  | "SystemEntry"
  | "ReceivedMessage"
  | "AssistantText"
  | "SentMessage"
  | "PortInboundEntry"
  | "AssistantThinking"
  | "ToolCall"
  | "ErrorEntry"
  | "CommandResultEntry";

export type ContentPart =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "image";
      asset_id: string;
      mime_type?: string | null;
      width?: number | null;
      height?: number | null;
      alt?: string | null;
    };

export interface HistoryEntry {
  type: HistoryEntryType;
  content?: string | null;
  parts?: ContentPart[] | null;
  from_id?: string | null;
  to_id?: string | null;
  to_ids?: string[] | null;
  from_output_port_key?: string | null;
  to_input_port_key?: string | null;
  port_type?: WorkflowPortType | string | null;
  value?: unknown;
  source_label?: string | null;
  value_summary?: string | null;
  message_id?: string | null;
  tool_name?: string | null;
  tool_call_id?: string | null;
  arguments?: Record<string, unknown> | null;
  result?: string | null;
  command_name?: string | null;
  include_in_context?: boolean;
  timestamp: number;
  streaming?: boolean;
}

export type AssistantChatItem =
  | HistoryEntry
  | PendingAssistantChatMessage
  | PendingSendChatMessage;

export interface ContactSummary {
  id: string;
  node_type: NodeType;
  role_name: string | null;
  name: string | null;
  state: AgentState | null;
  is_leader: boolean;
}

export interface ContactPath extends ContactSummary {
  target_id: string;
  from_output_port_key: string;
  to_input_port_key: string;
  port_type: WorkflowPortType;
  edge_id: string;
}

export type ContactEntry = string | ContactSummary | ContactPath;

export interface NodeDetail {
  id: string;
  node_type: NodeType;
  tab_id?: string | null;
  is_leader: boolean;
  state: AgentState;
  name: string | null;
  contacts: ContactEntry[];
  connections: string[];
  role_name: string | null;
  todos: TodoItem[];
  capabilities?: ModelCapabilities | null;
  tools: string[];
  write_dirs: string[];
  allow_network: boolean;
  workflow_permissions?: {
    write_dirs: string[];
    allow_network: boolean;
  } | null;
  position?: {
    x: number;
    y: number;
  } | null;
  history: HistoryEntry[];
}

export interface WorkflowPort {
  key: string;
  direction: WorkflowPortDirection;
  type: WorkflowPortType;
  required: boolean;
  multiple: boolean;
}

export interface WorkflowNodeDefinition {
  id: string;
  type: WorkflowNodeType;
  config: Record<string, unknown>;
  inputs: WorkflowPort[];
  outputs: WorkflowPort[];
}

export interface WorkflowView {
  positions?: Record<
    string,
    {
      x: number;
      y: number;
    }
  >;
}

export interface WorkflowDefinition {
  version: number;
  nodes: WorkflowNodeDefinition[];
  edges: TabEdge[];
  view?: WorkflowView;
}

export interface BlueprintSlot {
  id: string;
  role_name: string;
  display_name: string | null;
}

export interface BlueprintEdge {
  from_slot_id: string;
  to_slot_id: string;
}

export interface BlueprintVersionSummary {
  version: number;
  updated_at: number;
}

export interface AgentBlueprint {
  id: string;
  name: string;
  description: string;
  version: number;
  slots: BlueprintSlot[];
  edges: BlueprintEdge[];
  created_at: number;
  updated_at: number;
  node_count: number;
  edge_count: number;
  version_history?: BlueprintVersionSummary[];
}

export interface TaskTab {
  id: string;
  title: string;
  leader_id?: string | null;
  created_at: number;
  updated_at: number;
  definition: WorkflowDefinition;
  allow_network: boolean;
  write_dirs: string[];
  node_count?: number;
  edge_count?: number;
}

export interface TabEdge {
  id: string;
  from_node_id: string;
  from_port_key: string;
  to_node_id: string;
  to_port_key: string;
  kind?: "control" | "data" | "event";
  tab_id?: string;
  created_at?: number;
}

export interface RoleModelConfig {
  provider_id: string;
  model: string;
}

export interface ModelParams {
  reasoning_effort: "none" | "low" | "medium" | "high" | "xhigh" | null;
  verbosity: "low" | "medium" | "high" | null;
  max_output_tokens: number | null;
  temperature: number | null;
  top_p: number | null;
}

export interface ModelCapabilities {
  input_image: boolean;
  output_image: boolean;
  structured_output?: boolean;
}

export type StreamingDelta =
  | { type: "ContentDelta"; text: string }
  | { type: "ThinkingDelta"; text: string }
  | { type: "ToolResultDelta"; tool_call_id: string; text: string }
  | {
      type: "SentMessageDelta";
      message_id: string;
      to_id: string;
      text: string;
    }
  | {
      type: "ReceivedMessageDelta";
      message_id: string;
      from_id: string;
      text: string;
    };

export interface Role {
  name: string;
  description: string;
  system_prompt: string;
  model: RoleModelConfig | null;
  model_params: ModelParams | null;
  included_tools: string[];
  excluded_tools: string[];
  is_builtin: boolean;
}

export interface Provider {
  id: string;
  name: string;
  type: string;
  base_url: string;
  api_key: string;
  headers: Record<string, string>;
  retry_429_delay_seconds: number;
  models: ProviderModelCatalogEntry[];
}

export interface ProviderModelCatalogEntry {
  model: string;
  source: "discovered" | "manual";
  context_window_tokens: number | null;
  input_image: boolean | null;
  output_image: boolean | null;
  structured_output?: boolean | null;
}

export interface ModelOption {
  id: string;
  capabilities?: ModelCapabilities | null;
  context_window_tokens?: number | null;
}

export type RetryPolicy = "no_retry" | "limited" | "unlimited";

export interface TelegramPendingChat {
  chat_id: number;
  username: string | null;
  display_name: string;
  first_seen_at: number;
  last_seen_at: number;
}

export interface TelegramApprovedChat {
  chat_id: number;
  username: string | null;
  display_name: string;
  approved_at: number;
}

export interface TelegramSettings {
  bot_token: string;
  pending_chats: TelegramPendingChat[];
  approved_chats: TelegramApprovedChat[];
}
