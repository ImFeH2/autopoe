import type { Role, WorkflowNodeType } from "@/types";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  WorkspaceCommandDialog,
  WorkspaceDialogField,
  WorkspaceDialogMeta,
} from "@/components/WorkspaceCommandDialog";
import { FormSwitch } from "@/components/form/FormControls";
import { RoleSearchPicker } from "@/components/workspace/RoleSearchPicker";

const workspaceDialogInputClass =
  "bg-background/40 text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50";
const createWorkflowInputClass =
  "border-white/10 bg-black text-white/90 shadow-none placeholder:text-white/35 focus-visible:border-white/35 focus-visible:ring-0 dark:bg-black";
const createWorkflowButtonClass =
  "border-white/10 bg-transparent text-white/70 hover:bg-white/10 hover:text-white";

export interface WorkspaceNodeOption {
  id: string;
  label: string;
}

export interface WorkspacePortOption {
  key: string;
  label: string;
}

interface CreateTabDialogProps {
  allowNetwork: boolean;
  onAllowNetworkChange: (nextValue: boolean) => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: () => void;
  onTitleChange: (nextValue: string) => void;
  onWriteDirsChange: (nextValue: string) => void;
  open: boolean;
  pending: boolean;
  title: string;
  writeDirs: string;
}

export function CreateTabDialog({
  allowNetwork,
  onAllowNetworkChange,
  onOpenChange,
  onSubmit,
  onTitleChange,
  onWriteDirsChange,
  open,
  pending,
  title,
  writeDirs,
}: CreateTabDialogProps) {
  return (
    <WorkspaceCommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Create Workflow"
      tone="black"
      bodyClassName="-mx-6 space-y-0 overflow-hidden border-t border-white/10 px-6 py-0"
      footer={
        <>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
            className={createWorkflowButtonClass}
          >
            Cancel
          </Button>
          <Button
            onClick={onSubmit}
            disabled={!title.trim() || pending}
            className="bg-white text-black hover:bg-white/90 disabled:bg-white/40 disabled:text-black/60"
          >
            {pending ? "Creating..." : "Create Workflow"}
          </Button>
        </>
      }
    >
      <WorkspaceDialogField label="Name" tone="black" className="py-4">
        <Input
          autoFocus
          aria-label="Workflow title"
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
          placeholder="e.g., Release checklist"
          className={cn("h-10 rounded-md", createWorkflowInputClass)}
        />
      </WorkspaceDialogField>
      <WorkspaceDialogField
        label="Internet access"
        hint="Allow this workflow to connect to the web."
        hintMode="tooltip"
        tone="black"
        className="border-t border-white/10 py-4"
      >
        <FormSwitch
          checked={allowNetwork}
          label="Internet access"
          onCheckedChange={onAllowNetworkChange}
        />
      </WorkspaceDialogField>
      <WorkspaceDialogField
        label="Folder access"
        hint="Folders where this workflow can save files."
        hintMode="tooltip"
        tone="black"
        className="border-t border-white/10 py-4"
      >
        <Textarea
          value={writeDirs}
          aria-label="Folder access"
          onChange={(event) => onWriteDirsChange(event.target.value)}
          placeholder="/workspace/output&#10;/workspace/cache"
          className={cn(
            "min-h-[80px] resize-none rounded-md font-mono text-[13px]",
            createWorkflowInputClass,
          )}
        />
      </WorkspaceDialogField>
    </WorkspaceCommandDialog>
  );
}

interface CreateNodeDialogProps {
  activeTabTitle: string | null;
  canCreateModelNode: boolean;
  nodeName: string;
  nodeType: WorkflowNodeType;
  roles: Role[];
  loadingRoles: boolean;
  onNodeNameChange: (nextValue: string) => void;
  onNodeTypeChange: (nextValue: WorkflowNodeType) => void;
  onOpenChange: (open: boolean) => void;
  onRoleNameChange: (nextValue: string) => void;
  onSubmit: () => void;
  open: boolean;
  pending: boolean;
  selectedRoleName: string;
  submitDisabled: boolean;
}

