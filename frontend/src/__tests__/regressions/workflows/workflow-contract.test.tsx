import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ComponentType, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "@/App";

type FlowNode = {
  data: Record<string, unknown>;
  id: string;
  position: { x: number; y: number };
  type?: string;
};

type FlowEdge = {
  id: string;
  source: string;
  sourceHandle?: string;
  target: string;
  targetHandle?: string;
};

type NodeChange = {
  dragging?: boolean;
  id: string;
  position: { x: number; y: number };
  type: "position";
};

type EdgeChange = {
  id: string;
  type: "remove" | "select";
};

type NodeRenderer = ComponentType<{
  data: Record<string, unknown>;
  selected: boolean;
}>;

type ReactFlowMockProps = {
  children?: ReactNode;
  edges: FlowEdge[];
  nodes: FlowNode[];
  nodeTypes?: Record<string, NodeRenderer>;
  onNodesChange?: (changes: NodeChange[]) => void;
};

type ApiWorkflow = {
  active_revision: number;
  created_at: number;
  id: string;
  name: string;
  presentation: {
    connections: Record<string, { label: string }>;
    nodes: Record<
      string,
      {
        description: string;
        name: string;
        position: { x: number; y: number };
      }
    >;
  };
  revision: number;
  spec: {
    connections: Array<{
      from: { node_id: string; port: "output" };
      id: string;
      to: { node_id: string; port: "input" };
    }>;
    nodes: Array<{
      config: Record<string, unknown>;
      id: string;
      kind: "input" | "output";
    }>;
  };
  updated_at: number;
};

type SaveWorkflowBody = {
  base_revision: number;
  workflow: ApiWorkflow;
};

const { reactFlowRenderMock } = vi.hoisted(() => ({
  reactFlowRenderMock: vi.fn(),
}));

vi.mock("@xyflow/react", async () => {
  const React = await import("react");
  return {
    Background: () => <div data-testid="workflow-background" />,
    BackgroundVariant: { Cross: "cross", Dots: "dots", Lines: "lines" },
    Handle: ({ id, type }: { id: string; type: string }) => (
      <span data-testid={`workflow-handle-${type}-${id}`} />
    ),
    MarkerType: { ArrowClosed: "arrowclosed" },
    Position: {
      Bottom: "bottom",
      Left: "left",
      Right: "right",
      Top: "top",
    },
    ReactFlow: ({
      children,
      edges,
      nodes,
      nodeTypes,
      onNodesChange,
    }: ReactFlowMockProps) => {
      reactFlowRenderMock({ edges, nodes });
      return (
        <div data-testid="workflow-flow">
          {nodes.map((node) => {
            const NodeComponent = nodeTypes?.[node.type ?? ""];
            return (
              <div key={node.id}>
                <button
                  data-testid={`workflow-node-${node.id}`}
                  onDoubleClick={() => {
                    onNodesChange?.([
                      {
                        dragging: false,
                        id: node.id,
                        position: { x: 481.4, y: 159.6 },
                        type: "position",
                      },
                    ]);
                  }}
                  type="button"
                >
                  {String(node.data.label)}
                </button>
                {NodeComponent ? (
                  <NodeComponent data={node.data} selected={false} />
                ) : null}
              </div>
            );
          })}
          {edges.map((edge) => (
            <span data-testid={`workflow-edge-${edge.id}`} key={edge.id}>
              {`${edge.source}:${edge.sourceHandle}->${edge.target}:${edge.targetHandle}`}
            </span>
          ))}
          {children}
        </div>
      );
    },
    ReactFlowProvider: ({ children }: { children: ReactNode }) => children,
    addEdge: (edge: FlowEdge, edges: FlowEdge[]) => [...edges, edge],
    applyEdgeChanges: (changes: EdgeChange[], edges: FlowEdge[]) =>
      edges.filter(
        (edge) =>
          !changes.some(
            (change) => change.type === "remove" && change.id === edge.id,
          ),
      ),
    applyNodeChanges: (changes: NodeChange[], nodes: FlowNode[]) =>
      nodes.map((node) => {
        const positionChange = changes.find(
          (change) => change.type === "position" && change.id === node.id,
        );
        return positionChange
          ? { ...node, position: positionChange.position }
          : node;
      }),
    useEdgesState: (initialEdges: FlowEdge[]) => {
      const [edges, setEdges] = React.useState(initialEdges);
      return [edges, setEdges];
    },
    useNodesState: (initialNodes: FlowNode[]) => {
      const [nodes, setNodes] = React.useState(initialNodes);
      return [nodes, setNodes];
    },
    useReactFlow: () => ({
      fitView: vi.fn(),
      screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
    }),
  };
});

