import { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  Select,
  TextArea,
  TextField,
} from "@radix-ui/themes";
import { FolderGit2, Play } from "lucide-react";
import { runtimeRequest } from "@/lib/runtime";
import type {
  SettingsResponse,
  WorkspaceConfiguration,
} from "@/types/runtime";

export interface RunWorkflowInput {
  request: string;
  workspace: WorkspaceConfiguration;
}

interface RunWorkflowDialogProps {
  open: boolean;
  running: boolean;
  onOpenChange: (open: boolean) => void;
  onStart: (input: RunWorkflowInput) => Promise<void>;
}

export function RunWorkflowDialog({
  open,
  running,
  onOpenChange,
  onStart,
}: RunWorkflowDialogProps) {
  const [request, setRequest] = useState("");
  const [path, setPath] = useState("");
  const [mode, setMode] = useState<"direct" | "worktree">("worktree");
  const canStart = request.trim().length > 0 && path.trim().length > 0;

  useEffect(() => {
    if (!open) {
      return;
    }
    let active = true;
    void runtimeRequest<SettingsResponse>("settings.get")
      .then((response) => {
        if (active && response?.runtime) {
          setMode(response.runtime.default_workspace_mode);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [open]);

  async function start() {
    if (!canStart || running) {
      return;
    }
    try {
      await onStart({
        request: request.trim(),
        workspace: { path: path.trim(), mode, base_ref: "HEAD" },
      });
    } catch {
      return;
    }
  }

  return (
    <Dialog.Root onOpenChange={onOpenChange} open={open}>
      <Dialog.Content className="run-dialog" maxWidth="520px">
        <div className="dialog-title-row">
          <span className="dialog-icon">
            <Play fill="currentColor" size={15} strokeWidth={1.7} />
          </span>
          <Dialog.Title>Run workflow</Dialog.Title>
        </div>

        <div className="field-stack">
          <label className="field-label">
            <span>Request</span>
            <TextArea
              autoFocus
              onChange={(event) => setRequest(event.target.value)}
              placeholder="Build the requested change"
              resize="vertical"
              rows={5}
              value={request}
              variant="surface"
            />
          </label>
          <label className="field-label">
            <span>Repository</span>
            <TextField.Root
              onChange={(event) => setPath(event.target.value)}
              placeholder="/path/to/repository"
              value={path}
              variant="surface"
            >
              <TextField.Slot>
                <FolderGit2 size={14} strokeWidth={1.7} />
              </TextField.Slot>
            </TextField.Root>
          </label>
          <label className="field-label">
            <span>Workspace</span>
            <Select.Root
              onValueChange={(value) => setMode(value as "direct" | "worktree")}
              value={mode}
            >
              <Select.Trigger className="field-select" />
              <Select.Content>
                <Select.Item value="worktree">New worktree</Select.Item>
                <Select.Item value="direct">Use repository</Select.Item>
              </Select.Content>
            </Select.Root>
          </label>
        </div>

        <div className="dialog-actions">
          <Dialog.Close>
            <Button color="gray" disabled={running} variant="ghost">
              Cancel
            </Button>
          </Dialog.Close>
          <Button
            className="primary-button"
            disabled={!canStart}
            loading={running}
            onClick={() => void start()}
          >
            <Play fill="currentColor" size={13} strokeWidth={1.8} />
            Run
          </Button>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}
