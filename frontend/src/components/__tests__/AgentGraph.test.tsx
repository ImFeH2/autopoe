import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Edge as FlowEdge, Node as FlowNode } from "@xyflow/react";
import { AgentGraph, type AgentGraphHandle } from "@/components/AgentGraph";
import { getAgentGraphLayoutedElements } from "@/lib/agentGraphLayout";
import type { Node, Role, TaskTab, WorkflowDefinition } from "@/types";

const fitViewMock = vi.fn().mockResolvedValue(true);
const getZoomMock = vi.fn(() => 1);
const useAgentNodesRuntimeMock = vi.fn();
const useAgentTabsRuntimeMock = vi.fn();
const useAgentActivityRuntimeMock = vi.fn();
const useAgentUIMock = vi.fn();
const reactFlowPropsMock = vi.fn();
const resizeObservers: ResizeObserverMock[] = [];
const defaultWorker = globalThis.Worker;

class DeferredWorkerMock {
  static instances: DeferredWorkerMock[] = [];
  onmessage: ((ev: MessageEvent) => void) | null = null;
  messages: Array<{ nodes: FlowNode[]; edges: FlowEdge[]; key: string }> = [];

  constructor() {
    DeferredWorkerMock.instances.push(this);
  }

  postMessage(data: { nodes: FlowNode[]; edges: FlowEdge[]; key: string }) {
    this.messages.push(data);
  }

  async flush(index: number) {
    const message = this.messages[index];
    if (!message || !this.onmessage) {
      return;
    }
    const layouted = await getAgentGraphLayoutedElements(
      message.nodes,
      message.edges,
    );
    const positions = layouted.nodes.map((node) => ({
      id: node.id,
      position: node.position,
    }));
    this.onmessage({ data: { positions, key: message.key } } as MessageEvent);
  }

  fail(index: number, error = "layout failed") {
    const message = this.messages[index];
    if (!message || !this.onmessage) {
      return;
    }
    this.onmessage({ data: { key: message.key, error } } as MessageEvent);
  }

  terminate = vi.fn();
}

class ResizeObserverMock {
  callback: ResizeObserverCallback;
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    resizeObservers.push(this);
  }
}

vi.mock("@/context/AgentContext", () => ({
  useAgentNodesRuntime: () => useAgentNodesRuntimeMock(),
  useAgentTabsRuntime: () => useAgentTabsRuntimeMock(),
  useAgentActivityRuntime: () => useAgentActivityRuntimeMock(),
  useAgentUI: () => useAgentUIMock(),
}));

