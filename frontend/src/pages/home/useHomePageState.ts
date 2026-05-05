import type { AgentGraphHandle } from "@/components/AgentGraph";
import type {
  WorkspaceNodeOption,
  WorkspacePortOption,
} from "@/components/workspace/WorkspaceDialogs";
import {
  useAgentActivityRuntime,
  useAgentConnectionRuntime,
  useAgentHistoryRuntime,
  useAgentNodesRuntime,
  useAgentTabsRuntime,
  useAgentUI,
} from "@/context/AgentContext";
import {
  activateWorkflowRequest,
  createTabRequest,
  deactivateWorkflowRequest,
  deleteTabRequest,
  duplicateTabRequest,
  fetchRoles,
  updateTabDefinitionRequest,
} from "@/lib/api";
import { getNodeLabel } from "@/lib/constants";
import { EMPTY_WORKFLOW_DEFINITION } from "@/lib/tabEvents";
import { getWorkflowLeaderNode } from "@/lib/workflow";
import {
  hasCachedPanelWidth,
  usePanelDrag,
  usePanelWidth,
} from "@/hooks/usePanelDrag";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useTabGraphHistory } from "@/hooks/useTabGraphHistory";
import type { Role, WorkflowNodeType, WorkflowPort } from "@/types";
import { toast } from "sonner";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const WORKSPACE_PANEL_ID = "workspace-panel-width";
const MIN_PANEL_WIDTH = 296;
const MIN_FORMATION_WIDTH = 300;
const MAX_PANEL_WIDTH = 960;
const DEFAULT_PANEL_RATIO = 0.34;
const DEFAULT_PANEL_WIDTH = 448;
const COMPACT_PANEL_MIN_WIDTH = 300;

export type WorkspaceDialogKind =
  | "create-tab"
  | "create-node"
  | "connect-ports"
  | "delete-tab"
  | null;

export type WorkspacePendingAction =
  | "create-tab"
  | "create-node"
  | "connect-ports"
  | "delete-tab"
  | "duplicate-tab"
  | "save-definition"
  | "activate-workflow"
  | "deactivate-workflow"
  | null;

export type WorkspacePanelView = "chat" | "detail";
export type WorkspaceEditorMode = "graph" | "json";

export interface DeleteTabTarget {
  id: string;
  title: string;
  nodeCount?: number;
}

function formatPortLabel(port: WorkflowPort): string {
  return `${port.key} · ${port.type}`;
}

