import { type FormEvent, useEffect, useState } from "react";
import { Button, Input } from "@/components/ui";
import type { HumanMember } from "@/lib/backend";

export function humanRenameChanged(
  currentName: string,
  draft: string,
): boolean {
  return draft.trim() !== currentName;
}

type HumanRenameEditorProps = {
  disabled?: boolean;
  human: HumanMember;
  onRename: (memberId: number, name: string) => Promise<void>;
};

export function HumanRenameEditor({
  disabled = false,
  human,
  onRename,
}: HumanRenameEditorProps) {
  const [name, setName] = useState(human.name);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => setName(human.name), [human.name]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!humanRenameChanged(human.name, name)) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onRename(human.id, name);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Rename failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form aria-label="Rename current Human" onSubmit={submit}>
      <label htmlFor="human-formal-name">Formal name</label>
      <Input
        id="human-formal-name"
        value={name}
        disabled={disabled || saving}
        onChange={(event) => setName(event.currentTarget.value)}
        autoComplete="off"
        required
      />
      {error ? <p role="alert">{error}</p> : null}
      <Button
        type="submit"
        disabled={disabled || saving || !humanRenameChanged(human.name, name)}
      >
        {saving ? "Saving…" : "Save name"}
      </Button>
    </form>
  );
}