vi.mock("@xyflow/react", async () => {
  const react = await import("react");
  type MockNodeComponentProps = {
    data: Record<string, unknown>;
    id: string;
    dragging: boolean;
    isConnectable: boolean;
    selected: boolean;
    type: string;
    xPos: number;
    yPos: number;
    zIndex: number;
  };

  function ReactFlowMock({
    nodes,
    edges,
    nodeTypes,
    onInit,
    onNodeClick,
    onNodeContextMenu,
    onNodeMouseEnter,
    onNodeMouseMove,
    onNodeMouseLeave,
    onConnect,
    onConnectStart,
    onConnectEnd,
    onMove,
    isValidConnection,
    nodesDraggable,
    nodesConnectable,
    connectionMode,
    connectOnClick,
    minZoom,
    maxZoom,
    zoomOnScroll,
    zoomOnPinch,
    children,
  }: {
    nodes: Array<{
      id: string;
      type: string;
      data: Record<string, unknown>;
      position: { x: number; y: number };
    }>;
    edges: Array<{
      id: string;
      source: string;
      target: string;
      sourceHandle?: string;
      targetHandle?: string;
    }>;
    nodeTypes: Record<string, React.ComponentType<MockNodeComponentProps>>;
    onInit?: (instance: {
      fitView: typeof fitViewMock;
      getZoom: typeof getZoomMock;
    }) => void;
    onNodeClick?: (event: React.MouseEvent, node: { id: string }) => void;
    onNodeContextMenu?: (event: React.MouseEvent, node: { id: string }) => void;
    onNodeMouseEnter?: (event: React.MouseEvent, node: { id: string }) => void;
    onNodeMouseMove?: (event: React.MouseEvent, node: { id: string }) => void;
    onNodeMouseLeave?: (event: React.MouseEvent, node: { id: string }) => void;
    onConnect?: (connection: {
      source: string;
      target: string;
      sourceHandle: string;
      targetHandle: string;
    }) => void;
    onConnectStart?: () => void;
    onConnectEnd?: (...args: unknown[]) => void;
    onMove?: (
      event: MouseEvent | TouchEvent | null,
      viewport: { x: number; y: number; zoom: number },
    ) => void;
    isValidConnection?: (connection: {
      source?: string;
      target?: string;
      sourceHandle?: string;
      targetHandle?: string;
    }) => boolean;
    nodesDraggable?: boolean;
    nodesConnectable?: boolean;
    connectionMode?: string;
    connectOnClick?: boolean;
    minZoom?: number;
    maxZoom?: number;
    zoomOnScroll?: boolean;
    zoomOnPinch?: boolean;
    children?: React.ReactNode;
  }) {
    reactFlowPropsMock({
      nodes,
      edges,
      isValidConnection,
      nodesDraggable,
      nodesConnectable,
      connectionMode,
      connectOnClick,
      minZoom,
      maxZoom,
      zoomOnScroll,
      zoomOnPinch,
    });

    react.useEffect(() => {
      onInit?.({ fitView: fitViewMock, getZoom: getZoomMock });
    }, [onInit]);

    const emitConnection = (sourceIndex: number, targetIndex: number) => {
      const sourceId = nodes[sourceIndex]?.id;
      const targetId = nodes[targetIndex]?.id;
      if (!sourceId || !targetId) {
        return;
      }
      const connection = {
        source: sourceId,
        target: targetId,
        sourceHandle: "out",
        targetHandle: "in",
      };
      if (isValidConnection && !isValidConnection(connection)) {
        return;
      }
      onConnect?.(connection);
    };

    return (
      <div data-testid="react-flow">
        <button
          data-testid="connect-start"
          onClick={() => onConnectStart?.()}
        />
        <button data-testid="connect-end" onClick={() => onConnectEnd?.()} />
        <button
          data-testid="connect-first-to-first"
          onClick={() => emitConnection(0, 0)}
        />
        <button
          data-testid="connect-first-to-second"
          onClick={() => emitConnection(0, 1)}
        />
        <button
          data-testid="connect-first-to-last"
          onClick={() => emitConnection(0, nodes.length - 1)}
        />
        <button
          data-testid="move-zoom-142"
          onClick={() => onMove?.(null, { x: 0, y: 0, zoom: 1.42 })}
        />
        {nodes.map((node) => {
          const Component = nodeTypes[node.type];
          return (
            <div
              key={node.id}
              className="react-flow__node"
              data-testid={`node-${node.id}`}
              onClick={(event) => onNodeClick?.(event, node)}
              onContextMenu={(event) => onNodeContextMenu?.(event, node)}
              onMouseEnter={(event) => onNodeMouseEnter?.(event, node)}
              onMouseMove={(event) => onNodeMouseMove?.(event, node)}
              onMouseLeave={(event) => onNodeMouseLeave?.(event, node)}
            >
              <Component
                data={node.data}
                id={node.id}
                dragging={false}
                isConnectable={false}
                selected={false}
                type={node.type}
                xPos={0}
                yPos={0}
                zIndex={0}
              />
            </div>
          );
        })}
        {children}
      </div>
    );
  }

  return {
    ReactFlow: ReactFlowMock,
    Background: () => null,
    ConnectionMode: {
      Loose: "loose",
      Strict: "strict",
    },
    BaseEdge: ({ id }: { id: string }) => <div data-testid={`edge-${id}`} />,
    Handle: ({
      type,
      position,
      className,
    }: {
      type: string;
      position: string;
      className?: string;
    }) => (
      <div data-testid={`handle-${type}-${position}`} className={className} />
    ),
    Position: {
      Left: "left",
      Right: "right",
      Top: "top",
      Bottom: "bottom",
    },
    getBezierPath: () => ["M0,0 C0,0 0,0 0,0"],
  };
});

