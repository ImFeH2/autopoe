import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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
  id: string;
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
};

type ApiWorkflow = {
  active_revision: number | null;
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

type WorkflowDraft = Pick<ApiWorkflow, "id" | "name" | "presentation" | "spec">;

type SaveWorkflowBody = {
  base_revision: number | null;
  workflow: WorkflowDraft;
};

type FetchHandler = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response> | Response | null;

const { reactFlowRenderMock } = vi.hoisted(() => ({
  reactFlowRenderMock: vi.fn(),
}));

vi.mock("@xyflow/react", async () => {
  const React = await import("react");
  return {
    Background: () => <div data-testid="workflow-background" />,
    BackgroundVariant: { Cross: "cross", Dots: "dots", Lines: "lines" },
    Handle: () => <span />,
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
      onNodesChange,
    }: ReactFlowMockProps) => {
      reactFlowRenderMock({ edges, nodes });
      return (
        <div data-testid="workflow-flow">
          {nodes.map((node) => (
            <button
              data-position-x={node.position.x}
              data-testid={`workflow-node-${node.id}`}
              key={node.id}
              onDoubleClick={() => {
                onNodesChange?.([
                  {
                    dragging: false,
                    id: node.id,
                    position: {
                      x: node.position.x + 100,
                      y: node.position.y,
                    },
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

const workflowFixture = ({
  activeRevision = 1,
  id,
  name,
  revision = 1,
  withOutput = true,
}: {
  activeRevision?: number | null;
  id: string;
  name: string;
  revision?: number;
  withOutput?: boolean;
}): ApiWorkflow => ({
  active_revision: activeRevision,
  created_at: 1_710_000_020,
  id,
  name,
  presentation: {
    connections: withOutput ? { "edge-1": { label: "" } } : {},
    nodes: {
      input: {
        description: "",
        name: `${name} Input`,
        position: { x: 0, y: 0 },
      },
      ...(withOutput
        ? {
            output: {
              description: "",
              name: `${name} Output`,
              position: { x: 260, y: 0 },
            },
          }
        : {}),
    },
  },
  revision,
  spec: {
    connections: withOutput
      ? [
          {
            from: { node_id: "input", port: "output" },
            id: "edge-1",
            to: { node_id: "output", port: "input" },
          },
        ]
      : [],
    nodes: [
      {
        config: { default_value: "" },
        id: "input",
        kind: "input",
      },
      ...(withOutput
        ? [
            {
              config: { output_key: "final_result" },
              id: "output",
              kind: "output" as const,
            },
          ]
        : []),
    ],
  },
  updated_at: 1_710_000_030,
});

const appState = (workflows: ApiWorkflow[]) => ({
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
  workflows,
});

const jsonResponse = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
    status,
  });

const savedWorkflow = (
  current: ApiWorkflow,
  body: SaveWorkflowBody,
  updates: Partial<ApiWorkflow> = {},
): ApiWorkflow => {
  const revision = (body.base_revision ?? 0) + 1;
  return {
    ...current,
    ...body.workflow,
    active_revision: revision,
    revision,
    updated_at: current.updated_at + 1,
    ...updates,
  };
};

const runResult = (workflowId: string, revision: number) => ({
  node_results: [
    {
      error: null,
      id: "input",
      inputs: [],
      output: "Input value",
      status: "success",
    },
    {
      error: null,
      id: "output",
      inputs: ["Input value"],
      output: "Old revision output",
      status: "success",
    },
  ],
  outputs: { final_result: "Old revision output" },
  run_id: `run-${revision}`,
  status: "success",
  trigger: "manual",
  workflow_id: workflowId,
  workflow_revision: revision,
});

const deferredResponse = () => {
  let resolve: (response: Response) => void = () => undefined;
  const promise = new Promise<Response>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
};

const mockWorkflowApi = (workflows: ApiWorkflow[], handler?: FetchHandler) =>
  vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
    const handled = handler?.(input, init);
    if (handled) {
      return handled;
    }
    if (input === "/api/state") {
      return jsonResponse(appState(workflows));
    }
    if (input === "/api/about") {
      return jsonResponse({});
    }
    return jsonResponse({});
  });

describe("workflow autosave and revision concurrency", () => {
  beforeEach(() => {
    reactFlowRenderMock.mockClear();
    window.history.replaceState(null, "", "/workflows/workflow-a");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("saves a pending edit when the user switches to another main page", async () => {
    const workflowA = workflowFixture({ id: "workflow-a", name: "Workflow A" });
    const saveBodies: SaveWorkflowBody[] = [];
    mockWorkflowApi([workflowA], (input, init) => {
      if (input === "/api/workflows" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as SaveWorkflowBody;
        saveBodies.push(body);
        return jsonResponse(savedWorkflow(workflowA, body));
      }
      return null;
    });

    render(<App />);
    const inputNode = await screen.findByTestId("workflow-node-input");
    vi.useFakeTimers();
    fireEvent.doubleClick(inputNode);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(screen.getByText("Saving...")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Workspace" }), {
      button: 0,
      ctrlKey: false,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(saveBodies).toHaveLength(1);
    expect(saveBodies[0].workflow.presentation.nodes.input.position).toEqual({
      x: 100,
      y: 0,
    });
  });

  it("does not reopen workflow A when its delayed save finishes after workflow B is selected", async () => {
    const workflowA = workflowFixture({ id: "workflow-a", name: "Workflow A" });
    const workflowB = workflowFixture({ id: "workflow-b", name: "Workflow B" });
    const pendingSave = deferredResponse();
    let saveBody: SaveWorkflowBody | null = null;
    mockWorkflowApi([workflowA, workflowB], (input, init) => {
      if (input === "/api/workflows" && init?.method === "PUT") {
        saveBody = JSON.parse(String(init.body)) as SaveWorkflowBody;
        return pendingSave.promise;
      }
      return null;
    });

    render(<App />);
    const user = userEvent.setup();
    await user.dblClick(await screen.findByTestId("workflow-node-input"));
    await waitFor(() => {
      expect(saveBody).not.toBeNull();
    });
    await user.click(screen.getByRole("button", { name: "Workflow B" }));
    await waitFor(() => {
      expect(window.location.pathname).toBe("/workflows/workflow-b");
      expect(screen.getByTestId("workflow-node-input")).toHaveTextContent(
        "Workflow B Input",
      );
    });

    await act(async () => {
      pendingSave.resolve(
        jsonResponse(savedWorkflow(workflowA, saveBody as SaveWorkflowBody)),
      );
      await pendingSave.promise;
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    });

    expect(window.location.pathname).toBe("/workflows/workflow-b");
    expect(screen.getByTestId("workflow-node-input")).toHaveTextContent(
      "Workflow B Input",
    );
  });

  it("keeps edits made while a conflicting save response is pending", async () => {
    const workflowA = workflowFixture({ id: "workflow-a", name: "Workflow A" });
    const latestServerWorkflow = workflowFixture({
      activeRevision: 2,
      id: "workflow-a",
      name: "Workflow A",
      revision: 2,
    });
    latestServerWorkflow.presentation.nodes.input = {
      description: "Updated elsewhere",
      name: "Server Input",
      position: { x: 700, y: 0 },
    };
    const firstSave = deferredResponse();
    const saveBodies: SaveWorkflowBody[] = [];
    mockWorkflowApi([workflowA], (input, init) => {
      if (input === "/api/workflows" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as SaveWorkflowBody;
        saveBodies.push(body);
        if (saveBodies.length === 1) {
          return firstSave.promise;
        }
        return jsonResponse(
          savedWorkflow(latestServerWorkflow, body, {
            active_revision: 3,
            revision: 3,
          }),
        );
      }
      return null;
    });

    render(<App />);
    const user = userEvent.setup();
    await user.dblClick(await screen.findByTestId("workflow-node-input"));
    await waitFor(() => {
      expect(saveBodies).toHaveLength(1);
    });

    await user.dblClick(screen.getByTestId("workflow-node-input"));
    await waitFor(() => {
      expect(screen.getByTestId("workflow-node-input")).toHaveAttribute(
        "data-position-x",
        "200",
      );
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 25));
      firstSave.resolve(
        jsonResponse(
          {
            detail:
              "This workflow changed elsewhere. The latest version is now open.",
            workflow: latestServerWorkflow,
          },
          409,
        ),
      );
      await firstSave.promise;
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This workflow changed elsewhere.",
    );
    await waitFor(() => {
      expect(screen.getByTestId("workflow-node-input")).toHaveAttribute(
        "data-position-x",
        "200",
      );
    });
    await waitFor(() => {
      expect(saveBodies).toHaveLength(2);
    });
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(
      screen.queryByText("This workflow changed elsewhere."),
    ).not.toBeInTheDocument();
  });

  it("runs the draft revision and keeps its specific validation error visible", async () => {
    const workflowA = workflowFixture({
      activeRevision: 1,
      id: "workflow-a",
      name: "Workflow A",
      revision: 2,
      withOutput: false,
    });
    const runBodies: Array<Record<string, unknown>> = [];
    mockWorkflowApi([workflowA], (input, init) => {
      if (
        input === "/api/workflows/workflow-a/run" &&
        init?.method === "POST"
      ) {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        runBodies.push(body);
        if (body.workflow_revision === 2) {
          return jsonResponse(
            { detail: "Workflow needs an output node." },
            400,
          );
        }
        return jsonResponse(runResult("workflow-a", 1));
      }
      return null;
    });

    render(<App />);
    const user = userEvent.setup();
    await screen.findByTestId("workflow-node-input");
    await user.click(await screen.findByRole("button", { name: "Run" }));

    await waitFor(() => {
      expect(runBodies).toHaveLength(1);
    });
    expect(runBodies[0]).toMatchObject({ workflow_revision: 2 });
    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("Workflow needs an output node.");
    expect(screen.queryByText("Run completed.")).not.toBeInTheDocument();
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 1_300));
    });
    expect(error).toBeVisible();
  });

  it("runs a presentation-only draft through its active workflow content", async () => {
    const workflowA = workflowFixture({ id: "workflow-a", name: "Workflow A" });
    const runBodies: Array<Record<string, unknown>> = [];
    mockWorkflowApi([workflowA], (input, init) => {
      if (input === "/api/workflows" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as SaveWorkflowBody;
        return jsonResponse(
          savedWorkflow(workflowA, body, {
            active_revision: 1,
            revision: 2,
          }),
        );
      }
      if (
        input === "/api/workflows/workflow-a/run" &&
        init?.method === "POST"
      ) {
        runBodies.push(
          JSON.parse(String(init.body)) as Record<string, unknown>,
        );
        return jsonResponse(runResult("workflow-a", 1));
      }
      return null;
    });

    render(<App />);
    const user = userEvent.setup();
    await user.dblClick(await screen.findByTestId("workflow-node-input"));
    await screen.findByText("Saved");
    await user.click(await screen.findByRole("button", { name: "Run" }));

    await waitFor(() => {
      expect(runBodies).toEqual([
        expect.objectContaining({ workflow_revision: 2 }),
      ]);
    });
    expect(await screen.findByText("Run completed.")).toBeInTheDocument();
  });

  it("shows an accessible save error when the request is rejected", async () => {
    const workflowA = workflowFixture({ id: "workflow-a", name: "Workflow A" });
    mockWorkflowApi([workflowA], (input, init) => {
      if (input === "/api/workflows" && init?.method === "PUT") {
        throw new TypeError("Failed to fetch");
      }
      return null;
    });

    render(<App />);
    const user = userEvent.setup();
    await user.dblClick(await screen.findByTestId("workflow-node-input"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Workflow could not be saved.",
    );
  });

  it("does not map an old revision run result onto a newly saved canvas", async () => {
    const workflowA = workflowFixture({ id: "workflow-a", name: "Workflow A" });
    const saveBodies: SaveWorkflowBody[] = [];
    mockWorkflowApi([workflowA], (input, init) => {
      if (
        input === "/api/workflows/workflow-a/run" &&
        init?.method === "POST"
      ) {
        return jsonResponse(runResult("workflow-a", 1));
      }
      if (input === "/api/workflows" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as SaveWorkflowBody;
        saveBodies.push(body);
        return jsonResponse(savedWorkflow(workflowA, body));
      }
      return null;
    });

    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Run" }));
    expect(await screen.findByText("Run completed.")).toBeInTheDocument();
    await waitFor(() => {
      const calls = reactFlowRenderMock.mock.calls;
      const latestRender = calls[calls.length - 1]?.[0];
      const inputNode = latestRender?.nodes.find(
        (node: FlowNode) => node.id === "input",
      );
      expect(inputNode?.data.result).toMatchObject({ status: "success" });
    });

    await user.dblClick(screen.getByTestId("workflow-node-input"));
    await waitFor(() => {
      expect(saveBodies).toHaveLength(1);
    });
    await screen.findByText("Saved");

    await waitFor(() => {
      const calls = reactFlowRenderMock.mock.calls;
      const latestRender = calls[calls.length - 1]?.[0];
      const inputNode = latestRender?.nodes.find(
        (node: FlowNode) => node.id === "input",
      );
      expect(inputNode?.data.result).toBeUndefined();
    });
  });
});
