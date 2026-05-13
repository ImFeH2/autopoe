import type {
  AgentEvent,
  Node,
  TabEdge,
  TaskTab,
  WorkflowDefinition,
  WorkflowNodeDefinition,
  WorkflowPort,
  WorkflowView,
  WorkflowNodeType,
} from "@/types";

const HAS_OWN = Object.prototype.hasOwnProperty;
const WORKFLOW_NODE_TYPES = new Set<WorkflowNodeType>([
  "agent",
  "trigger",
  "llm",
  "code",
  "if",
  "merge",
]);
const PORT_DIRECTIONS = new Set<WorkflowPort["direction"]>(["in", "out"]);
const PORT_TYPES = new Set<WorkflowPort["type"]>(["parts", "string", "json"]);
const LEGACY_PORT_DIRECTIONS = new Map<unknown, WorkflowPort["direction"]>([
  ["input", "in"],
  ["output", "out"],
]);
const LEGACY_PORT_TYPES = new Map<unknown, WorkflowPort["type"]>([
  ["control", "parts"],
  ["event", "parts"],
  ["data", "json"],
]);
const EDGE_KINDS = new Set(["control", "data", "event"]);

function hasOwn(data: Record<string, unknown>, key: string): boolean {
  return HAS_OWN.call(data, key);
}

function readNumberField(
  data: Record<string, unknown>,
  key: string,
): number | undefined {
  return typeof data[key] === "number" ? data[key] : undefined;
}

function readBooleanField(
  data: Record<string, unknown>,
  key: string,
): boolean | undefined {
  return typeof data[key] === "boolean" ? data[key] : undefined;
}

function readStringArrayField(
  data: Record<string, unknown>,
  key: string,
): string[] | undefined {
  if (!Array.isArray(data[key])) {
    return undefined;
  }
  return data[key].filter(
    (value): value is string => typeof value === "string",
  );
}

function readTabLeaderId(
  data: Record<string, unknown>,
): TaskTab["leader_id"] | undefined {
  if (!hasOwn(data, "leader_id")) {
    return undefined;
  }
  return typeof data.leader_id === "string" || data.leader_id === null
    ? (data.leader_id as TaskTab["leader_id"])
    : undefined;
}

function readOptionalCount(
  data: Record<string, unknown>,
  key: "node_count" | "edge_count",
): number | undefined {
  if (!hasOwn(data, key)) {
    return undefined;
  }
  return readNumberField(data, key);
}

function isWorkflowPort(value: unknown): value is WorkflowPort {
  if (!value || typeof value !== "object") {
    return false;
  }
  const port = value as Record<string, unknown>;
  const direction =
    port.direction &&
    PORT_DIRECTIONS.has(port.direction as WorkflowPort["direction"])
      ? port.direction
      : LEGACY_PORT_DIRECTIONS.get(port.direction);
  const type =
    port.type && PORT_TYPES.has(port.type as WorkflowPort["type"])
      ? port.type
      : LEGACY_PORT_TYPES.get(port.kind);
  return (
    typeof port.key === "string" &&
    PORT_DIRECTIONS.has(direction as WorkflowPort["direction"]) &&
    PORT_TYPES.has(type as WorkflowPort["type"]) &&
    typeof port.required === "boolean" &&
    typeof port.multiple === "boolean"
  );
}

function isTabEdge(value: unknown): value is TabEdge {
  if (!value || typeof value !== "object") {
    return false;
  }
  const edge = value as Record<string, unknown>;
  return (
    typeof edge.id === "string" &&
    typeof edge.from_node_id === "string" &&
    typeof edge.from_port_key === "string" &&
    typeof edge.to_node_id === "string" &&
    typeof edge.to_port_key === "string" &&
    (edge.kind === undefined || EDGE_KINDS.has(edge.kind as string))
  );
}

function isWorkflowNodeDefinition(
  value: unknown,
): value is WorkflowNodeDefinition {
  if (!value || typeof value !== "object") {
    return false;
  }
  const node = value as Record<string, unknown>;
  return (
    typeof node.id === "string" &&
    WORKFLOW_NODE_TYPES.has(node.type as WorkflowNodeType) &&
    typeof node.config === "object" &&
    node.config !== null &&
    Array.isArray(node.inputs) &&
    node.inputs.every(isWorkflowPort) &&
    Array.isArray(node.outputs) &&
    node.outputs.every(isWorkflowPort)
  );
}

