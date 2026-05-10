import {
  ConnectPortsDialog,
  CreateNodeDialog,
  CreateTabDialog,
  DeleteTabDialog,
} from "@/components/workspace/WorkspaceDialogs";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";
import { useWorkspacePageState } from "@/pages/workspace/useWorkspacePageState";

export function WorkspacePage() {
  const {
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
  } = useWorkspacePageState();

  return (
    <>
      <WorkspaceShell
        activeTabId={activeTabId}
        connected={connected}
        definitionDraft={definitionDraft}
        editorMode={editorMode}
        graphConnectMode={graphConnectMode}
        graphHistory={graphHistory}
        graphRef={graphRef}
        isCompactWorkspace={isCompactWorkspace}
        isDragging={isDragging}
        leaderDetailVisible={leaderDetailVisible}
        leaderNode={leaderNode}
        leaderPanelRunning={leaderPanelRunning}
        loadingRoles={loadingRoles}
        onCloseLeaderDetails={handleCloseLeaderDetails}
        onConnectModeChange={setGraphConnectMode}
        onCreateNode={openCreateNodeDialog}
        onCreateTab={openCreateTabDialog}
        onDefinitionDraftChange={setDefinitionDraft}
        onDeleteTab={requestDeleteTab}
        onEditorModeChange={setEditorMode}
        onOpenLeaderDetails={handleOpenLeaderDetails}
        onOpenConnectDialog={openConnectDialog}
        onSaveDefinition={handleSaveDefinition}
        onToggleActivation={handleToggleActivation}
        panelVisible={panelVisible}
        pendingAction={pendingAction}
        regularTabAgents={regularTabAgents}
        resolvedPanelWidth={resolvedPanelWidth}
        roles={roles}
        selectAgent={selectAgent}
        selectedAgent={selectedAgent}
        setActiveTabId={setActiveTabId}
        startDrag={startDrag}
        tabs={tabs}
        togglePanel={togglePanel}
        workflowNodeOptions={workflowNodeOptions}
        sourcePortOptions={sourcePortOptions}
        targetPortOptions={targetPortOptions}
        workspaceRef={workspaceRef}
        workflowLocked={workflowLocked}
      />

      <CreateTabDialog
        open={activeDialog === "create-tab"}
        onOpenChange={(open) => {
          if (!open) {
            setActiveDialog(null);
          }
        }}
        pending={pendingAction === "create-tab"}
        title={createTabTitle}
        onTitleChange={setCreateTabTitle}
        allowNetwork={createTabAllowNetwork}
        onAllowNetworkChange={setCreateTabAllowNetwork}
        writeDirs={createTabWriteDirs}
        onWriteDirsChange={setCreateTabWriteDirs}
        onSubmit={() => void handleCreateTab()}
      />

      <CreateNodeDialog
        open={activeDialog === "create-node"}
        onOpenChange={(open) => {
          if (!open) {
            setActiveDialog(null);
          }
        }}
        pending={pendingAction === "create-node"}
        activeTabTitle={activeTab?.title ?? null}
        nodeType={createNodeType}
        onNodeTypeChange={setCreateNodeType}
        selectedRoleName={createNodeRoleName}
        onRoleNameChange={setCreateNodeRoleName}
        roles={roles}
        loadingRoles={loadingRoles}
        nodeName={createNodeName}
        onNodeNameChange={setCreateNodeName}
        onSubmit={() => void handleCreateNode()}
        submitDisabled={
          !activeTabId ||
          pendingAction === "create-node" ||
          workflowLocked ||
          (createNodeType === "agent" && !selectedCreateNodeRole)
        }
      />

      <ConnectPortsDialog
        open={activeDialog === "connect-ports"}
        onOpenChange={(open) => {
          if (!open) {
            setActiveDialog(null);
          }
        }}
        pending={pendingAction === "connect-ports"}
        activeTabTitle={activeTab?.title ?? null}
        nodeOptions={workflowNodeOptions}
        fromNodeId={connectSourceId}
        fromPortKey={connectSourcePortKey}
        toNodeId={connectTargetId}
        toPortKey={connectTargetPortKey}
        fromPortOptions={sourcePortOptions}
        toPortOptions={targetPortOptions}
        onFromNodeChange={setConnectSourceId}
        onFromPortChange={setConnectSourcePortKey}
        onToNodeChange={setConnectTargetId}
        onToPortChange={setConnectTargetPortKey}
        onSubmit={() => void handleConnectPorts()}
      />

      <DeleteTabDialog
        open={Boolean(deleteTabTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTabTarget(null);
          }
        }}
        pending={pendingAction === "delete-tab"}
        target={deleteTabTarget}
        onDelete={() => void handleDeleteTab()}
      />
    </>
  );
}
