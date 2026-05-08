import { describe, expect, it } from "vitest";
import {
  createTaskTabFromEvent,
  getDeletedTabNodeIds,
  mergeTaskTabUpdate,
} from "@/lib/tabEvents";
import type { AgentEvent, Node, TaskTab } from "@/types";

function buildTab(overrides: Partial<TaskTab> = {}): TaskTab {
  return {
    id: overrides.id ?? "tab-1",
    title: overrides.title ?? "Execution",
    leader_id: overrides.leader_id ?? "leader-1",
    created_at: overrides.created_at ?? 1,
    updated_at: overrides.updated_at ?? 2,
    definition: overrides.definition ?? { version: 1, nodes: [], edges: [] },
    allow_network: overrides.allow_network ?? false,
    write_dirs: overrides.write_dirs ?? [],
    node_count: overrides.node_count ?? 3,
    edge_count: overrides.edge_count ?? 2,
  };
}

function buildNode(overrides: Partial<Node> & Pick<Node, "id">): Node {
  return {
    id: overrides.id,
    node_type: overrides.node_type ?? "agent",
    tab_id: overrides.tab_id ?? null,
    is_leader: overrides.is_leader ?? false,
    state: overrides.state ?? "idle",
    connections: overrides.connections ?? [],
    name: overrides.name ?? null,
    todos: overrides.todos ?? [],
    role_name: overrides.role_name ?? "Worker",
    position: overrides.position ?? null,
  };
}

describe("tabEvents", () => {
  it("merges tab updates incrementally instead of rebuilding missing fields", () => {
    const current = buildTab();

    expect(
      mergeTaskTabUpdate(current, {
        id: current.id,
        title: "Ship review fixes",
        updated_at: 10,
      }),
    ).toEqual({
      ...current,
      title: "Ship review fixes",
      updated_at: 10,
    });
  });

  it("supports explicit nullable updates for leader and aggregate counts", () => {
    const current = buildTab();

    expect(
      mergeTaskTabUpdate(current, {
        id: current.id,
        leader_id: null,
        node_count: null,
        edge_count: null,
      }),
    ).toEqual({
      ...current,
      leader_id: null,
      node_count: undefined,
      edge_count: undefined,
    });
  });

  it("merges workflow permissions from partial tab updates", () => {
    const current = buildTab();

    expect(
      mergeTaskTabUpdate(current, {
        id: current.id,
        allow_network: true,
        write_dirs: ["/workspace/out"],
      }),
    ).toEqual({
      ...current,
      allow_network: true,
      write_dirs: ["/workspace/out"],
    });
  });

  it("creates a tab only when the event has the required fields", () => {
    expect(
      createTaskTabFromEvent({
        id: "tab-2",
        title: "Inspect",
      }),
    ).toMatchObject({
      id: "tab-2",
      title: "Inspect",
      leader_id: null,
    });

    expect(
      createTaskTabFromEvent({
        id: "tab-2",
      }),
    ).toBeNull();
  });

  it("unions explicit removed node ids with nodes that still belong to the deleted tab", () => {
    const eventData: AgentEvent["data"] = {
      id: "tab-1",
      removed_node_ids: ["node-a"],
    };
    const nodes = new Map<string, Node>([
      ["node-a", buildNode({ id: "node-a", tab_id: "tab-1" })],
      ["node-b", buildNode({ id: "node-b", tab_id: "tab-1" })],
      ["node-c", buildNode({ id: "node-c", tab_id: "tab-2" })],
    ]);

    expect(Array.from(getDeletedTabNodeIds(eventData, nodes)).sort()).toEqual([
      "node-a",
      "node-b",
    ]);
  });
});