const connectedWorkflow = (
  updates: Partial<ApiWorkflow> = {},
): ApiWorkflow => ({
  active_revision: 7,
  created_at: 1_710_000_020,
  id: "connected-workflow",
  name: "Connected Workflow",
  presentation: {
    connections: { "edge-1": { label: "" } },
    nodes: {
      input: {
        description: "",
        name: "Input",
        position: { x: 0, y: 0 },
      },
      output: {
        description: "",
        name: "Output",
        position: { x: 260, y: 0 },
      },
    },
  },
  revision: 7,
  spec: {
    connections: [
      {
        from: { node_id: "input", port: "output" },
        id: "edge-1",
        to: { node_id: "output", port: "input" },
      },
    ],
    nodes: [
      {
        config: { default_value: "" },
        id: "input",
        kind: "input",
      },
      {
        config: { output_key: "final_result" },
        id: "output",
        kind: "output",
      },
    ],
  },
  updated_at: 1_710_000_030,
  ...updates,
});

const appState = (workflow: ApiWorkflow) => ({
  mcp_servers: [],
  messages: [],
  providers: [],
  settings: {
    reasoning_effort: "default",
    selected_model: "",
    selected_provider_id: "",
  },
  skills: [],
  telegram_bot: {
    enabled: false,
    error: "",
    has_bot_token: false,
    sessions: [],
    status: "disabled",
  },
  workflows: [workflow],
});

const jsonResponse = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
    status,
  });

const mockWorkflowApi = (
  workflow: ApiWorkflow,
  save: (body: SaveWorkflowBody) => Response,
) =>
  vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
    if (input === "/api/state") {
      return jsonResponse(appState(workflow));
    }
    if (input === "/api/about") {
      return jsonResponse({});
    }
    if (input === "/api/workflows" && init?.method === "PUT") {
      return save(JSON.parse(String(init.body)) as SaveWorkflowBody);
    }
    return jsonResponse({});
  });

describe("workflow JSON contract regressions", () => {
  beforeEach(() => {
    reactFlowRenderMock.mockClear();
    window.history.replaceState(null, "", "/workflows/connected-workflow");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reopens agent-created connections with canonical handles and saves the same ports", async () => {
    const workflow = connectedWorkflow();
    const saveBodies: SaveWorkflowBody[] = [];
    mockWorkflowApi(workflow, (body) => {
      saveBodies.push(body);
      return jsonResponse({
        ...body.workflow,
        active_revision: 8,
        revision: 8,
      });
    });

    render(<App />);

    expect(await screen.findByTestId("workflow-edge-edge-1")).toHaveTextContent(
      "input:output->output:input",
    );
    expect(screen.getByTestId("workflow-handle-source-output")).toBeVisible();
    expect(screen.getByTestId("workflow-handle-target-input")).toBeVisible();

    const user = userEvent.setup();
    await user.dblClick(screen.getByTestId("workflow-node-input"));

    await waitFor(
      () => {
        expect(saveBodies).toHaveLength(1);
      },
      { timeout: 2_000 },
    );
    expect(saveBodies[0]).toMatchObject({
      base_revision: 7,
      workflow: {
        id: "connected-workflow",
        presentation: {
          connections: { "edge-1": { label: "" } },
          nodes: {
            input: { position: { x: 480, y: 160 } },
          },
        },
        spec: {
          connections: [
            {
              from: { node_id: "input", port: "output" },
              id: "edge-1",
              to: { node_id: "output", port: "input" },
            },
          ],
        },
      },
    });
    expect(saveBodies[0].workflow).not.toHaveProperty("definition");
  });

  it("loads the newer server revision and explains a save conflict", async () => {
    const workflow = connectedWorkflow();
    const latestWorkflow = connectedWorkflow({
      active_revision: 8,
      presentation: {
        ...workflow.presentation,
        nodes: {
          ...workflow.presentation.nodes,
          input: {
            description: "Updated in another session",
            name: "Latest Input",
            position: { x: 700, y: 340 },
          },
        },
      },
      revision: 8,
      updated_at: 1_710_000_040,
    });
    const saveBodies: SaveWorkflowBody[] = [];
    const conflictMessage =
      "This workflow changed elsewhere. The latest version is now open.";
    mockWorkflowApi(workflow, (body) => {
      saveBodies.push(body);
      return jsonResponse(
        { detail: conflictMessage, workflow: latestWorkflow },
        409,
      );
    });

    render(<App />);

    const user = userEvent.setup();
    await user.dblClick(await screen.findByTestId("workflow-node-input"));

    expect(await screen.findByRole("alert")).toHaveTextContent(conflictMessage);
    await waitFor(() => {
      expect(screen.getByTestId("workflow-node-input")).toHaveTextContent(
        "Latest Input",
      );
      expect(
        reactFlowRenderMock.mock.calls.some(([rendered]) => {
          const inputNode = rendered.nodes.find(
            (node: FlowNode) => node.id === "input",
          );
          return inputNode?.position.x === 700 && inputNode.position.y === 340;
        }),
      ).toBe(true);
    });
    expect(saveBodies).toHaveLength(1);
    expect(saveBodies[0].base_revision).toBe(7);
  });
});
