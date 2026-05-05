import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FormInput,
  formSelectTriggerClass,
} from "@/components/form/FormControls";
import type {
  ProviderModelEditorDraft,
  ProviderModelEditorState,
} from "@/pages/providers/lib";
import type { TriStateCapability } from "@/lib/triState";

interface ProviderModelDialogProps {
  draft: ProviderModelEditorDraft;
  onClose: () => void;
  onDraftChange: (draft: ProviderModelEditorDraft) => void;
  onSave: () => void;
  state: ProviderModelEditorState;
}

export function ProviderModelDialog({
  draft,
  onClose,
  onDraftChange,
  onSave,
  state,
}: ProviderModelDialogProps) {
  return (
    <Dialog
      open={state !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {state?.mode === "edit" ? "Edit Model" : "Add Model"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {state?.mode === "edit" ? "Edit Model" : "Add Model"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-5 py-4">
          <div className="space-y-2">
            <label className="text-[13px] font-medium text-foreground/80">
              Model ID
            </label>
            <FormInput
              aria-label="Model ID"
              value={draft.model}
              onChange={(event) =>
                onDraftChange({
                  ...draft,
                  model: event.target.value,
                })
              }
              placeholder="gpt-5"
              mono
            />
          </div>

          <div className="space-y-2">
            <label className="text-[13px] font-medium text-foreground/80">
              Source
            </label>
            <div className="rounded-md border border-border bg-card/30 px-3 py-2 text-[13px] text-foreground/80">
              {draft.source === "manual" ? "Manual" : "Discovered"}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[13px] font-medium text-foreground/80">
              Context Window
            </label>
            <div className="flex items-center gap-2">
              <FormInput
                aria-label="Context Window"
                inputMode="numeric"
                pattern="[0-9]*"
                value={draft.context_window_tokens}
                onChange={(event) => {
                  const nextValue = event.target.value.trim();
                  if (!/^\d*$/.test(nextValue)) {
                    return;
                  }
                  onDraftChange({
                    ...draft,
                    context_window_tokens: nextValue,
                  });
                }}
                placeholder="Optional"
                mono
              />
              <span className="text-[13px] font-medium text-muted-foreground">
                tokens
              </span>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <label className="text-[13px] font-medium text-foreground/80">
                Input Image
              </label>
              <Select
                value={draft.input_image}
                onValueChange={(value: TriStateCapability) =>
                  onDraftChange({
                    ...draft,
                    input_image: value,
                  })
                }
              >
                <SelectTrigger className={formSelectTriggerClass}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-border bg-popover">
                  <SelectItem value="auto">Auto</SelectItem>
                  <SelectItem value="enabled">Enabled</SelectItem>
                  <SelectItem value="disabled">Disabled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-[13px] font-medium text-foreground/80">
                Output Image
              </label>
              <Select
                value={draft.output_image}
                onValueChange={(value: TriStateCapability) =>
                  onDraftChange({
                    ...draft,
                    output_image: value,
                  })
                }
              >
                <SelectTrigger className={formSelectTriggerClass}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-border bg-popover">
                  <SelectItem value="auto">Auto</SelectItem>
                  <SelectItem value="enabled">Enabled</SelectItem>
                  <SelectItem value="disabled">Disabled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-[13px] font-medium text-foreground/80">
                Structured Output
              </label>
              <Select
                value={draft.structured_output ?? "auto"}
                onValueChange={(value: TriStateCapability) =>
                  onDraftChange({
                    ...draft,
                    structured_output: value,
                  })
                }
              >
                <SelectTrigger className={formSelectTriggerClass}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-border bg-popover">
                  <SelectItem value="auto">Auto</SelectItem>
                  <SelectItem value="enabled">Enabled</SelectItem>
                  <SelectItem value="disabled">Disabled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter className="px-5 pb-5">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSave}>
            {state?.mode === "edit" ? "Save Model" : "Add Model"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
