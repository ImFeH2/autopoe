import type { ReactNode } from "react";
import {
  Background,
  Handle,
  Position,
  ReactFlow,
  type Edge as FlowEdge,
  type Node as FlowNode,
  type NodeProps,
  type NodeTypes,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AnimatePresence, motion } from "motion/react";
import {
  BookCopy,
  Bot,
  LayoutPanelLeft,
  PanelRightClose,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import type {
  AgentBlueprint,
  BlueprintSlot,
  BlueprintVersionSummary,
  Role,
} from "@/types";
import { cn } from "@/lib/utils";
import { formatLocalTimestamp } from "@/lib/datetime";
import { PanelResizer } from "@/components/PanelResizer";
import {
  formInputClass,
  formTextareaClass,
} from "@/components/form/FormControls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MotionButton } from "@/components/motion-button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PageScaffold, PageTitleBar } from "@/components/layout/PageScaffold";
import type {
  BlueprintDraft,
  BlueprintViewModel,
} from "@/pages/blueprints/lib";
import { useBlueprintsPageState } from "@/pages/blueprints/useBlueprintsPageState";

const blueprintFormInputClass = `${formInputClass} text-foreground shadow-xs placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50`;
const blueprintFormTextareaClass = `min-h-[108px] ${formTextareaClass} text-foreground shadow-xs placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50`;
const blueprintChoiceListClass =
  "max-h-56 space-y-2 overflow-y-auto rounded-xl border border-border bg-background/35 p-2 scrollbar-none";

function BlueprintFlowNode({ data }: NodeProps) {
  interface BlueprintFlowNodeData extends Record<string, unknown> {
    label: string;
    roleName: string | null;
    selected: boolean;
  }

  const { label, roleName, selected } = data as BlueprintFlowNodeData;

  return (
    <div
      className={cn(
        "group relative min-w-[140px] rounded-xl border border-border bg-card/85 px-4 py-3 shadow-[0_18px_36px_-26px_var(--shell-scrim)] transition-[border-color,background-color,box-shadow] duration-200",
        selected
          ? "shadow-lg shadow-ring/10 ring-1 ring-ring/35"
          : "hover:border-ring/25 hover:bg-accent/20",
      )}
    >
      <Handle
        id="left-source"
        type="source"
        position={Position.Left}
        className="!top-[36%] !size-2 !-translate-y-1/2 !border-graph-handle-border !bg-graph-handle-bg !opacity-0"
      />
      <Handle
        id="left-target"
        type="target"
        position={Position.Left}
        className="!top-[64%] !size-2 !-translate-y-1/2 !border-graph-handle-border !bg-graph-handle-bg !opacity-0"
      />
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-accent/35 text-foreground/80">
          <Bot className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-foreground">
            {label}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground/80">
            {roleName}
          </p>
        </div>
      </div>
      <Handle
        id="right-source"
        type="source"
        position={Position.Right}
        className="!top-[36%] !size-2 !-translate-y-1/2 !border-graph-handle-border !bg-graph-handle-bg !opacity-0"
      />
      <Handle
        id="right-target"
        type="target"
        position={Position.Right}
        className="!top-[64%] !size-2 !-translate-y-1/2 !border-graph-handle-border !bg-graph-handle-bg !opacity-0"
      />
    </div>
  );
}

const nodeTypes: NodeTypes = {
  blueprint: BlueprintFlowNode,
};

