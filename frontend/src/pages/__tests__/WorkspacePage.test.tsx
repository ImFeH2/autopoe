import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspacePage } from "@/pages/WorkspacePage";
import type { Node, TaskTab } from "@/types";
import { useRef, useState, type ReactNode } from "react";

const {
  clearChatMock,
  fetchRolesMock,
  createTabRequestMock,
  createTabNodeRequestMock,
  deleteTabRequestMock,
  dispatchNodeMessageRequestMock,
  createTabEdgeRequestMock,
  interruptNodeMock,
  toastErrorMock,
  toastSuccessMock,
} = vi.hoisted(() => ({
  clearChatMock: vi.fn(),
  fetchRolesMock: vi.fn(),
  createTabRequestMock: vi.fn(),
  createTabNodeRequestMock: vi.fn(),
  deleteTabRequestMock: vi.fn(),
  dispatchNodeMessageRequestMock: vi.fn(),
  createTabEdgeRequestMock: vi.fn(),
  interruptNodeMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

const {
  useAgentNodesRuntimeMock,
  useAgentTabsRuntimeMock,
  useAgentConnectionRuntimeMock,
  useAgentActivityRuntimeMock,
  useAgentHistoryRuntimeMock,
  useAgentDetailMock,
  useAgentUIMock,
} = vi.hoisted(() => ({
  useAgentNodesRuntimeMock: vi.fn(),
  useAgentTabsRuntimeMock: vi.fn(),
  useAgentConnectionRuntimeMock: vi.fn(),
  useAgentActivityRuntimeMock: vi.fn(),
  useAgentHistoryRuntimeMock: vi.fn(),
  useAgentDetailMock: vi.fn(),
  useAgentUIMock: vi.fn(),
}));

const { useWorkspacePageStateMock } = vi.hoisted(() => ({
  useWorkspacePageStateMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  fetchRoles: (...args: unknown[]) => fetchRolesMock(...args),
  createTabRequest: (...args: unknown[]) => createTabRequestMock(...args),
  createTabNodeRequest: (...args: unknown[]) =>
    createTabNodeRequestMock(...args),
  deleteTabRequest: (...args: unknown[]) => deleteTabRequestMock(...args),
  dispatchNodeMessageRequest: (...args: unknown[]) =>
    dispatchNodeMessageRequestMock(...args),
  createTabEdgeRequest: (...args: unknown[]) =>
    createTabEdgeRequestMock(...args),
  interruptNode: (...args: unknown[]) => interruptNodeMock(...args),
}));

vi.mock("@/context/AgentContext", () => ({
  useAgentActivityRuntime: () => useAgentActivityRuntimeMock(),
  useAgentNodesRuntime: () => useAgentNodesRuntimeMock(),
  useAgentTabsRuntime: () => useAgentTabsRuntimeMock(),
  useAgentConnectionRuntime: () => useAgentConnectionRuntimeMock(),
  useAgentHistoryRuntime: () => useAgentHistoryRuntimeMock(),
  useAgentUI: () => useAgentUIMock(),
}));

vi.mock("@/hooks/useLeaderChat", () => ({
  useLeaderChat: () => ({
    activeTab: buildTab(),
    clearChat: clearChatMock,
    clearing: false,
    connected: true,
    draftImages: [],
    handleKeyDown: vi.fn(),
    hasUploadingImages: false,
    input: "",
    isBrowsingInputHistory: false,
    leaderActivity: {
      running: false,
      runningHint: null,
    },
    leaderNode: buildNode({
      id: "leader-1",
      is_leader: true,
      role_name: "Conductor",
    }),
    navigateInputHistory: vi.fn(),
    onMessagesScroll: vi.fn(),
    removeImage: vi.fn(),
    scrollRef: { current: null },
    sending: false,
    sendMessage: vi.fn(),
    setInput: vi.fn(),
    stopLeader: vi.fn(),
    supportsInputImage: false,
    timelineItems: [],
  }),
}));

vi.mock("@/hooks/useAgentDetail", () => ({
  useAgentDetail: (...args: unknown[]) => useAgentDetailMock(...args),
}));

vi.mock("@/hooks/useMeasuredHeight", () => ({
  useMeasuredHeight: () => ({
    height: 0,
    ref: { current: null },
  }),
}));

vi.mock("@/pages/workspace/useWorkspacePageState", () => ({
  useWorkspacePageState: () =>
    (
      useWorkspacePageStateMock as unknown as () => ReturnType<
        typeof useMockWorkspacePageState
      >
    )(),
}));

vi.mock("@/hooks/usePanelDrag", () => ({
  hasCachedPanelWidth: () => true,
  usePanelDrag: () => ({
    isDragging: false,
    startDrag: vi.fn(),
  }),
  usePanelWidth: () => [560, vi.fn()],
}));

vi.mock("@/components/AgentGraph", () => ({
  AgentGraph: () => <div>AgentGraph</div>,
}));

vi.mock("@/components/HistoryView", () => ({
  HistoryView: () => <div>HistoryView</div>,
}));

vi.mock("@/components/AssistantChatContent", () => ({
  AssistantChatMessages: () => <div>AssistantChatMessages</div>,
  AssistantChatComposer: () => <div>AssistantChatComposer</div>,
}));

vi.mock("@/components/PanelResizer", () => ({
  PanelResizer: () => null,
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
    success: (...args: unknown[]) => toastSuccessMock(...args),
  },
}));

function buildNode(overrides: Partial<Node> & Pick<Node, "id">): Node {
  return {
    id: overrides.id,
    node_type: overrides.node_type ?? "agent",
    tab_id: overrides.tab_id ?? "tab-1",
    is_leader: overrides.is_leader ?? false,
    state: overrides.state ?? "idle",
    connections: overrides.connections ?? [],
    name: overrides.name ?? null,
    todos: overrides.todos ?? [],
    role_name: overrides.role_name ?? "Worker",
    position: overrides.position ?? null,
  };
}

function buildTab(overrides: Partial<TaskTab> = {}): TaskTab {
  return {
    id: overrides.id ?? "tab-1",
    title: overrides.title ?? "Example Tab",
    leader_id: overrides.leader_id ?? "leader-1",
    created_at: overrides.created_at ?? 1,
    updated_at: overrides.updated_at ?? 1,
    definition: overrides.definition ?? { version: 1, nodes: [], edges: [] },
    allow_network: overrides.allow_network ?? false,
    write_dirs: overrides.write_dirs ?? [],
    node_count: overrides.node_count ?? 2,
    edge_count: overrides.edge_count ?? 1,
  };
}

function buildRole(
  overrides: Partial<{ name: string; description: string }> & {
    name: string;
  },
) {
  return {
    name: overrides.name,
    description: overrides.description ?? `${overrides.name} description`,
    system_prompt: `${overrides.name} prompt`,
    model: null,
    model_params: null,
    included_tools: [],
    excluded_tools: [],
    is_builtin: overrides.name === "Worker" || overrides.name === "Designer",
  };
}

interface WorkspacePageScenario {
  activeTabId?: string | null;
  canCreateModelNode?: boolean;
  connected?: boolean;
  leaderNode?: Node | null;
  regularTabAgents?: Node[];
  roles?: ReturnType<typeof buildRole>[];
  selectedAgent?: Node | null;
  setActiveTabIdSpy?: (nextValue: string | null) => void;
  tabs?: Map<string, TaskTab>;
}

let workspacePageScenario: WorkspacePageScenario = {};

function useMockWorkspacePageState() {
  const roles = workspacePageScenario.roles ?? [
    buildRole({ name: "Worker", description: "General execution role" }),
    buildRole({ name: "Reviewer", description: "Review results carefully" }),
    buildRole({ name: "Designer", description: "Frontend design role" }),
  ];
  const tabs =
    workspacePageScenario.tabs ??
    new Map([["tab-1", buildTab({ leader_id: "leader-1" })]]);
  const [activeTabIdState, setActiveTabIdState] = useState<string | null>(
    workspacePageScenario.activeTabId ?? "tab-1",
  );
  const [activeDialog, setActiveDialog] = useState<
    "create-tab" | "create-node" | "connect-ports" | "delete-tab" | null
  >(null);
  const [pendingAction, setPendingAction] = useState<
    | "create-tab"
    | "create-node"
    | "connect-ports"
    | "delete-tab"
    | "save-definition"
    | "activate-workflow"
    | "deactivate-workflow"
    | null
  >(null);
  const [createTabTitle, setCreateTabTitle] = useState("");
  const [createTabAllowNetwork, setCreateTabAllowNetwork] = useState(false);
  const [createTabWriteDirs, setCreateTabWriteDirs] = useState("");
  const [createNodeType, setCreateNodeType] = useState<
    "agent" | "trigger" | "llm" | "code" | "if" | "merge"
  >("agent");
  const [createNodeRoleName, setCreateNodeRoleName] = useState("Worker");
  const [createNodeName, setCreateNodeName] = useState("");
  const [connectSourceId, setConnectSourceId] = useState("");
  const [connectSourcePortKey, setConnectSourcePortKey] = useState("");
  const [connectTargetId, setConnectTargetId] = useState("");
  const [connectTargetPortKey, setConnectTargetPortKey] = useState("");
  const [deleteTabTarget, setDeleteTabTarget] = useState<{
    id: string;
    title: string;
    nodeCount?: number;
  } | null>(null);
  const [definitionDraft, setDefinitionDraft] = useState(
    JSON.stringify({ version: 1, nodes: [], edges: [] }, null, 2),
  );
  const [editorMode, setEditorMode] = useState<"graph" | "json">("graph");
  const [graphConnectMode, setGraphConnectMode] = useState(false);
  const [leaderDetailVisible, setLeaderDetailVisible] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const graphRef = useRef(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const selectedAgent = workspacePageScenario.selectedAgent ?? null;
  const activeTab = activeTabIdState
    ? (tabs.get(activeTabIdState) ?? null)
    : null;
  const leaderNode =
    workspacePageScenario.leaderNode ??
    buildNode({
      id: "leader-1",
      is_leader: true,
      role_name: "Conductor",
    });
  const setActiveTabId = (nextValue: string | null) => {
    workspacePageScenario.setActiveTabIdSpy?.(nextValue);
    setActiveTabIdState(nextValue);
  };
  const selectedCreateNodeRole =
    roles.find((role) => role.name === createNodeRoleName) ?? null;

  return {
    activeDialog,
    activeTab,
    activeTabId: activeTabIdState,
    canCreateModelNode: workspacePageScenario.canCreateModelNode ?? true,
    connected: workspacePageScenario.connected ?? true,
    connectSourceId,
    connectSourcePortKey,
    connectTargetId,
    connectTargetPortKey,
    createNodeName,
    createNodeRoleName,
    createNodeType,
    createTabAllowNetwork,
    createTabTitle,
    createTabWriteDirs,
    definitionDraft,
    deleteTabTarget,
    editorMode,
    graphConnectMode,
    graphHistory: {
      canRedo: () => false,
      canUndo: () => false,
      createConnection: async () => {},
      createLinkedAgent: async () => undefined,
      createStandaloneAgent: async () => undefined,
      createStandaloneNode: async () => undefined,
      deleteAgent: async () => {},
      deleteConnection: async () => {},
      insertAgentBetween: async () => undefined,
      redo: async () => false,
      undo: async () => false,
    },
    graphRef,
    handleCloseLeaderDetails: () => {
      setLeaderDetailVisible(false);
    },
    handleConnectPorts: async () => {
      setPendingAction("connect-ports");
      await createTabEdgeRequestMock(
        activeTabIdState,
        connectSourceId,
        connectTargetId,
        connectSourcePortKey,
        connectTargetPortKey,
      );
      setPendingAction(null);
      setActiveDialog(null);
    },
    handleCreateNode: async () => {
      setPendingAction("create-node");
      await createTabNodeRequestMock(activeTabIdState, {
        node_type: createNodeType,
        role_name: createNodeRoleName,
        name: createNodeName,
      });
      setPendingAction(null);
      setActiveDialog(null);
    },
    handleCreateTab: async () => {
      setPendingAction("create-tab");
      const createdTab = await createTabRequestMock(
        createTabTitle,
        createTabAllowNetwork,
        createTabWriteDirs
          .split("\n")
          .map((value) => value.trim())
          .filter(Boolean),
      );
      setPendingAction(null);
      setActiveDialog(null);
      if (createdTab?.id) {
        setActiveTabId(createdTab.id);
      }
    },
    handleDeleteTab: async () => {
      if (!deleteTabTarget) {
        return;
      }
      setPendingAction("delete-tab");
      await deleteTabRequestMock(deleteTabTarget.id);
      setPendingAction(null);
      setDeleteTabTarget(null);
    },
    handleOpenLeaderDetails: () => {
      setLeaderDetailVisible(true);
    },
    handleSaveDefinition: async () => {},
    handleToggleActivation: async () => {},
    isCompactWorkspace: false,
    isDragging: false,
    leaderDetailVisible,
    leaderNode,
    leaderPanelRunning: false,
    loadingRoles: false,
    openConnectDialog: () => {
      setActiveDialog("connect-ports");
    },
    openCreateNodeDialog: () => {
      setActiveDialog("create-node");
    },
    openCreateTabDialog: () => {
      setActiveDialog("create-tab");
    },
    panelVisible: panelOpen || Boolean(selectedAgent),
    pendingAction,
    regularTabAgents:
      workspacePageScenario.regularTabAgents ??
      (selectedAgent && !selectedAgent.is_leader ? [selectedAgent] : []),
    requestDeleteTab: (tabId: string, title: string, nodeCount?: number) => {
      setDeleteTabTarget({ id: tabId, title, nodeCount });
    },
    resolvedPanelWidth: 560,
    roles,
    selectAgent: vi.fn(),
    selectedAgent,
    selectedCreateNodeRole,
    setActiveDialog,
    setActiveTabId,
    setConnectSourceId,
    setConnectSourcePortKey,
    setConnectTargetId,
    setConnectTargetPortKey,
    setCreateNodeName,
    setCreateNodeRoleName,
    setCreateNodeType,
    setCreateTabAllowNetwork,
    setCreateTabTitle,
    setCreateTabWriteDirs,
    setDefinitionDraft,
    setDeleteTabTarget,
    setEditorMode,
    setGraphConnectMode,
    sourcePortOptions: [],
    startDrag: vi.fn(),
    tabs,
    targetPortOptions: [],
    togglePanel: () => {
      setPanelOpen((value) => !value);
    },
    workflowNodeOptions: [],
    workspaceRef,
    workflowReceivingWork: activeTab?.activation_state === "active",
  };
}

describe("WorkspacePage", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    clearChatMock.mockReset();
    fetchRolesMock.mockReset();
    createTabRequestMock.mockReset();
    createTabNodeRequestMock.mockReset();
    deleteTabRequestMock.mockReset();
    dispatchNodeMessageRequestMock.mockReset();
    createTabEdgeRequestMock.mockReset();
    interruptNodeMock.mockReset();
    toastErrorMock.mockReset();
    toastSuccessMock.mockReset();
    useWorkspacePageStateMock.mockImplementation(useMockWorkspacePageState);
    workspacePageScenario = {};

    const assistant = buildNode({
      id: "assistant",
      node_type: "assistant",
      tab_id: null,
      role_name: "Steward",
    });
    const worker = buildNode({
      id: "agent-1",
      name: "Docs Worker",
    });

    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map([
        [assistant.id, assistant],
        [worker.id, worker],
      ]),
    });
    useAgentTabsRuntimeMock.mockReturnValue({
      tabs: new Map([["tab-1", buildTab()]]),
    });
    useAgentConnectionRuntimeMock.mockReturnValue({
      connected: true,
    });
    useAgentActivityRuntimeMock.mockReturnValue({
      activeMessages: [],
      activeToolCalls: new Map(),
    });
    useAgentHistoryRuntimeMock.mockReturnValue({
      agentHistories: new Map(),
      clearAgentHistory: vi.fn(),
      clearHistorySnapshot: vi.fn(),
      historyInvalidatedAt: new Map(),
      historyClearedAt: new Map(),
      historySnapshots: new Map(),
      streamingDeltas: new Map(),
    });
    useAgentDetailMock.mockReturnValue({
      detail: null,
      error: null,
      loading: false,
    });
    useAgentUIMock.mockReturnValue({
      activeTabId: "tab-1",
      pendingAssistantMessages: [],
      selectedAgentId: worker.id,
      selectAgent: vi.fn(),
      setActiveTabId: vi.fn(),
    });
    fetchRolesMock.mockResolvedValue([
      buildRole({ name: "Worker", description: "General execution role" }),
      buildRole({ name: "Reviewer", description: "Review results carefully" }),
      buildRole({ name: "Designer", description: "Frontend design role" }),
    ]);

    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as typeof ResizeObserver;
  });

  it("creates a tab through the custom dialog instead of a browser prompt", async () => {
    const setActiveTabId = vi.fn();
    workspacePageScenario = { setActiveTabIdSpy: setActiveTabId };
    createTabRequestMock.mockResolvedValue({
      id: "tab-2",
      title: "Release Prep",
      definition: { version: 1, nodes: [], edges: [] },
      allow_network: false,
      write_dirs: [],
    });

    render(<WorkspacePage />);

    fireEvent.click(screen.getByLabelText("Create workflow"));
    fireEvent.change(screen.getByLabelText("Workflow title"), {
      target: { value: "Release Prep" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Workflow" }));

    await waitFor(() =>
      expect(createTabRequestMock).toHaveBeenCalledWith(
        "Release Prep",
        false,
        [],
      ),
    );
    expect(setActiveTabId).toHaveBeenCalledWith("tab-2");
  }, 10000);

  it("keeps the workspace toolbar centered while constraining overflow inside the background", () => {
    render(<WorkspacePage />);

    const toolbars = screen.getAllByTestId("workspace-toolbar");

    expect(toolbars.length).toBeGreaterThan(0);
    for (const toolbar of toolbars) {
      expect(toolbar).toHaveClass("inline-flex");
      expect(toolbar).toHaveClass("max-w-full");
      expect(toolbar).toHaveClass("overflow-x-auto");
      expect(toolbar.parentElement).toHaveClass("inset-x-3");
      expect(toolbar.parentElement).toHaveClass("justify-center");
    }
  });

  it("shows workflow chat context in the chat header", () => {
    render(<WorkspacePage />);

    const chatHeader = screen.getByText("Workflow chat").closest("div");
    expect(chatHeader).not.toBeNull();
    expect(within(chatHeader!).getByText("Example Tab")).toBeInTheDocument();
    expect(
      within(chatHeader!).getByText("Role: Conductor"),
    ).toBeInTheDocument();
    expect(within(chatHeader!).getByText("Inactive")).toBeInTheDocument();
    expect(within(chatHeader!).getByText("Online")).toBeInTheDocument();
  });

  it("adds an agent node through the custom dialog", async () => {
    createTabNodeRequestMock.mockResolvedValue(undefined);

    render(<WorkspacePage />);

    fireEvent.click(screen.getAllByRole("button", { name: "Add Node" })[0]);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Search roles"), {
      target: { value: "review" },
    });
    fireEvent.click(within(dialog).getByText("Reviewer"));
    fireEvent.change(screen.getByLabelText("Node display name"), {
      target: { value: "Release Reviewer" },
    });
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Add Node",
      }),
    );

    await waitFor(() =>
      expect(createTabNodeRequestMock).toHaveBeenCalledWith("tab-1", {
        node_type: "agent",
        role_name: "Reviewer",
        name: "Release Reviewer",
      }),
    );
  });

  it("requires a selected model before adding a model node", async () => {
    workspacePageScenario = { canCreateModelNode: false };

    render(<WorkspacePage />);

    fireEvent.click(screen.getAllByRole("button", { name: "Add Node" })[0]);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("combobox", { name: "Node Type" }),
    );
    fireEvent.click(await screen.findByRole("option", { name: "Model" }));

    expect(
      within(dialog).getByText(
        "Choose a model in Settings before adding a Model node.",
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Add Node" }),
    ).toBeDisabled();
  });

  it("opens leader details from the workspace panel and keeps interrupt only in the detail header", async () => {
    const leader = buildNode({
      id: "leader-1",
      is_leader: true,
      state: "running",
      role_name: "Conductor",
    });
    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map([[leader.id, leader]]),
    });
    workspacePageScenario = { leaderNode: leader, selectedAgent: null };
    useAgentDetailMock.mockReturnValue({
      detail: {
        id: leader.id,
        node_type: "agent",
        is_leader: true,
        tab_id: "tab-1",
        state: "running",
        name: "Leader",
        contacts: [],
        connections: [],
        role_name: "Conductor",
        todos: [],
        tools: [],
        write_dirs: [],
        allow_network: true,
        position: null,
        history: [],
      },
      error: null,
      loading: false,
    });
    interruptNodeMock.mockResolvedValue(undefined);

    const view = render(<WorkspacePage />);

    expect(
      within(view.container).queryByRole("button", { name: "Interrupt" }),
    ).toBeNull();

    const leaderDetailButtons = screen.getAllByRole("button", {
      name: "Detail",
    });
    fireEvent.click(leaderDetailButtons[leaderDetailButtons.length - 1]);

    expect(screen.getAllByText("Status").length).toBeGreaterThan(0);
    expect(screen.getByText("RUNNING")).toBeInTheDocument();

    const interruptButton = await screen.findByRole("button", {
      name: "Interrupt",
    });
    expect(interruptButton).toHaveAttribute("data-variant", "destructive");
    fireEvent.click(interruptButton);

    await waitFor(() => {
      expect(interruptNodeMock).toHaveBeenCalledWith("leader-1");
    });
  });

  it("exposes a workflow clear chat action in the workspace panel", () => {
    render(<WorkspacePage />);

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    expect(clearChatMock).toHaveBeenCalledTimes(1);
  });

  it("shows the same interrupt action for a running task node detail view", async () => {
    const worker = buildNode({
      id: "agent-1",
      name: "Docs Worker",
      state: "running",
    });
    const assistant = buildNode({
      id: "assistant",
      node_type: "assistant",
      tab_id: null,
      role_name: "Steward",
    });
    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map([
        [assistant.id, assistant],
        [worker.id, worker],
      ]),
    });
    workspacePageScenario = { selectedAgent: worker };
    useAgentDetailMock.mockReturnValue({
      detail: {
        id: worker.id,
        node_type: "agent",
        tab_id: "tab-1",
        state: "running",
        name: "Docs Worker",
        contacts: ["assistant"],
        connections: [],
        role_name: "Worker",
        todos: [],
        tools: [],
        write_dirs: [],
        allow_network: false,
        position: null,
        history: [],
      },
      error: null,
      loading: false,
    });
    interruptNodeMock.mockResolvedValue(undefined);

    const view = render(<WorkspacePage />);

    const interruptButtons = within(view.container).getAllByRole("button", {
      name: "Interrupt",
    });
    const interruptButton = interruptButtons[interruptButtons.length - 1];
    expect(interruptButton).toHaveAttribute("data-variant", "destructive");
    fireEvent.click(interruptButton);

    await waitFor(() => {
      expect(interruptNodeMock).toHaveBeenCalledWith("agent-1");
    });
  });

  it("shows the same interrupt action for a sleeping task node detail view", async () => {
    const worker = buildNode({
      id: "agent-1",
      name: "Docs Worker",
      state: "sleeping",
    });
    const assistant = buildNode({
      id: "assistant",
      node_type: "assistant",
      tab_id: null,
      role_name: "Steward",
    });
    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map([
        [assistant.id, assistant],
        [worker.id, worker],
      ]),
    });
    workspacePageScenario = { selectedAgent: worker };
    useAgentDetailMock.mockReturnValue({
      detail: {
        id: worker.id,
        node_type: "agent",
        tab_id: "tab-1",
        state: "sleeping",
        name: "Docs Worker",
        contacts: ["assistant"],
        connections: [],
        role_name: "Worker",
        todos: [],
        tools: [],
        write_dirs: [],
        allow_network: false,
        position: null,
        history: [],
      },
      error: null,
      loading: false,
    });
    interruptNodeMock.mockResolvedValue(undefined);

    const view = render(<WorkspacePage />);

    const interruptButtons = within(view.container).getAllByRole("button", {
      name: "Interrupt",
    });
    const interruptButton = interruptButtons[interruptButtons.length - 1];
    expect(interruptButton).toHaveAttribute("data-variant", "destructive");
    fireEvent.click(interruptButton);

    await waitFor(() => {
      expect(interruptNodeMock).toHaveBeenCalledWith("agent-1");
    });
  });

  it("deletes a tab through the confirmation dialog", async () => {
    deleteTabRequestMock.mockResolvedValue(undefined);

    render(<WorkspacePage />);

    fireEvent.click(screen.getAllByLabelText("Delete Example Tab")[0]);
    fireEvent.click(screen.getByRole("button", { name: "Delete Workflow" }));

    await waitFor(() =>
      expect(deleteTabRequestMock).toHaveBeenCalledWith("tab-1"),
    );
  });

  it("middle-clicks a tab into the same delete flow without activating it first", async () => {
    const setActiveTabId = vi.fn();
    deleteTabRequestMock.mockResolvedValue(undefined);
    workspacePageScenario = {
      activeTabId: "tab-2",
      setActiveTabIdSpy: setActiveTabId,
      tabs: new Map([
        ["tab-1", buildTab()],
        [
          "tab-2",
          buildTab({
            id: "tab-2",
            title: "Other Tab",
            node_count: 2,
          }),
        ],
      ]),
    };

    render(<WorkspacePage />);

    fireEvent(
      screen.getAllByRole("button", { name: /Example Tab/ })[0],
      new MouseEvent("auxclick", {
        bubbles: true,
        button: 1,
      }),
    );

    expect(setActiveTabId).not.toHaveBeenCalledWith("tab-1");
    fireEvent.click(screen.getByRole("button", { name: "Delete Workflow" }));

    await waitFor(() =>
      expect(deleteTabRequestMock).toHaveBeenCalledWith("tab-1"),
    );
  });
});