const workflowNodeTypeLabels: Record<WorkflowNodeType, string> = {
  agent: "Agent",
  trigger: "Trigger",
  llm: "Model",
  code: "Code",
  if: "If",
  merge: "Merge",
};

export function CreateNodeDialog({
  activeTabTitle,
  canCreateModelNode,
  nodeName,
  nodeType,
  roles,
  loadingRoles,
  onNodeNameChange,
  onNodeTypeChange,
  onOpenChange,
  onRoleNameChange,
  onSubmit,
  open,
  pending,
  selectedRoleName,
  submitDisabled,
}: CreateNodeDialogProps) {
  return (
    <WorkspaceCommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add Node"
      footer={
        <>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={submitDisabled}>
            {pending ? "Adding..." : "Add Node"}
          </Button>
        </>
      }
    >
      <WorkspaceDialogMeta>
        Adding a node to{" "}
        <span className="font-semibold text-foreground">
          {activeTabTitle ?? "No selected workflow"}
        </span>
      </WorkspaceDialogMeta>
      <WorkspaceDialogField label="Node Type" hint="Required">
        <Select
          value={nodeType}
          onValueChange={(value) => onNodeTypeChange(value as WorkflowNodeType)}
        >
          <SelectTrigger
            aria-label="Node Type"
            className={cn(
              "h-10 rounded-md data-[placeholder]:text-muted-foreground",
              workspaceDialogInputClass,
            )}
          >
            <SelectValue placeholder="Choose node type" />
          </SelectTrigger>
          <SelectContent className="rounded-md border-border bg-popover text-popover-foreground">
            {(
              Object.entries(workflowNodeTypeLabels) as Array<
                [WorkflowNodeType, string]
              >
            ).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </WorkspaceDialogField>
      {nodeType === "agent" ? (
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-medium text-foreground/80">Role</span>
            <span className="text-xs text-muted-foreground">Required</span>
          </div>
          <RoleSearchPicker
            roles={roles}
            loadingRoles={loadingRoles}
            selectedRoleName={selectedRoleName}
            onRoleNameChange={onRoleNameChange}
          />
        </div>
      ) : null}
      {nodeType === "llm" && !canCreateModelNode ? (
        <div className="rounded-lg border border-border bg-accent/35 px-3.5 py-2.5 text-xs text-muted-foreground">
          Choose a model in Settings before adding a Model node.
        </div>
      ) : null}
      <WorkspaceDialogField label="Display Name" hint="Optional">
        <Input
          value={nodeName}
          aria-label="Node display name"
          onChange={(event) => onNodeNameChange(event.target.value)}
          placeholder={
            nodeType === "agent"
              ? "Docs Worker"
              : `${workflowNodeTypeLabels[nodeType]} Node`
          }
          className={cn("h-10 rounded-md", workspaceDialogInputClass)}
        />
      </WorkspaceDialogField>
    </WorkspaceCommandDialog>
  );
}

interface ConnectPortsDialogProps {
  activeTabTitle: string | null;
  nodeOptions: WorkspaceNodeOption[];
  onFromNodeChange: (nextValue: string) => void;
  onFromPortChange: (nextValue: string) => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: () => void;
  onToNodeChange: (nextValue: string) => void;
  onToPortChange: (nextValue: string) => void;
  open: boolean;
  pending: boolean;
  fromNodeId: string;
  fromPortKey: string;
  toNodeId: string;
  toPortKey: string;
  fromPortOptions: WorkspacePortOption[];
  toPortOptions: WorkspacePortOption[];
}

export function ConnectPortsDialog({
  activeTabTitle,
  nodeOptions,
  onFromNodeChange,
  onFromPortChange,
  onOpenChange,
  onSubmit,
  onToNodeChange,
  onToPortChange,
  open,
  pending,
  fromNodeId,
  fromPortKey,
  toNodeId,
  toPortKey,
  fromPortOptions,
  toPortOptions,
}: ConnectPortsDialogProps) {
  return (
    <WorkspaceCommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Connect Ports"
      footer={
        <>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            onClick={onSubmit}
            disabled={
              !fromNodeId || !fromPortKey || !toNodeId || !toPortKey || pending
            }
          >
            {pending ? "Connecting..." : "Create Edge"}
          </Button>
        </>
      }
    >
      <WorkspaceDialogMeta>
        {activeTabTitle ? (
          <>
            Workflow{" "}
            <span className="font-semibold text-foreground">
              {activeTabTitle}
            </span>{" "}
            · {nodeOptions.length} nodes available
          </>
        ) : (
          "No selected workflow"
        )}
      </WorkspaceDialogMeta>
      <WorkspaceDialogField label="From Node" hint="Source node">
        <Select value={fromNodeId} onValueChange={onFromNodeChange}>
          <SelectTrigger
            aria-label="From Node"
            className={cn(
              "h-10 rounded-md data-[placeholder]:text-muted-foreground",
              workspaceDialogInputClass,
            )}
          >
            <SelectValue placeholder="Choose source node" />
          </SelectTrigger>
          <SelectContent className="rounded-md border-border bg-popover text-popover-foreground">
            {nodeOptions.map((node) => (
              <SelectItem key={node.id} value={node.id}>
                {node.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </WorkspaceDialogField>
      <WorkspaceDialogField label="From Port" hint="Output port">
        <Select value={fromPortKey} onValueChange={onFromPortChange}>
          <SelectTrigger
            aria-label="From Port"
            className={cn(
              "h-10 rounded-md data-[placeholder]:text-muted-foreground",
              workspaceDialogInputClass,
            )}
          >
            <SelectValue placeholder="Choose output port" />
          </SelectTrigger>
          <SelectContent className="rounded-md border-border bg-popover text-popover-foreground">
            {fromPortOptions.map((port) => (
              <SelectItem key={port.key} value={port.key}>
                {port.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </WorkspaceDialogField>
      <WorkspaceDialogField label="To Node" hint="Target node">
        <Select value={toNodeId} onValueChange={onToNodeChange}>
          <SelectTrigger
            aria-label="To Node"
            className={cn(
              "h-10 rounded-md data-[placeholder]:text-muted-foreground",
              workspaceDialogInputClass,
            )}
          >
            <SelectValue placeholder="Choose target node" />
          </SelectTrigger>
          <SelectContent className="rounded-md border-border bg-popover text-popover-foreground">
            {nodeOptions
              .filter((node) => node.id !== fromNodeId)
              .map((node) => (
                <SelectItem key={node.id} value={node.id}>
                  {node.label}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </WorkspaceDialogField>
      <WorkspaceDialogField label="To Port" hint="Input port">
        <Select value={toPortKey} onValueChange={onToPortChange}>
          <SelectTrigger
            aria-label="To Port"
            className={cn(
              "h-10 rounded-md data-[placeholder]:text-muted-foreground",
              workspaceDialogInputClass,
            )}
          >
            <SelectValue placeholder="Choose input port" />
          </SelectTrigger>
          <SelectContent className="rounded-md border-border bg-popover text-popover-foreground">
            {toPortOptions.map((port) => (
              <SelectItem key={port.key} value={port.key}>
                {port.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </WorkspaceDialogField>
    </WorkspaceCommandDialog>
  );
}

interface DeleteTabDialogProps {
  onDelete: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  pending: boolean;
  target: {
    id: string;
    title: string;
    nodeCount?: number;
    hasRunningNodes: boolean;
  } | null;
}

export function DeleteTabDialog({
  onDelete,
  onOpenChange,
  open,
  pending,
  target,
}: DeleteTabDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
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
                Delete workflow?
              </AlertDialogTitle>
            </div>
          </div>
          <AlertDialogDescription className="text-muted-foreground">
            {target ? (
              <>
                Remove{" "}
                <span className="font-semibold text-foreground">
                  {target.title}
                </span>{" "}
                and its saved workflow setup.
                {typeof target.nodeCount === "number"
                  ? ` ${target.nodeCount} node${target.nodeCount === 1 ? "" : "s"} will be removed with it.`
                  : ""}
                {target.hasRunningNodes
                  ? " Ongoing work will be stopped before the workflow is removed."
                  : ""}
              </>
            ) : (
              "This action cannot be undone."
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="outline">Cancel</Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button variant="destructive" onClick={onDelete} disabled={pending}>
              {pending ? "Deleting..." : "Delete Workflow"}
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
