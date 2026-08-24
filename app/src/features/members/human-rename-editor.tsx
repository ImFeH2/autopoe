import { type FormEvent, useEffect, useReducer, useState } from "react";
import { Button, Input } from "@/components/ui";
import type { HumanMember, MemberNamePolicy } from "@/lib/backend";
import { FlowentRequestError } from "@/lib/flowent";
import {
  memberNameConstraints,
  memberNameCount,
  memberNameErrorMessage,
  memberNameValidationMessage,
} from "./member-name-policy";

export function humanRenameChanged(
  currentName: string,
  draft: string,
): boolean {
  return draft !== currentName;
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
  namePolicy: MemberNamePolicy;
  onRename: (memberId: number, name: string) => Promise<void>;
};

export function HumanRenameEditor({
  disabled = false,
  human,
  namePolicy,
  onRename,
}: HumanRenameEditorProps) {
  const [feedback, dispatch] = useReducer(reduceHumanRenameFeedback, {
    draft: human.name,
    error: null,
    success: null,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => dispatch({ type: "sync", name: human.name }), [human.name]);

  const changed = humanRenameChanged(human.name, feedback.draft);
  const validationError = changed
    ? memberNameValidationMessage(feedback.draft, namePolicy)
    : null;
  const count = memberNameCount(feedback.draft, namePolicy);
  const constraints = memberNameConstraints(namePolicy);
  const visibleError = validationError ?? feedback.error;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextName = feedback.draft;
    if (!changed) {
      return;
    }
    if (validationError) {
      dispatch({ type: "error", message: validationError });
      return;
    }
    setSaving(true);
    try {
      await onRename(human.id, feedback.draft);
      dispatch({ type: "success", name: nextName });
    } catch (reason) {
      dispatch({
        type: "error",
        message:
          reason instanceof FlowentRequestError
            ? (memberNameErrorMessage(reason.code, namePolicy) ??
              reason.message)
            : reason instanceof Error
              ? reason.message
              : "Rename failed",
      });
    } finally {
      setSaving(false);
    }
  }

  const describedBy =
    [
      "human-formal-name-constraints",
      count ? "human-formal-name-count" : null,
      visibleError ? "human-formal-name-error" : null,
      feedback.success ? "human-formal-name-success" : null,
    ]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <form aria-label="Rename current Human" onSubmit={submit}>
      <label htmlFor="human-formal-name">Formal name</label>
      <Input
        aria-describedby={describedBy}
        aria-invalid={visibleError ? true : undefined}
        id="human-formal-name"
        value={feedback.draft}
        disabled={disabled || saving}
        onChange={(event) =>
          dispatch({ type: "edit", value: event.currentTarget.value })
        }
        autoComplete="off"
        required
      />
      <span className="sr-only" id="human-formal-name-constraints">
        {constraints}
      </span>
      {count ? (
        <p id="human-formal-name-count" aria-live="polite">
          {count}
        </p>
      ) : null}
      {visibleError ? (
        <p id="human-formal-name-error" role="alert">
          {visibleError}
        </p>
      ) : null}
      {feedback.success ? (
        <p id="human-formal-name-success" role="status" aria-live="polite">
          {feedback.success}
        </p>
      ) : null}
      <Button
        type="submit"
        disabled={disabled || saving || !changed || validationError !== null}
      >
        {saving ? "Saving…" : "Save name"}
      </Button>
    </form>
  );
}