export function useHomePageState() {
  const { agents } = useAgentNodesRuntime();
  const { tabs } = useAgentTabsRuntime();
  const { connected } = useAgentConnectionRuntime();
  const { activeToolCalls } = useAgentActivityRuntime();
  const { streamingDeltas } = useAgentHistoryRuntime();
  const { activeTabId, selectedAgentId, selectAgent, setActiveTabId } =
    useAgentUI();

  const [panelOpen, setPanelOpen] = useState(true);
  const [panelView, setPanelView] = useState<WorkspacePanelView>("chat");
  const [editorMode, setEditorMode] = useState<WorkspaceEditorMode>("graph");
  const isCompactWorkspace = useMediaQuery("(max-width: 1180px)");
  const [activeDialog, setActiveDialog] = useState<WorkspaceDialogKind>(null);
  const [pendingAction, setPendingAction] =
    useState<WorkspacePendingAction>(null);
  const [createTabTitle, setCreateTabTitle] = useState("");
  const [createTabAllowNetwork, setCreateTabAllowNetwork] = useState(false);
  const [createTabWriteDirs, setCreateTabWriteDirs] = useState("");
  const [roles, setRoles] = useState<Role[]>([]);
  const [loadingRoles, setLoadingRoles] = useState(false);
  const [createNodeType, setCreateNodeType] =
    useState<WorkflowNodeType>("agent");
  const [createNodeRoleName, setCreateNodeRoleName] = useState("Worker");
  const [createNodeName, setCreateNodeName] = useState("");
  const [connectSourceId, setConnectSourceId] = useState("");
  const [connectSourcePortKey, setConnectSourcePortKey] = useState("");
  const [connectTargetId, setConnectTargetId] = useState("");
  const [connectTargetPortKey, setConnectTargetPortKey] = useState("");
  const [deleteTabTarget, setDeleteTabTarget] =
    useState<DeleteTabTarget | null>(null);
  const [definitionDraft, setDefinitionDraft] = useState(
    JSON.stringify(EMPTY_WORKFLOW_DEFINITION, null, 2),
  );
  const previousCompactWorkspaceRef = useRef<boolean | null>(null);
  const graphRef = useRef<AgentGraphHandle | null>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const graphHistory = useTabGraphHistory();
  const [graphConnectMode, setGraphConnectMode] = useState(false);
  const [panelWidth, setStoredPanelWidth] = usePanelWidth(
    WORKSPACE_PANEL_ID,
    DEFAULT_PANEL_WIDTH,
    MIN_PANEL_WIDTH,
    MAX_PANEL_WIDTH,
  );

  const setPanelWidth = useCallback(
    (nextWidth: number) => {
      const containerWidth =
        workspaceRef.current?.clientWidth ??
        (typeof window === "undefined" ? nextWidth : window.innerWidth);
      const maxWidth = Math.max(
        MIN_PANEL_WIDTH,
        containerWidth - MIN_FORMATION_WIDTH,
      );
      setStoredPanelWidth(Math.min(nextWidth, maxWidth));
    },
    [setStoredPanelWidth],
  );

  const { isDragging, startDrag } = usePanelDrag(
    panelWidth,
    setPanelWidth,
    "left",
  );

  useLayoutEffect(() => {
    if (hasCachedPanelWidth(WORKSPACE_PANEL_ID)) {
      return;
    }
    const containerWidth = workspaceRef.current?.clientWidth;
    if (!containerWidth) {
      return;
    }
    setPanelWidth(containerWidth * DEFAULT_PANEL_RATIO);
  }, [setPanelWidth]);

  useEffect(() => {
    const element = workspaceRef.current;
    if (!element) {
      return;
    }

    const observer = new ResizeObserver(() => {
      setPanelWidth(panelWidth);
    });
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [panelWidth, setPanelWidth]);

  useEffect(() => {
    const previousCompactWorkspace = previousCompactWorkspaceRef.current;
    previousCompactWorkspaceRef.current = isCompactWorkspace;
    if (previousCompactWorkspace === null) {
      return;
    }
    if (!previousCompactWorkspace && isCompactWorkspace) {
      setPanelOpen(false);
    }
  }, [isCompactWorkspace]);

  useEffect(() => {
    let cancelled = false;
    setLoadingRoles(true);
    fetchRoles()
      .then((items) => {
        if (!cancelled) {
          setRoles(items);
        }
      })
      .catch(() => {
        if (!cancelled) {
          toast.error("Failed to load roles");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingRoles(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedAgent = selectedAgentId
    ? (agents.get(selectedAgentId) ?? null)
    : null;
  const activeTab = activeTabId ? (tabs.get(activeTabId) ?? null) : null;
  const activeWorkflowState = activeTab?.activation_state ?? "inactive";
  const workflowLocked = activeWorkflowState === "active";
  const tabAgents = useMemo(
    () =>
      Array.from(agents.values()).filter(
        (agent) =>
          agent.node_type !== "assistant" && agent.tab_id === activeTabId,
      ),
    [activeTabId, agents],
  );
  const regularTabAgents = useMemo(
    () => tabAgents.filter((agent) => !agent.is_leader),
    [tabAgents],
  );
  const workflowNodes = useMemo(
    () => activeTab?.definition.nodes ?? [],
    [activeTab?.definition.nodes],
  );
  const workflowNodeOptions = useMemo<WorkspaceNodeOption[]>(
    () =>
      workflowNodes.map((node) => ({
        id: node.id,
        label: getNodeLabel({
          name: typeof node.config.name === "string" ? node.config.name : null,
          roleName:
            typeof node.config.role_name === "string"
              ? node.config.role_name
              : null,
          nodeType: node.type,
          isLeader: false,
        }),
      })),
    [workflowNodes],
  );
  const sourceNodeDefinition = useMemo(
    () => workflowNodes.find((node) => node.id === connectSourceId) ?? null,
    [connectSourceId, workflowNodes],
  );
  const targetNodeDefinition = useMemo(
    () => workflowNodes.find((node) => node.id === connectTargetId) ?? null,
    [connectTargetId, workflowNodes],
  );
  const sourcePortOptions = useMemo<WorkspacePortOption[]>(
    () =>
      (sourceNodeDefinition?.outputs ?? []).map((port) => ({
        key: port.key,
        label: formatPortLabel(port),
      })),
    [sourceNodeDefinition],
  );
  const targetPortOptions = useMemo<WorkspacePortOption[]>(
    () =>
      (targetNodeDefinition?.inputs ?? []).map((port) => ({
        key: port.key,
        label: formatPortLabel(port),
      })),
    [targetNodeDefinition],
  );
  const selectedCreateNodeRole = useMemo(
    () => roles.find((role) => role.name === createNodeRoleName) ?? null,
    [createNodeRoleName, roles],
  );

  const panelVisible = panelOpen || !!selectedAgent;
  const resolvedPanelWidth = useMemo(() => {
    if (!isCompactWorkspace) {
      return panelWidth;
    }
    const containerWidth =
      workspaceRef.current?.clientWidth ??
      (typeof window === "undefined" ? panelWidth : window.innerWidth);

    return Math.min(
      panelWidth,
      Math.max(COMPACT_PANEL_MIN_WIDTH, containerWidth - 24),
    );
  }, [isCompactWorkspace, panelWidth]);
  const leaderNode = useMemo(
    () => getWorkflowLeaderNode(agents, activeTab),
    [activeTab, agents],
  );
  const leaderId = leaderNode?.id ?? activeTab?.leader_id ?? null;
  const leaderDetailVisible = panelView === "detail" && leaderNode !== null;
  const leaderPanelRunning = useMemo(() => {
    const leaderDeltas = leaderId ? (streamingDeltas.get(leaderId) ?? []) : [];

    return (
      connected &&
      Boolean(
        leaderId &&
        (leaderNode?.state === "running" ||
          leaderNode?.state === "sleeping" ||
          activeToolCalls.has(leaderId) ||
          leaderDeltas.length > 0),
      )
    );
  }, [activeToolCalls, connected, leaderId, leaderNode, streamingDeltas]);

  useEffect(() => {
    if (
      selectedAgent &&
      selectedAgent.tab_id !== null &&
      selectedAgent.tab_id !== activeTabId
    ) {
      selectAgent(null);
    }
  }, [activeTabId, selectAgent, selectedAgent]);

  useEffect(() => {
    setDefinitionDraft(
      JSON.stringify(
        activeTab?.definition ?? EMPTY_WORKFLOW_DEFINITION,
        null,
        2,
      ),
    );
  }, [activeTab?.definition]);

  useEffect(() => {
    if (!sourcePortOptions.some((port) => port.key === connectSourcePortKey)) {
      setConnectSourcePortKey(sourcePortOptions[0]?.key ?? "");
    }
  }, [connectSourcePortKey, sourcePortOptions]);

  useEffect(() => {
    if (!targetPortOptions.some((port) => port.key === connectTargetPortKey)) {
      setConnectTargetPortKey(targetPortOptions[0]?.key ?? "");
    }
  }, [connectTargetPortKey, targetPortOptions]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isModPressed = event.metaKey || event.ctrlKey;
      if (!isModPressed || event.key.toLowerCase() !== "z") {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable ||
        activeDialog !== null
      ) {
        return;
      }

      event.preventDefault();
      if (event.shiftKey) {
        if (workflowLocked) {
          return;
        }
        void graphHistory.redo(activeTabId).catch(() => undefined);
        return;
      }
      if (workflowLocked) {
        return;
      }
      void graphHistory.undo(activeTabId).catch(() => undefined);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeDialog, activeTabId, graphHistory, workflowLocked]);

  const handleOpenLeaderDetails = useCallback(() => {
    setPanelOpen(true);
    setPanelView("detail");
  }, []);

  const handleCloseLeaderDetails = useCallback(() => {
    setPanelView("chat");
  }, []);

  const togglePanel = useCallback(() => {
    if (panelVisible) {
      if (selectedAgentId) {
        selectAgent(null);
      }
      setPanelOpen(false);
      return;
    }
    setPanelOpen(true);
  }, [panelVisible, selectAgent, selectedAgentId]);

  const openCreateTabDialog = useCallback(() => {
    setCreateTabTitle("");
    setCreateTabAllowNetwork(false);
    setCreateTabWriteDirs("");
    setActiveDialog("create-tab");
  }, []);

  const handleCreateTab = useCallback(async () => {
    const title = createTabTitle.trim();
    if (!title) {
      return;
    }
    setPendingAction("create-tab");
    try {
      const writeDirsArray = createTabWriteDirs
        .split("\n")
        .map((dir) => dir.trim())
        .filter(Boolean);
      const tab = await createTabRequest(
        title,
        createTabAllowNetwork,
        writeDirsArray,
      );
      setActiveTabId(tab.id);
      setActiveDialog(null);
      setCreateTabTitle("");
      setCreateTabAllowNetwork(false);
      setCreateTabWriteDirs("");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to create workflow",
      );
    } finally {
      setPendingAction(null);
    }
  }, [
    createTabAllowNetwork,
    createTabTitle,
    createTabWriteDirs,
    setActiveTabId,
  ]);

  const handleDuplicateTab = useCallback(async () => {
    if (!activeTabId) {
      toast.error("Create or select a workflow first");
      return;
    }
    setPendingAction("duplicate-tab");
    try {
      const duplicated = await duplicateTabRequest(activeTabId);
      setActiveTabId(duplicated.id);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to duplicate workflow",
      );
    } finally {
      setPendingAction(null);
    }
  }, [activeTabId, setActiveTabId]);

  const handleToggleActivation = useCallback(async () => {
    if (!activeTabId) {
      toast.error("Create or select a workflow first");
      return;
    }
    const nextPendingAction = workflowLocked
      ? "deactivate-workflow"
      : "activate-workflow";
    setPendingAction(nextPendingAction);
    try {
      if (workflowLocked) {
        await deactivateWorkflowRequest(activeTabId);
        toast.success("Workflow deactivated");
      } else {
        await activateWorkflowRequest(activeTabId);
        toast.success("Workflow activated");
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : workflowLocked
            ? "Failed to deactivate workflow"
            : "Failed to activate workflow",
      );
    } finally {
      setPendingAction(null);
    }
  }, [activeTabId, workflowLocked]);

  const openCreateNodeDialog = useCallback(() => {
    if (!activeTabId) {
      toast.error("Create or select a workflow first");
      return;
    }
    if (workflowLocked) {
      toast.error("Deactivate workflow before editing");
      return;
    }
    setCreateNodeType("agent");
    setCreateNodeRoleName("Worker");
    setCreateNodeName("");
    setActiveDialog("create-node");
  }, [activeTabId, workflowLocked]);

  const handleCreateNode = useCallback(async () => {
    if (!activeTabId) {
      return;
    }
    if (workflowLocked) {
      toast.error("Deactivate workflow before editing");
      return;
    }
    const trimmedName = createNodeName.trim() || undefined;
    setPendingAction("create-node");
    try {
      if (createNodeType === "agent") {
        const roleName = selectedCreateNodeRole?.name ?? "";
        if (!roleName) {
          return;
        }
        await graphHistory.createStandaloneNode({
          tabId: activeTabId,
          nodeType: "agent",
          roleName,
          name: trimmedName,
        });
      } else {
        await graphHistory.createStandaloneNode({
          tabId: activeTabId,
          nodeType: createNodeType,
          name: trimmedName,
        });
      }
      setActiveDialog(null);
      setCreateNodeType("agent");
      setCreateNodeRoleName("Worker");
      setCreateNodeName("");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to create node",
      );
    } finally {
      setPendingAction(null);
    }
  }, [
    activeTabId,
    createNodeName,
    createNodeType,
    graphHistory,
    selectedCreateNodeRole?.name,
    workflowLocked,
  ]);

  const requestDeleteTab = useCallback(
    (tabId: string, title: string, nodeCount?: number) => {
      setDeleteTabTarget({ id: tabId, title, nodeCount });
    },
    [],
  );

  const handleDeleteTab = useCallback(async () => {
    if (!deleteTabTarget) {
      return;
    }
    setPendingAction("delete-tab");
    try {
      await deleteTabRequest(deleteTabTarget.id);
      setDeleteTabTarget(null);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete workflow",
      );
    } finally {
      setPendingAction(null);
    }
  }, [deleteTabTarget]);

  const openConnectDialog = useCallback(() => {
    if (!activeTabId) {
      toast.error("Create or select a workflow first");
      return;
    }
    if (workflowLocked) {
      toast.error("Deactivate workflow before editing");
      return;
    }
    if (workflowNodeOptions.length < 2) {
      toast.error("Add at least two nodes before creating an edge");
      return;
    }
    const initialSourceId = workflowNodeOptions[0]?.id ?? "";
    const initialTargetId =
      workflowNodeOptions.find((node) => node.id !== initialSourceId)?.id ?? "";
    if (!initialSourceId || !initialTargetId) {
      return;
    }
    setConnectSourceId(initialSourceId);
    setConnectTargetId(initialTargetId);
    setActiveDialog("connect-ports");
  }, [activeTabId, workflowLocked, workflowNodeOptions]);

  const handleConnectPorts = useCallback(async () => {
    if (
      !activeTabId ||
      !connectSourceId ||
      !connectSourcePortKey ||
      !connectTargetId ||
      !connectTargetPortKey
    ) {
      return;
    }
    if (workflowLocked) {
      toast.error("Deactivate workflow before editing");
      return;
    }
    setPendingAction("connect-ports");
    try {
      await graphHistory.createConnection(
        activeTabId,
        connectSourceId,
        connectTargetId,
        connectSourcePortKey,
        connectTargetPortKey,
      );
      setActiveDialog(null);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to connect ports",
      );
    } finally {
      setPendingAction(null);
    }
  }, [
    activeTabId,
    connectSourceId,
    connectSourcePortKey,
    connectTargetId,
    connectTargetPortKey,
    graphHistory,
    workflowLocked,
  ]);

  const handleSaveDefinition = useCallback(async () => {
    if (!activeTabId) {
      return;
    }
    if (workflowLocked) {
      toast.error("Deactivate workflow before editing");
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(definitionDraft);
    } catch {
      toast.error("Workflow JSON is invalid");
      return;
    }
    if (!parsed || typeof parsed !== "object") {
      toast.error("Workflow JSON must be an object");
      return;
    }
    setPendingAction("save-definition");
    try {
      await updateTabDefinitionRequest(
        activeTabId,
        parsed as typeof EMPTY_WORKFLOW_DEFINITION,
      );
      toast.success("Workflow JSON saved");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to save workflow definition",
      );
    } finally {
      setPendingAction(null);
    }
  }, [activeTabId, definitionDraft, workflowLocked]);

  return {
    activeDialog,
    activeTab,
    activeTabId,
    connected,
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
    graphHistory,
    graphRef,
    handleCloseLeaderDetails,
    handleConnectPorts,
    handleCreateNode,
    handleCreateTab,
    handleDeleteTab,
    handleDuplicateTab,
    handleOpenLeaderDetails,
    handleSaveDefinition,
    handleToggleActivation,
    isCompactWorkspace,
    isDragging,
    leaderDetailVisible,
    leaderNode,
    leaderPanelRunning,
    loadingRoles,
    openConnectDialog,
    openCreateNodeDialog,
    openCreateTabDialog,
    panelVisible,
    pendingAction,
    regularTabAgents,
    requestDeleteTab,
    resolvedPanelWidth,
    roles,
    selectAgent,
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
    sourcePortOptions,
    startDrag,
    tabs,
    targetPortOptions,
    togglePanel,
    workflowNodeOptions,
    workspaceRef,
    workflowLocked,
  };
}
