import { useEffect, useState } from "react";
import useSWR from "swr";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { FormTextarea } from "@/components/form/FormControls";
import { PageScaffold, PageTitleBar } from "@/components/layout/PageScaffold";
import { PageLoadingState } from "@/components/layout/PageLoadingState";
import { Button } from "@/components/ui/button";
import { PanelCard, StatusChip } from "@/components/ui/surface";
import { fetchPromptSettings, savePromptSettings } from "@/lib/api";

const promptEditorTextareaClass =
  "min-h-0 w-full flex-1 resize-none select-text rounded-md bg-transparent p-3 font-mono text-[13px] leading-relaxed text-foreground placeholder:text-muted-foreground transition-colors focus:bg-background/35 focus:outline-none scrollbar-none";

export function PromptsPage() {
  const {
    data,
    isLoading: loading,
    mutate,
  } = useSWR("promptSettings", fetchPromptSettings);

  const [customPrompt, setCustomPrompt] = useState("");
  const [customPostPrompt, setCustomPostPrompt] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) {
      setCustomPrompt(data.custom_prompt);
      setCustomPostPrompt(data.custom_post_prompt);
    }
  }, [data]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        custom_prompt: customPrompt,
        custom_post_prompt: customPostPrompt,
      };
      const saved = await savePromptSettings(payload);
      void mutate(saved, false);
      toast.success("Prompts saved");
    } catch {
      toast.error("Failed to save prompts");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <PageLoadingState
        label="Loading prompts..."
        textClassName="text-[13px]"
      />
    );
  }

  return (
    <PageScaffold>
      <div className="mx-auto flex h-full w-full max-w-[800px] flex-col px-4 pb-10 pt-6">
        <PageTitleBar
          title="Prompts"
          hint="Custom Prompt is appended to the global system prompt layer. Custom Post Prompt is appended after the built-in runtime post prompt."
          actions={
            <Button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              size="sm"
              className="text-[13px]"
            >
              <Save className="size-4" />
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          }
        />
        <div className="grid min-h-0 flex-1 gap-8 pt-6">
          <div className="flex min-h-0 flex-col">
            <div className="mb-3 flex items-center justify-between px-1">
              <div className="flex items-center gap-3">
                <h2 className="text-[15px] font-medium text-foreground">
                  Custom Prompt
                </h2>
                <StatusChip tone="neutral" className="px-2 py-0.5">
                  {customPrompt.length} chars
                </StatusChip>
              </div>
              <p className="text-[12px] text-muted-foreground">
                Appended to every node's system prompt
              </p>
            </div>
            <PanelCard
              as="div"
              padding="none"
              className="relative flex min-h-0 flex-1 p-1"
            >
              <FormTextarea
                aria-label="Custom Prompt"
                value={customPrompt}
                onChange={(event) => setCustomPrompt(event.target.value)}
                placeholder="Add a custom prompt appended to every agent's system prompt..."
                className={promptEditorTextareaClass}
                mono
              />
            </PanelCard>
          </div>
          <div className="flex min-h-0 flex-col">
            <div className="mb-3 flex items-center justify-between px-1">
              <div className="flex items-center gap-3">
                <h2 className="text-[15px] font-medium text-foreground">
                  Custom Post Prompt
                </h2>
                <StatusChip tone="neutral" className="px-2 py-0.5">
                  {customPostPrompt.length} chars
                </StatusChip>
              </div>
              <p className="text-[12px] text-muted-foreground">
                Added after the built-in runtime post prompt
              </p>
            </div>
            <PanelCard
              as="div"
              padding="none"
              className="relative flex min-h-0 flex-1 p-1"
            >
              <FormTextarea
                aria-label="Custom Post Prompt"
                value={customPostPrompt}
                onChange={(event) => setCustomPostPrompt(event.target.value)}
                placeholder="Add custom runtime instructions appended after the built-in post prompt..."
                className={promptEditorTextareaClass}
                mono
              />
            </PanelCard>
          </div>
        </div>
      </div>
    </PageScaffold>
  );
}