function buildNode(overrides: Partial<Node>): Node {
  return {
    id: "node",
    node_type: "agent",
    tab_id: "tab-1",
    is_leader: false,
    state: "idle",
    connections: [],
    name: null,
    todos: [],
    role_name: null,
    ...overrides,
  };
}

function buildDefinition(nodes: Node[]): WorkflowDefinition {
  return {
    version: 1,
    nodes: nodes
      .filter(
        (node) =>
          node.tab_id === "tab-1" &&
          node.node_type !== "assistant" &&
          !node.is_leader,
      )
      .map((node) => ({
        id: node.id,
        type: (node.node_type === "agent"
          ? "agent"
          : node.node_type) as Exclude<Node["node_type"], "assistant">,
        config: {
          ...(node.name ? { name: node.name } : {}),
          ...(node.role_name ? { role_name: node.role_name } : {}),
        },
        inputs: [
          {
            key: "in",
            direction: "in" as const,
            type: "parts" as const,
            required: false,
            multiple: false,
          },
        ],
        outputs: [
          {
            key: "out",
            direction: "out" as const,
            type: "parts" as const,
            required: false,
            multiple: true,
          },
        ],
      })),
    edges: Array.from(
      new Map(
        nodes
          .filter(
            (node) =>
              node.tab_id === "tab-1" &&
              node.node_type !== "assistant" &&
              !node.is_leader,
          )
          .flatMap((node) =>
            node.connections
              .filter((targetId) => targetId !== node.id)
              .map((targetId) => [
                `${node.id}->${targetId}`,
                {
                  id: `${node.id}->${targetId}`,
                  from_node_id: node.id,
                  from_port_key: "out",
                  to_node_id: targetId,
                  to_port_key: "in",
                },
              ]),
          ),
      ).values(),
    ),
  };
}

function buildTab(nodes: Node[], overrides: Partial<TaskTab> = {}): TaskTab {
  return {
    id: "tab-1",
    title: "Research Task",
    leader_id: "leader-1",
    created_at: 1,
    updated_at: 1,
    definition: overrides.definition ?? buildDefinition(nodes),
    ...overrides,
  };
}

function renderGraph(
  nodes: Node[],
  options?: {
    activeTabId?: string | null;
    selectedAgentId?: string | null;
    tabs?: TaskTab[];
    ref?: React.Ref<AgentGraphHandle>;
    roles?: Role[];
    runtimeNodes?: Node[];
    onCreateConnection?: (
      tabId: string,
      sourceNodeId: string,
      targetNodeId: string,
      sourcePortKey?: string,
      targetPortKey?: string,
    ) => Promise<void>;
    onCreateLinkedAgent?: (input: {
      tabId: string;
      anchorNodeId: string;
      roleName: string;
      name?: string;
    }) => Promise<unknown>;
  },
) {
  useAgentNodesRuntimeMock.mockReturnValue({
    agents: new Map(
      (options?.runtimeNodes ?? nodes).map((node) => [node.id, node] as const),
    ),
  });
  useAgentTabsRuntimeMock.mockReturnValue({
    tabs: new Map(
      (options?.tabs ?? [buildTab(nodes)]).map((tab) => [tab.id, tab] as const),
    ),
  });
  useAgentActivityRuntimeMock.mockReturnValue({
    activeMessages: [],
    activeToolCalls: new Map(),
  });
  useAgentUIMock.mockReturnValue({
    activeTabId: options?.activeTabId ?? "tab-1",
    selectedAgentId: options?.selectedAgentId ?? null,
    selectAgent: vi.fn(),
  });

  return render(
    <AgentGraph
      ref={options?.ref}
      onCreateConnection={options?.onCreateConnection}
      onCreateLinkedAgent={options?.onCreateLinkedAgent}
      roles={options?.roles}
    />,
  );
}