function isWorkflowView(value: unknown): value is WorkflowView {
  if (!value || typeof value !== "object") {
    return false;
  }
  const view = value as Record<string, unknown>;
  if (view.positions === undefined) {
    return true;
  }
  if (!view.positions || typeof view.positions !== "object") {
    return false;
  }
  return Object.values(view.positions).every(
    (position) =>
      !!position &&
      typeof position === "object" &&
      typeof (position as { x?: unknown }).x === "number" &&
      typeof (position as { y?: unknown }).y === "number",
  );
}

function isWorkflowDefinition(value: unknown): value is WorkflowDefinition {
  if (!value || typeof value !== "object") {
    return false;
  }
  const definition = value as Record<string, unknown>;
  return (
    typeof definition.version === "number" &&
    Array.isArray(definition.nodes) &&
    definition.nodes.every(isWorkflowNodeDefinition) &&
    Array.isArray(definition.edges) &&
    definition.edges.every(isTabEdge) &&
    (definition.view === undefined || isWorkflowView(definition.view))
  );
}

export const EMPTY_WORKFLOW_DEFINITION: WorkflowDefinition = {
  version: 1,
  nodes: [],
  edges: [],
  view: {},
};

export function getTabEventId(data: AgentEvent["data"]): string | null {
  return typeof data.id === "string" ? data.id : null;
}

export function createTaskTabFromEvent(
  data: AgentEvent["data"],
  now = Date.now(),
): TaskTab | null {
  const id = getTabEventId(data);
  if (id === null || typeof data.title !== "string") {
    return null;
  }

  return {
    id,
    title: data.title,
    leader_id: readTabLeaderId(data) ?? null,
    created_at: readNumberField(data, "created_at") ?? now,
    updated_at: readNumberField(data, "updated_at") ?? now,
    definition: isWorkflowDefinition(data.definition)
      ? data.definition
      : EMPTY_WORKFLOW_DEFINITION,
    allow_network: readBooleanField(data, "allow_network") ?? false,
    write_dirs: readStringArrayField(data, "write_dirs") ?? [],
    node_count: readOptionalCount(data, "node_count"),
    edge_count: readOptionalCount(data, "edge_count"),
  };
}

export function mergeTaskTabUpdate(
  current: TaskTab | undefined,
  data: AgentEvent["data"],
  now = Date.now(),
): TaskTab | null {
  if (!current) {
    return createTaskTabFromEvent(data, now);
  }

  const nextLeaderId = readTabLeaderId(data);
  const nextWriteDirs = readStringArrayField(data, "write_dirs");

  return {
    ...current,
    title: typeof data.title === "string" ? data.title : current.title,
    leader_id:
      hasOwn(data, "leader_id") && nextLeaderId !== undefined
        ? nextLeaderId
        : current.leader_id,
    created_at: readNumberField(data, "created_at") ?? current.created_at,
    updated_at: readNumberField(data, "updated_at") ?? current.updated_at,
    allow_network: hasOwn(data, "allow_network")
      ? (readBooleanField(data, "allow_network") ?? current.allow_network)
      : current.allow_network,
    write_dirs:
      hasOwn(data, "write_dirs") && nextWriteDirs !== undefined
        ? nextWriteDirs
        : current.write_dirs,
    definition:
      hasOwn(data, "definition") && isWorkflowDefinition(data.definition)
        ? data.definition
        : current.definition,
    node_count: hasOwn(data, "node_count")
      ? readOptionalCount(data, "node_count")
      : current.node_count,
    edge_count: hasOwn(data, "edge_count")
      ? readOptionalCount(data, "edge_count")
      : current.edge_count,
  };
}

export function getDeletedTabNodeIds(
  data: AgentEvent["data"],
  nodes: ReadonlyMap<string, Pick<Node, "tab_id">>,
): Set<string> {
  const removedNodeIds = Array.isArray(data.removed_node_ids)
    ? data.removed_node_ids.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const removedNodeIdSet = new Set(removedNodeIds);
  const deletedTabId = getTabEventId(data);
  if (deletedTabId === null) {
    return removedNodeIdSet;
  }

  for (const [nodeId, node] of nodes.entries()) {
    if (node.tab_id === deletedTabId) {
      removedNodeIdSet.add(nodeId);
    }
  }

  return removedNodeIdSet;
}
