import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "@/App";

type FlowNode = {
  data: Record<string, unknown>;
  id: string;
  position: { x: number; y: number };
  type?: string;
};

type FlowEdge = {
  data?: Record<string, unknown>;
  id: string;
  label?: string;
  markerEnd?: Record<string, unknown>;
  source: string;
  sourceHandle?: string;
  target: string;
  targetHandle?: string;
};

type NodeChange =
  | {
      dragging?: boolean;
      id: string;
      position: { x: number; y: number };
      type: "position";
    }
  | {
      id: string;
      type: "remove" | "select";
    };

type EdgeChange = {
  id: string;
  type: "remove" | "select";
};

type ReactFlowMockProps = {
  children?: ReactNode;
  edges: FlowEdge[];
  nodes: FlowNode[];
  onNodesChange?: (changes: NodeChange[]) => void;
  snapGrid?: [number, number];
  snapToGrid?: boolean;
};

const { reactFlowRenderMock, workflowBackgroundRenderMock } = vi.hoisted(
  () => ({
    reactFlowRenderMock: vi.fn(),
    workflowBackgroundRenderMock: vi.fn(),
  }),
);

vi.mock("@xyflow/react", async () => {
  const React = await import("react");
  return {
    Background: (props: Record<string, unknown>) => {
      workflowBackgroundRenderMock(props);
      return <div data-testid="workflow-background" />;
    },
    BackgroundVariant: { Cross: "cross", Dots: "dots", Lines: "lines" },
    Handle: () => <span data-testid="workflow-handle" />,
    MarkerType: { ArrowClosed: "arrowclosed" },
    Position: { Bottom: "bottom", Top: "top" },
    ReactFlow: ({
      children,
      edges,
      nodes,
      onNodesChange,
      snapGrid,
      snapToGrid,
    }: ReactFlowMockProps) => {
      reactFlowRenderMock({ edges, nodes, snapGrid, snapToGrid });
      return (
        <div data-testid="workflow-flow">
          {nodes.map((node) => (
            <button
              data-testid={`workflow-node-${node.id}`}
              key={node.id}
              onClick={() => {
                onNodesChange?.([
                  {
                    dragging: true,
                    id: node.id,
                    position: { x: 481.4, y: 159.6 },
                    type: "position",
                  },
                ]);
              }}
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
      nodes
        .filter(
          (node) =>
            !changes.some(
              (change) => change.type === "remove" && change.id === node.id,
            ),
        )
        .map((node) => {
          const positionChange = changes.find(
            (change) => change.type === "position" && change.id === node.id,
          );
          return positionChange?.type === "position"
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

const singleInputWorkflow = () => ({
  created_at: 1710000020,
  definition: {
    edges: [],
    nodes: [
      {
        data: { default_value: "", input_type: "text" },
        description: "",
        id: "input",
        name: "Input",
        position: { x: 0, y: 0 },
        type: "input",
      },
    ],
    version: 1,
  },
  id: "workflow-draft",
  name: "Draft Workflow",
  updated_at: 1710000030,
});

const selectedProviderState = () => ({
  mcp_servers: [],
  messages: [],
  providers: [
    {
      api_key: "sk-local",
      base_url: "",
      id: "provider-openai",
      models: ["gpt-5.1"],
      name: "OpenAI",
      type: "openai",
    },
  ],
  settings: {
    reasoning_effort: "default",
    selected_model: "gpt-5.1",
    selected_provider_id: "provider-openai",
  },
  skills: [],
  telegram_bot: {
    bot_token: "",
    enabled: false,
    error: "",
    sessions: [],
    status: "disabled",
  },
  workflows: [singleInputWorkflow()],
});

const mockAppFetch = (
  handler?: (input: RequestInfo | URL, init?: RequestInit) => Response | null,
) => {
  vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
    const handledResponse = handler?.(input, init);
    if (handledResponse) {
      return handledResponse;
    }
    if (input === "/api/state") {
      return new Response(JSON.stringify(selectedProviderState()), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }
    if (input === "/api/about") {
      return new Response(JSON.stringify({}), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }
    return new Response(JSON.stringify({}), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  });
};

describe("workflow save regressions", () => {
  beforeEach(() => {
    reactFlowRenderMock.mockClear();
    workflowBackgroundRenderMock.mockClear();
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the specific run problem for a saved incomplete workflow draft", async () => {
    const user = userEvent.setup();
    mockAppFetch((input, init) => {
      if (input === "/api/workflows" && init?.method === "PUT") {
        return new Response(String(init.body), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (
        typeof input === "string" &&
        input === "/api/workflows/workflow-draft/run" &&
        init?.method === "POST"
      ) {
        return new Response(
          JSON.stringify({ detail: "Workflow needs an output node." }),
          {
            headers: { "Content-Type": "application/json" },
            status: 400,
          },
        );
      }
      return null;
    });

    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: "Draft Workflow" }),
    );
    await user.click(screen.getByRole("button", { name: "Run" }));

    expect(
      await screen.findByText("Workflow needs an output node."),
    ).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("Run could not be completed.");
  });

  it("keeps node movement local while dragging and saves the dropped position", async () => {
    const user = userEvent.setup();
    const saveBodies: unknown[] = [];
    mockAppFetch((input, init) => {
      if (input === "/api/workflows" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body));
        saveBodies.push(body);
        return new Response(JSON.stringify(body), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      return null;
    });

    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: "Draft Workflow" }),
    );
    await user.click(screen.getByTestId("workflow-node-input"));

    expect(screen.queryByText("Unsaved")).not.toBeInTheDocument();
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save" }),
    ).not.toBeInTheDocument();
    expect(
      workflowBackgroundRenderMock.mock.calls.some(([props]) => {
        return props.gap === 20 && props.variant === "lines";
      }),
    ).toBe(true);
    expect(
      reactFlowRenderMock.mock.calls.some(([rendered]) => {
        return (
          rendered.snapToGrid === true &&
          rendered.snapGrid[0] === 20 &&
          rendered.snapGrid[1] === 20
        );
      }),
    ).toBe(true);
    expect(saveBodies).toHaveLength(0);
    expect(
      reactFlowRenderMock.mock.calls.some(([rendered]) => {
        const inputNode = rendered.nodes.find(
          (node: FlowNode) => node.id === "input",
        );
        return inputNode?.position.x === 480 && inputNode.position.y === 160;
      }),
    ).toBe(true);

    await user.dblClick(screen.getByTestId("workflow-node-input"));

    await waitFor(
      () => {
        expect(saveBodies).toHaveLength(1);
      },
      { timeout: 2000 },
    );
    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(saveBodies[0]).toEqual(
      expect.objectContaining({
        definition: expect.objectContaining({
          nodes: [
            expect.objectContaining({
              id: "input",
              position: { x: 480, y: 160 },
            }),
          ],
        }),
      }),
    );
  });

  it("does not run a workflow when it could not be saved first", async () => {
    const user = userEvent.setup();
    const runRequests: string[] = [];
    mockAppFetch((input, init) => {
      if (input === "/api/workflows" && init?.method === "PUT") {
        return new Response(
          JSON.stringify({ detail: "Workflow could not be saved." }),
          {
            headers: { "Content-Type": "application/json" },
            status: 400,
          },
        );
      }
      if (
        typeof input === "string" &&
        input === "/api/workflows/workflow-draft/run" &&
        init?.method === "POST"
      ) {
        runRequests.push(input);
      }
      return null;
    });
    window.history.replaceState(null, "", "/workflows");

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Run" }));

    expect(await screen.findByText("Could not save")).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Workflow could not be saved.",
    );
    expect(runRequests).toHaveLength(0);
  });

  it("reopens the selected workflow after a page refresh", async () => {
    mockAppFetch();
    window.history.replaceState(null, "", "/workflows/workflow-draft");

    render(<App />);

    expect(screen.queryByRole("textbox", { name: "Workflow name" })).toBeNull();
    expect(await screen.findByRole("button", { name: "Run" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Workflows" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("button", { name: "Draft Workflow" })).toHaveClass(
      "bg-[#202020]",
    );
  });

  it("syncs workflow navigation with browser history", async () => {
    const user = userEvent.setup();
    mockAppFetch();

    render(<App />);

    expect(
      await screen.findByRole("tab", { name: "Workspace" }),
    ).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByRole("button", { name: "Draft Workflow" }));

    await waitFor(() => {
      expect(window.location.pathname).toBe("/workflows/workflow-draft");
    });
    expect(screen.getByRole("tab", { name: "Workflows" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.queryByRole("textbox", { name: "Workflow name" })).toBeNull();
    expect(screen.getByRole("button", { name: "Run" })).toBeVisible();

    window.history.back();
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Workspace" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });
  });
});
