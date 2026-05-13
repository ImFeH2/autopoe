import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTabGraphHistory } from "@/hooks/useTabGraphHistory";
import type { Node, TabEdge } from "@/types";

const {
  createTabEdgeRequestMock,
  createTabNodeRequestMock,
  deleteTabNodeRequestMock,
} = vi.hoisted(() => ({
  createTabEdgeRequestMock: vi.fn(),
  createTabNodeRequestMock: vi.fn(),
  deleteTabNodeRequestMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  createTabEdgeRequest: (...args: unknown[]) =>
    createTabEdgeRequestMock(...args),
  createTabNodeRequest: (...args: unknown[]) =>
    createTabNodeRequestMock(...args),
  deleteTabEdgeRequest: vi.fn(),
  deleteTabNodeRequest: (...args: unknown[]) =>
    deleteTabNodeRequestMock(...args),
}));

function buildNode(overrides: Partial<Node> & Pick<Node, "id">): Node {
  return {
    id: overrides.id,
    node_type: overrides.node_type ?? "agent",
    tab_id: "tab-1",
    is_leader: false,
    state: "idle",
    connections: overrides.connections ?? [],
    name: overrides.name ?? null,
    todos: [],
    role_name: overrides.role_name ?? null,
    config: overrides.config,
    inputs: overrides.inputs,
    outputs: overrides.outputs,
  };
}

describe("useTabGraphHistory", () => {
  beforeEach(() => {
    createTabEdgeRequestMock.mockReset();
    createTabNodeRequestMock.mockReset();
    deleteTabNodeRequestMock.mockReset();
  });

  it("restores deleted non-agent node config and port edges on undo", async () => {
    const modelNode = buildNode({
      id: "model-1",
      node_type: "llm",
      name: "Summarizer",
      config: {
        model: { provider_id: "provider-1", model: "gpt-5" },
        name: "Summarizer",
        response_format: { kind: "text" },
      },
    });
    const edges: TabEdge[] = [
      {
        id: "trigger-to-model",
        from_node_id: "trigger-1",
        from_port_key: "out",
        to_node_id: "model-1",
        to_port_key: "in",
      },
      {
        id: "model-to-code",
        from_node_id: "model-1",
        from_port_key: "out",
        to_node_id: "code-1",
        to_port_key: "source",
      },
    ];
    createTabNodeRequestMock.mockResolvedValue({ id: "model-2" });
    createTabEdgeRequestMock.mockResolvedValue({ id: "restored-edge" });
    deleteTabNodeRequestMock.mockResolvedValue(undefined);

    const { result } = renderHook(() => useTabGraphHistory());

    await act(async () => {
      await result.current.deleteAgent({
        tabId: "tab-1",
        node: modelNode,
        edges,
      });
    });
    await act(async () => {
      await result.current.undo("tab-1");
    });

    expect(deleteTabNodeRequestMock).toHaveBeenCalledWith("tab-1", "model-1");
    expect(createTabNodeRequestMock).toHaveBeenCalledWith("tab-1", {
      node_type: "llm",
      role_name: undefined,
      name: undefined,
      config: modelNode.config,
    });
    expect(createTabEdgeRequestMock).toHaveBeenCalledWith("tab-1", {
      fromNodeId: "trigger-1",
      fromPortKey: "out",
      toNodeId: "model-2",
      toPortKey: "in",
    });
    expect(createTabEdgeRequestMock).toHaveBeenCalledWith("tab-1", {
      fromNodeId: "model-2",
      fromPortKey: "out",
      toNodeId: "code-1",
      toPortKey: "source",
    });
  });
});