function DrawerShell({
  align,
  children,
  onClose,
}: {
  align: "left" | "right";
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <>
      <MotionButton
        type="button"
        variant="ghost"
        aria-label="Close drawer"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        onClick={onClose}
        className="absolute inset-0 z-20 h-auto w-auto rounded-none border-0 bg-background/44 p-0 shadow-none backdrop-blur-[2px] hover:bg-background/44 focus-visible:ring-0"
      />
      <motion.aside
        initial={{ opacity: 0, x: align === "left" ? -20 : 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: align === "left" ? -20 : 20 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        className={cn(
          "absolute inset-y-0 z-30 w-[min(24rem,calc(100%-1.5rem))] overflow-hidden rounded-xl border border-border bg-popover shadow-md",
          align === "left" ? "left-0" : "right-0",
        )}
      >
        {children}
      </motion.aside>
    </>
  );
}

export function BlueprintsPage() {
  const {
    actions,
    blueprints,
    deletingBlueprintId,
    displayBlueprint,
    draft,
    flowGraph,
    handleFlowInit,
    inspectorOpen,
    inspectorWidth,
    isCompactLayout,
    isInspectorDragging,
    isLibraryDragging,
    libraryOpen,
    libraryWidth,
    loadingBlueprints,
    loadingRoles,
    roles,
    saving,
    selectedBlueprint,
    selectedBlueprintId,
    selectedSlot,
    startInspectorDrag,
    startLibraryDrag,
    versionHistory,
  } = useBlueprintsPageState();

  const libraryPanel = (
    <BlueprintLibraryColumn
      blueprints={blueprints}
      loading={loadingBlueprints}
      selectedBlueprintId={selectedBlueprintId}
      totalCount={blueprints.length}
      onCreateBlueprint={actions.beginCreateDraft}
      onSelectBlueprint={actions.selectBlueprint}
    />
  );

  const inspectorPanel = (
    <BlueprintInspectorColumn
      blueprint={displayBlueprint}
      deletingDisabled={!selectedBlueprint}
      draft={draft}
      roles={roles}
      loadingRoles={loadingRoles}
      saving={saving}
      selectedSlot={selectedSlot}
      versionHistory={versionHistory}
      onAddEdge={actions.addDraftEdge}
      onDeleteBlueprint={() => {
        if (!selectedBlueprint) {
          return;
        }
        actions.requestDeleteBlueprint(selectedBlueprint.id);
      }}
      onEditBlueprint={() => {
        if (!selectedBlueprint) {
          return;
        }
        actions.beginEditDraft(selectedBlueprint);
      }}
      onRemoveEdge={actions.removeDraftEdge}
      onRemoveSlot={actions.removeDraftSlot}
      onSave={actions.saveDraft}
      onSlotDescriptionChange={actions.updateDraftDescription}
      onSlotNameChange={actions.updateDraftName}
      onUpdateEdge={actions.updateDraftEdge}
      onUpdateSlot={actions.updateDraftSlot}
    />
  );

  return (
    <PageScaffold className="px-4 pb-4 pt-6 sm:px-5">
      <div className="flex h-full min-h-0 flex-col">
        <PageTitleBar
          title="Blueprints"
          actions={
            draft ? (
              <>
                <Button variant="outline" onClick={actions.cancelDraft}>
                  Cancel
                </Button>
                <Button
                  onClick={() => void actions.saveDraft()}
                  disabled={saving}
                >
                  <Save className="mr-1 size-4" />
                  {saving ? "Saving..." : "Save"}
                </Button>
              </>
            ) : (
              <Button onClick={actions.beginCreateDraft}>
                <Plus className="mr-1 size-4" />
                New Blueprint
              </Button>
            )
          }
        />

        <div className="relative mt-6 min-h-0 flex-1 overflow-hidden rounded-xl border border-border/60 bg-card/[0.14]">
          {isCompactLayout ? (
            <div className="relative h-full">
              <BlueprintStageColumn
                blueprint={displayBlueprint}
                compact
                nodes={flowGraph.nodes}
                edges={flowGraph.edges}
                onAddEdge={actions.addDraftEdge}
                onAddSlot={actions.addDraftSlot}
                onAutoLayout={actions.fitView}
                onInit={handleFlowInit}
                onLibraryToggle={actions.openLibrary}
                onFitView={actions.fitView}
                onInspectorToggle={actions.openInspector}
                onSelectNode={actions.selectNode}
              />
              <AnimatePresence>
                {libraryOpen ? (
                  <DrawerShell align="left" onClose={actions.closeLibrary}>
                    {libraryPanel}
                  </DrawerShell>
                ) : null}
              </AnimatePresence>
              <AnimatePresence>
                {inspectorOpen ? (
                  <DrawerShell align="right" onClose={actions.closeInspector}>
                    {inspectorPanel}
                  </DrawerShell>
                ) : null}
              </AnimatePresence>
            </div>
          ) : (
            <div className="flex h-full min-h-0">
              <aside
                className="relative shrink-0 border-r border-border"
                style={{ width: `${libraryWidth}px` }}
              >
                {libraryPanel}
                <PanelResizer
                  position="right"
                  isDragging={isLibraryDragging}
                  onMouseDown={startLibraryDrag}
                />
              </aside>

              <BlueprintStageColumn
                blueprint={displayBlueprint}
                edges={flowGraph.edges}
                nodes={flowGraph.nodes}
                onAddEdge={actions.addDraftEdge}
                onAddSlot={actions.addDraftSlot}
                onAutoLayout={actions.fitView}
                onFitView={actions.fitView}
                onInit={handleFlowInit}
                onSelectNode={actions.selectNode}
              />

              <aside
                className="relative shrink-0 border-l border-border"
                style={{ width: `${inspectorWidth}px` }}
              >
                {inspectorPanel}
                <PanelResizer
                  position="left"
                  isDragging={isInspectorDragging}
                  onMouseDown={startInspectorDrag}
                />
              </aside>
            </div>
          )}
        </div>
      </div>

      <AlertDialog
        open={Boolean(deletingBlueprintId)}
        onOpenChange={(open) => {
          if (!open) {
            actions.closeDeleteDialog();
          }
        }}
      >
        <AlertDialogContent className="max-w-[30rem]">
          <AlertDialogHeader className="gap-4">
            <div className="flex items-center gap-3">
              <div className="flex size-11 items-center justify-center rounded-xl border border-border bg-accent/45 text-foreground">
                <Trash2 className="size-5" />
              </div>
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground">
                  Destructive Action
                </p>
                <AlertDialogTitle className="mt-1 text-foreground">
                  Delete blueprint?
                </AlertDialogTitle>
              </div>
            </div>
            <AlertDialogDescription className="text-muted-foreground">
              {selectedBlueprint?.id === deletingBlueprintId ? (
                <>
                  Remove{" "}
                  <span className="font-semibold text-foreground">
                    {selectedBlueprint.name}
                  </span>{" "}
                  from the global library.
                </>
              ) : (
                "This blueprint will be removed from the library."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="outline">Cancel</Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                variant="destructive"
                onClick={() => void actions.confirmDeleteBlueprint()}
              >
                Delete Blueprint
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageScaffold>
  );
}

function BlueprintLibraryColumn({
  blueprints,
  loading,
  selectedBlueprintId,
  totalCount,
  onCreateBlueprint,
  onSelectBlueprint,
}: {
  blueprints: AgentBlueprint[];
  loading: boolean;
  selectedBlueprintId: string | null;
  totalCount: number;
  onCreateBlueprint: () => void;
  onSelectBlueprint: (blueprintId: string) => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-[13px] font-semibold text-muted-foreground/80">
                Library
              </p>
              <span className="rounded-full border border-border bg-accent/25 px-2 py-0.5 text-[10px] text-muted-foreground">
                {totalCount}
              </span>
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
              Browse and pick the latest blueprint revision.
            </p>
          </div>
          <Button size="sm" onClick={onCreateBlueprint}>
            <Plus className="mr-1 size-3.5" />
            New
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 scrollbar-none">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, index) => (
              <div
                key={index}
                className="rounded-xl border border-border bg-card/30 p-3"
              >
                <div className="h-3 w-28 rounded-full skeleton-shimmer" />
                <div className="mt-3 h-2.5 w-full rounded-full skeleton-shimmer" />
                <div className="mt-2 h-2.5 w-2/3 rounded-full skeleton-shimmer" />
              </div>
            ))}
          </div>
        ) : blueprints.length === 0 ? (
          <div className="flex h-full min-h-[15rem] items-center justify-center">
            <div className="max-w-[15rem] text-center">
              <div className="mx-auto flex size-12 items-center justify-center rounded-xl border border-border bg-accent/20 text-muted-foreground">
                <BookCopy className="size-5" />
              </div>
              <p className="mt-4 text-[15px] font-medium text-foreground">
                No blueprints
              </p>
              <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
                Start a reusable collaboration architecture from scratch.
              </p>
              <Button className="mt-4" onClick={onCreateBlueprint}>
                Create your first blueprint
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {blueprints.map((blueprint) => {
              const isSelected = blueprint.id === selectedBlueprintId;
              return (
                <Button
                  key={blueprint.id}
                  type="button"
                  variant="ghost"
                  onClick={() => onSelectBlueprint(blueprint.id)}
                  className={cn(
                    "group relative h-auto w-full flex-col items-stretch overflow-hidden rounded-xl border px-4 py-3 text-left transition-[background-color,border-color,transform] duration-180 hover:text-inherit",
                    isSelected
                      ? "border-border bg-accent/35"
                      : "border-transparent bg-transparent hover:border-border hover:bg-accent/20",
                  )}
                >
                  <div
                    aria-hidden="true"
                    className={cn(
                      "absolute inset-y-3 left-0 w-[3px] rounded-full transition-opacity",
                      isSelected
                        ? "bg-ring opacity-100"
                        : "bg-ring/60 opacity-0",
                    )}
                  />
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate text-[13px] font-medium text-foreground">
                      {blueprint.name}
                    </p>
                    <span className="text-[10px] text-muted-foreground/80">
                      v{blueprint.version}
                    </span>
                  </div>
                  <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                    {blueprint.description || "No description"}
                  </p>
                  <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground/75">
                    <span>{blueprint.node_count} slots</span>
                    <span>{blueprint.edge_count} connections</span>
                  </div>
                </Button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function BlueprintStageColumn({
  blueprint,
  compact = false,
  nodes,
  edges,
  onAddEdge,
  onAddSlot,
  onAutoLayout,
  onFitView,
  onInit,
  onInspectorToggle,
  onLibraryToggle,
  onSelectNode,
}: {
  blueprint: BlueprintViewModel | null;
  compact?: boolean;
  nodes: FlowNode[];
  edges: FlowEdge[];
  onAddEdge: () => void;
  onAddSlot: () => void;
  onAutoLayout: () => void;
  onFitView: () => void;
  onInit: (instance: ReactFlowInstance) => void;
  onInspectorToggle?: () => void;
  onLibraryToggle?: () => void;
  onSelectNode: (nodeId: string) => void;
}) {
  const hasDraft = Boolean(blueprint?.isDraft);

  return (
    <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="border-b border-border px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-[15px] font-semibold text-foreground">
                {blueprint
                  ? blueprint.name.trim() || "Untitled Blueprint"
                  : "Blueprint Stage"}
              </h2>
              {blueprint?.isDraft ? (
                <span className="rounded-full border border-border bg-accent/25 px-2 py-0.5 text-[10px] text-muted-foreground">
                  {blueprint.version == null
                    ? "New Draft"
                    : `Draft from v${blueprint.version}`}
                </span>
              ) : blueprint?.version != null ? (
                <span className="rounded-full border border-border bg-accent/25 px-2 py-0.5 text-[10px] text-muted-foreground">
                  v{blueprint.version}
                </span>
              ) : null}
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
              {blueprint
                ? `${blueprint.slots.length} slots · ${blueprint.edges.length} connections`
                : "Select a blueprint from the library or start a new draft."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {compact ? (
              <>
                <Button variant="outline" size="sm" onClick={onLibraryToggle}>
                  <LayoutPanelLeft className="mr-1 size-3.5" />
                  Library
                </Button>
                <Button variant="outline" size="sm" onClick={onInspectorToggle}>
                  <PanelRightClose className="mr-1 size-3.5" />
                  Inspector
                </Button>
              </>
            ) : null}
            {hasDraft ? (
              <>
                <Button size="sm" variant="outline" onClick={onAddSlot}>
                  <Plus className="mr-1 size-3.5" />
                  Add Slot
                </Button>
                <Button size="sm" variant="outline" onClick={onAddEdge}>
                  <Plus className="mr-1 size-3.5" />
                  Add Connection
                </Button>
                <Button size="sm" variant="outline" onClick={onFitView}>
                  Fit View
                </Button>
                <Button size="sm" variant="outline" onClick={onAutoLayout}>
                  Auto Layout
                </Button>
              </>
            ) : null}
          </div>
        </div>
      </div>

      {blueprint ? (
        <div
          className="min-h-0 flex-1"
          style={{
            background:
              "radial-gradient(circle at 14% 10%, var(--shell-spotlight-primary), transparent 24%), linear-gradient(180deg, color-mix(in srgb, var(--foreground) 1.4%, transparent), transparent 28%)",
          }}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onInit={onInit}
            onNodeClick={(_, node) => onSelectNode(node.id)}
            nodeTypes={nodeTypes}
            fitView
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
            panOnScroll
            minZoom={0.3}
            maxZoom={1.4}
            className="h-full bg-transparent"
          >
            <Background color="var(--graph-grid)" gap={28} size={0.72} />
          </ReactFlow>
        </div>
      ) : (
        <div className="flex h-full min-h-[24rem] items-center justify-center px-6">
          <div className="max-w-sm text-center">
            <div className="mx-auto flex size-14 items-center justify-center rounded-xl border border-border bg-accent/20 text-muted-foreground">
              <BookCopy className="size-5" />
            </div>
            <p className="mt-4 text-[15px] font-medium text-foreground">
              Pick a blueprint or start a new draft
            </p>
            <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
              The stage previews slot topology here so the collaboration
              structure stays readable before you create a workflow.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

function BlueprintInspectorColumn({
  blueprint,
  deletingDisabled,
  draft,
  roles,
  loadingRoles,
  saving,
  selectedSlot,
  versionHistory,
  onAddEdge,
  onDeleteBlueprint,
  onEditBlueprint,
  onRemoveEdge,
  onRemoveSlot,
  onSave,
  onSlotDescriptionChange,
  onSlotNameChange,
  onUpdateEdge,
  onUpdateSlot,
}: {
  blueprint: BlueprintViewModel | null;
  deletingDisabled: boolean;
  draft: BlueprintDraft | null;
  roles: Role[];
  loadingRoles: boolean;
  saving: boolean;
  selectedSlot: BlueprintSlot | null;
  versionHistory: BlueprintVersionSummary[];
  onAddEdge: () => void;
  onDeleteBlueprint: () => void;
  onEditBlueprint: () => void;
  onRemoveEdge: (index: number) => void;
  onRemoveSlot: (slotId: string) => void;
  onSave: () => void;
  onSlotDescriptionChange: (value: string) => void;
  onSlotNameChange: (value: string) => void;
  onUpdateEdge: (
    index: number,
    field: "from_slot_id" | "to_slot_id",
    value: string,
  ) => void;
  onUpdateSlot: (
    slotId: string,
    field: "role_name" | "display_name",
    value: string,
  ) => void;
}) {
  if (!blueprint) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-[12px] leading-relaxed text-muted-foreground">
        Inspector shows blueprint details here once you select a blueprint or a
        slot.
      </div>
    );
  }

  const edgeTargets = blueprint.slots.map((slot) => ({
    id: slot.id,
    label: slot.display_name || slot.role_name || slot.id,
  }));

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[13px] font-semibold text-muted-foreground/80">
              {selectedSlot ? "Slot Inspector" : "Inspector"}
            </p>
            <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
              {selectedSlot
                ? "Inspect or edit the selected slot."
                : "Review blueprint metadata, connections, and version summary."}
            </p>
          </div>
          {draft ? (
            <Button size="sm" onClick={onSave} disabled={saving}>
              <Save className="mr-1 size-3.5" />
              {saving ? "Saving..." : "Save"}
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={onEditBlueprint}>
                Edit
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={deletingDisabled}
                onClick={onDeleteBlueprint}
              >
                Delete
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 scrollbar-none">
        {selectedSlot ? (
          <div className="space-y-4">
            <InspectorSection title="Slot Key">
              <div className="rounded-md border border-border bg-background/40 px-3 py-2 font-mono text-[12px] text-foreground/80">
                {selectedSlot.id}
              </div>
            </InspectorSection>
            {draft ? (
              <>
                <InspectorSection title="Role">
                  <div className="space-y-3">
                    <div className={blueprintChoiceListClass}>
                      {loadingRoles ? (
                        <p className="px-2 py-3 text-[12px] text-muted-foreground">
                          Loading roles...
                        </p>
                      ) : roles.length === 0 ? (
                        <p className="px-2 py-3 text-[12px] text-muted-foreground">
                          No roles available.
                        </p>
                      ) : (
                        roles.map((role) => (
                          <Button
                            key={role.name}
                            type="button"
                            variant="ghost"
                            onClick={() =>
                              onUpdateSlot(
                                selectedSlot.id,
                                "role_name",
                                role.name,
                              )
                            }
                            className={cn(
                              "h-auto w-full flex-col items-stretch rounded-md border px-3 py-2.5 text-left transition-colors hover:text-inherit",
                              selectedSlot.role_name === role.name
                                ? "border-border bg-accent/35"
                                : "border-transparent bg-transparent hover:border-border hover:bg-accent/20",
                            )}
                          >
                            <div className="text-[13px] font-medium text-foreground">
                              {role.name}
                            </div>
                            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                              {role.description}
                            </p>
                          </Button>
                        ))
                      )}
                    </div>
                  </div>
                </InspectorSection>
                <InspectorSection title="Display Name">
                  <Input
                    aria-label="Slot display name"
                    value={selectedSlot.display_name ?? ""}
                    onChange={(event) =>
                      onUpdateSlot(
                        selectedSlot.id,
                        "display_name",
                        event.target.value,
                      )
                    }
                    placeholder={selectedSlot.role_name}
                    className={blueprintFormInputClass}
                  />
                </InspectorSection>
                <Button
                  variant="destructive"
                  className="w-full"
                  onClick={() => onRemoveSlot(selectedSlot.id)}
                >
                  <Trash2 className="mr-1 size-4" />
                  Remove Slot
                </Button>
              </>
            ) : (
              <>
                <InspectorSection title="Role">
                  <div className="rounded-md border border-border bg-background/40 px-3 py-2 text-[13px] text-foreground">
                    {selectedSlot.role_name}
                  </div>
                </InspectorSection>
                <InspectorSection title="Display Name">
                  <div className="rounded-md border border-border bg-background/40 px-3 py-2 text-[13px] text-foreground">
                    {selectedSlot.display_name || selectedSlot.role_name}
                  </div>
                </InspectorSection>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <InspectorSection title="Name">
              {draft ? (
                <Input
                  aria-label="Blueprint name"
                  value={blueprint.name}
                  onChange={(event) => onSlotNameChange(event.target.value)}
                  placeholder="Review Pipeline"
                  className={blueprintFormInputClass}
                />
              ) : (
                <div className="rounded-md border border-border bg-background/40 px-3 py-2 text-[13px] text-foreground">
                  {blueprint.name}
                </div>
              )}
            </InspectorSection>

            <InspectorSection title="Description">
              {draft ? (
                <Textarea
                  aria-label="Blueprint description"
                  value={blueprint.description}
                  onChange={(event) =>
                    onSlotDescriptionChange(event.target.value)
                  }
                  placeholder="Describe the reusable collaboration structure."
                  className={blueprintFormTextareaClass}
                />
              ) : (
                <div className="rounded-md border border-border bg-background/40 px-3 py-3 text-[13px] leading-relaxed text-foreground/80">
                  {blueprint.description || "No description"}
                </div>
              )}
            </InspectorSection>

            <InspectorSection title="Summary">
              <div className="grid gap-2">
                <SummaryRow label="Version">
                  {blueprint.version == null
                    ? "New draft"
                    : `v${blueprint.version}`}
                </SummaryRow>
                <SummaryRow label="Slots">{blueprint.slots.length}</SummaryRow>
                <SummaryRow label="Connections">
                  {blueprint.edges.length}
                </SummaryRow>
                <SummaryRow label="Structure">
                  {blueprint.slots.length} slot
                  {blueprint.slots.length === 1 ? "" : "s"}
                </SummaryRow>
              </div>
            </InspectorSection>

            <InspectorSection title="Version Summary">
              <div className="space-y-2">
                {versionHistory.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border px-3 py-3 text-[12px] text-muted-foreground">
                    Version history starts after the first save.
                  </div>
                ) : (
                  [...versionHistory]
                    .slice()
                    .reverse()
                    .map((item) => (
                      <div
                        key={`${item.version}-${item.updated_at}`}
                        className="rounded-xl border border-border bg-background/35 px-3 py-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[13px] font-medium text-foreground">
                            v{item.version}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {formatLocalTimestamp(item.updated_at, {
                              fallback: "Unknown",
                            })}
                          </span>
                        </div>
                      </div>
                    ))
                )}
              </div>
            </InspectorSection>

            <InspectorSection title="Connections">
              <div className="space-y-3">
                {draft ? (
                  <Button size="sm" variant="outline" onClick={onAddEdge}>
                    <Plus className="mr-1 size-3.5" />
                    Add Connection
                  </Button>
                ) : null}
                {blueprint.edges.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border px-3 py-3 text-[12px] text-muted-foreground">
                    No connections in this blueprint.
                  </div>
                ) : (
                  blueprint.edges.map((edge, index) => (
                    <div
                      key={`${edge.from_slot_id}-${edge.to_slot_id}-${index}`}
                      className="rounded-xl border border-border bg-background/35 p-3"
                    >
                      {draft ? (
                        <div className="space-y-3">
                          <div className="grid gap-3">
                            <Select
                              value={edge.from_slot_id}
                              onValueChange={(value) =>
                                onUpdateEdge(index, "from_slot_id", value)
                              }
                            >
                              <SelectTrigger
                                aria-label={`Connection endpoint A ${index + 1}`}
                                className={blueprintFormInputClass}
                              >
                                <SelectValue placeholder="Endpoint A" />
                              </SelectTrigger>
                              <SelectContent className="rounded-md border-border bg-popover text-popover-foreground">
                                {edgeTargets.map((target) => (
                                  <SelectItem key={target.id} value={target.id}>
                                    {target.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Select
                              value={edge.to_slot_id}
                              onValueChange={(value) =>
                                onUpdateEdge(index, "to_slot_id", value)
                              }
                            >
                              <SelectTrigger
                                aria-label={`Connection endpoint B ${index + 1}`}
                                className={blueprintFormInputClass}
                              >
                                <SelectValue placeholder="Endpoint B" />
                              </SelectTrigger>
                              <SelectContent className="rounded-md border-border bg-popover text-popover-foreground">
                                {edgeTargets.map((target) => (
                                  <SelectItem key={target.id} value={target.id}>
                                    {target.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => onRemoveEdge(index)}
                          >
                            <Trash2 className="mr-1 size-3.5" />
                            Remove Connection
                          </Button>
                        </div>
                      ) : (
                        <div className="text-[13px] text-foreground/82">
                          {edgeTargets.find(
                            (item) => item.id === edge.from_slot_id,
                          )?.label ?? edge.from_slot_id}{" "}
                          •{" "}
                          {edgeTargets.find(
                            (item) => item.id === edge.to_slot_id,
                          )?.label ?? edge.to_slot_id}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </InspectorSection>
          </div>
        )}
      </div>
    </div>
  );
}

function InspectorSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card/30 p-4">
      <div className="mb-3">
        <h3 className="text-[13px] font-medium text-foreground">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function SummaryRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-background/40 px-3 py-2.5 text-[12px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right text-foreground/80">{children}</span>
    </div>
  );
}
