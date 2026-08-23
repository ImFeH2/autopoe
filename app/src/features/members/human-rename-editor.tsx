import { type FormEvent, useEffect, useReducer, useState } from "react";
import { Button, Input } from "@/components/ui";
import type { HumanMember } from "@/lib/backend";

export function humanRenameChanged(
  currentName: string,
  draft: string,
): boolean {
  return draft.trim() !== currentName;
}

export type HumanRenameFeedbackState = {
  draft: string;
  error: string | null;
  success: string | null;
};

type HumanRenameFeedbackAction =
  | { type: "edit"; value: string }
  | { type: "error"; message: string }
  | { type: "success"; name: string }
  | { type: "sync"; name: string };

export function reduceHumanRenameFeedback(
  state: HumanRenameFeedbackState,
  action: HumanRenameFeedbackAction,
): HumanRenameFeedbackState {
  switch (action.type) {
    case "edit":
      return { draft: action.value, error: null, success: null };
    case "error":
      return { ...state, error: action.message, success: null };
    case "success":
      return {
        draft: action.name,
        error: null,
        success: `Name changed to ${action.name}`,
      };
    case "sync":
      return { ...state, draft: action.name };
  }
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
  const [feedback, dispatch] = useReducer(reduceHumanRenameFeedback, {
    draft: human.name,
    error: null,
    success: null,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => dispatch({ type: "sync", name: human.name }), [human.name]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextName = feedback.draft.trim();
    if (!humanRenameChanged(human.name, feedback.draft)) {
      return;
    }
    setSaving(true);
    try {
      await onRename(human.id, feedback.draft);
      dispatch({ type: "success", name: nextName });
    } catch (reason) {
      dispatch({
        type: "error",
        message: reason instanceof Error ? reason.message : "Rename failed",
      });
    } finally {
      setSaving(false);
    }
  }

  const describedBy = feedback.error
    ? "human-formal-name-error"
    : feedback.success
      ? "human-formal-name-success"
      : undefined;

  return (
    <form aria-label="Rename current Human" onSubmit={submit}>
      <label htmlFor="human-formal-name">Formal name</label>
      <Input
        aria-describedby={describedBy}
        aria-invalid={feedback.error ? true : undefined}
        id="human-formal-name"
        value={feedback.draft}
        disabled={disabled || saving}
        onChange={(event) =>
          dispatch({ type: "edit", value: event.currentTarget.value })
        }
        autoComplete="off"
        required
      />
      {feedback.error ? (
        <p id="human-formal-name-error" role="alert">
          {feedback.error}
        </p>
      ) : null}
      {feedback.success ? (
        <p id="human-formal-name-success" role="status" aria-live="polite">
          {feedback.success}
        </p>
      ) : null}
      <Button
        type="submit"
        disabled={
          disabled || saving || !humanRenameChanged(human.name, feedback.draft)
        }
      >
        {saving ? "Saving…" : "Save name"}
      </Button>
    </form>
  );
}