function expectConnectionHandlesHidden(node: HTMLElement) {
  for (const handleId of ["handle-target-left", "handle-source-right"]) {
    expect(within(node).getByTestId(handleId)).toHaveClass("!opacity-0");
  }
}

function expectConnectionEntriesVisible(node: HTMLElement) {
  expect(within(node).getByTestId("connection-entry-left")).toBeInTheDocument();
  expect(
    within(node).getByTestId("connection-entry-right"),
  ).toBeInTheDocument();
}

function expectConnectionEntriesHidden(node: HTMLElement) {
  expect(
    within(node).queryByTestId("connection-entry-left"),
  ).not.toBeInTheDocument();
  expect(
    within(node).queryByTestId("connection-entry-right"),
  ).not.toBeInTheDocument();
}

beforeEach(() => {
  fitViewMock.mockClear();
  getZoomMock.mockClear();
  getZoomMock.mockReturnValue(1);
  reactFlowPropsMock.mockClear();
  resizeObservers.splice(0, resizeObservers.length);
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  vi.useRealTimers();
});

afterEach(() => {
  cleanup();
  vi.stubGlobal("Worker", defaultWorker);
  DeferredWorkerMock.instances.splice(0, DeferredWorkerMock.instances.length);
});

describe("AgentGraph", () => {
  it("shows an empty graph background for an active workflow without nodes", () => {
    renderGraph([]);

    expect(screen.getByTestId("react-flow")).toBeInTheDocument();
    expect(
      screen.queryByText("This workflow is ready for its first node"),
    ).not.toBeInTheDocument();
  });

  it("renders workflow nodes from the active tab definition and hides assistants", async () => {
    renderGraph([
      buildNode({
        id: "assistant",
        node_type: "assistant",
        tab_id: null,
      }),
      buildNode({
        id: "worker-1",
        role_name: "Worker",
      }),
    ]);

    expect(await screen.findByText("Worker")).toBeInTheDocument();
    expect(screen.queryByText("Assistant")).not.toBeInTheDocument();

    const workerNode = screen.getByTestId("node-worker-1");
    expectConnectionHandlesHidden(workerNode);
    expectConnectionEntriesHidden(workerNode);
  });

  it("shows connection entries and a connect hint in connect mode", async () => {
    const graphRef = React.createRef<AgentGraphHandle>();

    renderGraph(
      [
        buildNode({
          id: "worker-1",
          role_name: "Planner",
        }),
        buildNode({
          id: "worker-2",
          role_name: "Reviewer",
        }),
      ],
      { ref: graphRef },
    );

    await screen.findByText("Planner");

    act(() => {
      graphRef.current?.enterConnectMode();
    });

    const plannerNode = screen.getByTestId("node-worker-1");
    expectConnectionEntriesVisible(plannerNode);
    expect(screen.getByText("Connect Ports")).toBeInTheDocument();
  });

  it("blocks invalid connections and forwards valid ones with explicit port keys", async () => {
    const onCreateConnection = vi.fn().mockResolvedValue(undefined);

    renderGraph(
      [
        buildNode({
          id: "worker-1",
          role_name: "Planner",
          connections: ["worker-2"],
        }),
        buildNode({
          id: "worker-2",
          role_name: "Reviewer",
        }),
        buildNode({
          id: "worker-3",
          role_name: "Researcher",
        }),
      ],
      { onCreateConnection },
    );

    await screen.findByText("Planner");

    fireEvent.click(screen.getByTestId("connect-first-to-first"));
    fireEvent.click(screen.getByTestId("connect-first-to-second"));

    expect(onCreateConnection).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("connect-first-to-last"));

    await waitFor(() => {
      expect(onCreateConnection).toHaveBeenCalledWith(
        "tab-1",
        "worker-1",
        "worker-3",
        "out",
        "in",
      );
    });
  });

  it("renders workflow edges with strict connection mode and port handles", async () => {
    renderGraph([
      buildNode({
        id: "worker-1",
        role_name: "Planner",
        connections: ["worker-2"],
      }),
      buildNode({
        id: "worker-2",
        role_name: "Reviewer",
      }),
    ]);

    await screen.findByText("Planner");

    await waitFor(() => {
      expect(reactFlowPropsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          edges: expect.arrayContaining([
            expect.objectContaining({
              id: "worker-1->worker-2",
              sourceHandle: "out",
              targetHandle: "in",
            }),
          ]),
          connectionMode: "strict",
          nodesDraggable: false,
          nodesConnectable: true,
          connectOnClick: false,
          minZoom: 0.05,
          maxZoom: 6,
          zoomOnScroll: true,
          zoomOnPinch: true,
        }),
      );
    });
  });

  it("renders only nodes from the active workflow and keeps leaders out of the graph", async () => {
    renderGraph([
      buildNode({
        id: "leader-1",
        role_name: "Conductor",
        is_leader: true,
        name: "Leader",
      }),
      buildNode({
        id: "worker-1",
        role_name: "Planner",
        tab_id: "tab-1",
      }),
      buildNode({
        id: "worker-2",
        role_name: "Reviewer",
        tab_id: "tab-2",
      }),
    ]);

    expect(await screen.findByText("Planner")).toBeInTheDocument();
    expect(screen.queryByText("Leader")).not.toBeInTheDocument();
    expect(screen.queryByText("Reviewer")).not.toBeInTheDocument();
  });

  it("renders node tooltips in a viewport portal instead of inside the canvas", async () => {
    renderGraph([
      buildNode({
        id: "worker-1",
        role_name: "Worker",
      }),
    ]);

    fireEvent.mouseEnter(screen.getByTestId("node-worker-1"), {
      clientX: 240,
      clientY: 180,
    });

    expect(await screen.findByText("Connections")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("react-flow")).queryByText("Connections"),
    ).not.toBeInTheDocument();
  });

  it("shows agent node actions from the right-click menu", async () => {
    const onCreateLinkedAgent = vi.fn().mockResolvedValue("new-worker");

    renderGraph(
      [
        buildNode({
          id: "worker-1",
          role_name: "Planner",
        }),
      ],
      {
        onCreateLinkedAgent,
        roles: [
          {
            name: "Reviewer",
            description: "Checks the work before it is finished.",
            system_prompt: "",
            model: null,
            model_params: null,
            included_tools: [],
            excluded_tools: [],
            is_builtin: true,
          },
          {
            name: "Builder",
            description: "Creates the first draft.",
            system_prompt: "",
            model: null,
            model_params: null,
            included_tools: [],
            excluded_tools: [],
            is_builtin: false,
          },
        ],
      },
    );

    await screen.findByText("Planner");

    fireEvent.contextMenu(screen.getByTestId("node-worker-1"), {
      clientX: 160,
      clientY: 120,
    });

    expect(screen.getByText("Add Agent After")).toBeInTheDocument();
    expect(screen.getByText("Connect to...")).toBeInTheDocument();
    expect(screen.getByText("Delete Node")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Add Agent After"));
    expect(
      await screen.findByRole("dialog", { name: "Add Agent After" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search roles"), {
      target: { value: "review" },
    });
    fireEvent.click(await screen.findByText("Reviewer"));
    fireEvent.change(screen.getByLabelText("Display Name"), {
      target: { value: "Review step" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Agent After" }));

    await waitFor(() => {
      expect(onCreateLinkedAgent).toHaveBeenCalledWith({
        tabId: "tab-1",
        anchorNodeId: "worker-1",
        roleName: "Reviewer",
        name: "Review step",
      });
    });
  });

  it("shows agent node actions when only the workflow definition is loaded", async () => {
    renderGraph(
      [
        buildNode({
          id: "worker-1",
          role_name: "Planner",
        }),
      ],
      { runtimeNodes: [] },
    );

    await screen.findByText("Planner");

    fireEvent.contextMenu(screen.getByTestId("node-worker-1"), {
      clientX: 160,
      clientY: 120,
    });

    expect(screen.getByText("Add Agent After")).toBeInTheDocument();
    expect(screen.getByText("Connect to...")).toBeInTheDocument();
    expect(screen.getByText("Delete Node")).toBeInTheDocument();
  });

  it("re-fits the graph when the container is resized", async () => {
    renderGraph([
      buildNode({
        id: "worker-1",
        role_name: "Worker",
      }),
    ]);

    await waitFor(() => {
      expect(fitViewMock).toHaveBeenCalled();
      expect(resizeObservers).toHaveLength(1);
    });

    fitViewMock.mockClear();

    await act(async () => {
      resizeObservers[0]?.callback(
        [],
        resizeObservers[0] as unknown as ResizeObserver,
      );
    });

    await waitFor(() => {
      expect(fitViewMock).toHaveBeenCalledWith({
        padding: 0.3,
        maxZoom: 1,
        duration: 250,
      });
    });
  });

  it("shows the viewport zoom while a graph is visible and updates it live", async () => {
    renderGraph([
      buildNode({
        id: "worker-1",
        role_name: "Worker",
      }),
    ]);

    expect(
      await screen.findByTestId("agent-graph-zoom-indicator"),
    ).toHaveTextContent("100%");

    fireEvent.click(screen.getByTestId("move-zoom-142"));

    expect(screen.getByTestId("agent-graph-zoom-indicator")).toHaveTextContent(
      "142%",
    );
  });

  it("lays out nodes from graph structure instead of stored runtime positions", async () => {
    vi.stubGlobal("Worker", DeferredWorkerMock as unknown as typeof Worker);

    renderGraph([
      buildNode({
        id: "worker-1",
        role_name: "Planner",
        position: { x: 900, y: 700 },
        connections: ["worker-2"],
      }),
      buildNode({
        id: "worker-2",
        role_name: "Reviewer",
        position: { x: 40, y: 20 },
      }),
    ]);

    await screen.findByText("Planner");
    const worker = DeferredWorkerMock.instances[0];
    expect(worker?.messages).toHaveLength(1);

    await act(async () => {
      await worker?.flush(0);
    });

    await waitFor(() => {
      const latestProps = reactFlowPropsMock.mock.calls.at(-1)?.[0] as
        | {
            nodes: Array<{ id: string; position: { x: number; y: number } }>;
          }
        | undefined;
      const plannerNode = latestProps?.nodes.find(
        (node) => node.id === "worker-1",
      );
      const reviewerNode = latestProps?.nodes.find(
        (node) => node.id === "worker-2",
      );

      expect(plannerNode?.position).not.toEqual({ x: 900, y: 700 });
      expect(reviewerNode?.position).not.toEqual({ x: 40, y: 20 });
    });
  });

  it("retries a failed layout request once for the same structure", async () => {
    vi.stubGlobal("Worker", DeferredWorkerMock as unknown as typeof Worker);
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    renderGraph([
      buildNode({
        id: "worker-1",
        role_name: "Planner",
        connections: ["worker-2"],
      }),
      buildNode({
        id: "worker-2",
        role_name: "Reviewer",
      }),
    ]);

    await screen.findByText("Planner");

    const worker = DeferredWorkerMock.instances[0];
    expect(worker?.messages).toHaveLength(1);

    act(() => {
      worker?.fail(0);
    });

    await waitFor(() => {
      expect(worker?.messages).toHaveLength(2);
    });

    consoleErrorSpy.mockRestore();
  });
});
