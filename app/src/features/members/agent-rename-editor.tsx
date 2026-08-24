import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button, Dialog, Input } from "@/components/ui";
import type { AgentMember, MemberNamePolicy } from "@/lib/backend";
import { FlowentRequestError } from "@/lib/flowent";
import {
  agentRenameConfirmationCopy,
  agentRenameDisabledReason,
  agentRenameInlineError,
  agentRenameSuccessCopy,
  canRenameAgent,
} from "./agent-rename-policy";
import {
  memberNameConstraints,
  memberNameCount,
  memberNameErrorMessage,
  memberNameValidationMessage,
} from "./member-name-policy";

type AgentRenameInput = Pick<HTMLInputElement, "focus" | "select">;
type ScheduleFrame = (callback: FrameRequestCallback) => number;

export function shouldReturnToAgentRenameEditor(
  confirming: boolean,
  saving: boolean,
  status: AgentMember["status"],
) {
  return confirming && !saving && !canRenameAgent(status);
}

export function returnToAgentRenameEditor(
  setConfirming: (confirming: false) => void,
  getInput: () => AgentRenameInput | null,
  scheduleFrame: ScheduleFrame = requestAnimationFrame,
) {
  setConfirming(false);
  scheduleFrame(() => {
    const input = getInput();
    input?.focus();
    input?.select();
  });
}

type AgentRenameEditorProps = {
  agent: AgentMember;
  disabled?: boolean;
  namePolicy: MemberNamePolicy;
  onRename: (memberId: number, name: string) => Promise<void>;
};

export function AgentRenameEditor({
  agent,
  disabled = false,
  namePolicy,
  onRename,
}: AgentRenameEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(agent.name);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState("");
  const statusReason = agentRenameDisabledReason(agent.status);
  const unavailable = disabled || !canRenameAgent(agent.status);
  const changed = draft !== agent.name;
  const validationError = changed
    ? memberNameValidationMessage(draft, namePolicy)
    : null;
  const count = memberNameCount(draft, namePolicy);
  const constraints = memberNameConstraints(namePolicy);
  const visibleError = validationError ?? error;
  const confirmation = agentRenameConfirmationCopy(agent.name, draft);

  const returnToEditor = useCallback(() => {
    returnToAgentRenameEditor(setConfirming, () => inputRef.current);
  }, []);

  useEffect(() => {
    if (shouldReturnToAgentRenameEditor(confirming, saving, agent.status)) {
      returnToEditor();
    }
  }, [agent.status, confirming, returnToEditor, saving]);

  function changeOpen(nextOpen: boolean) {
    if (saving) {
      return;
    }
    setOpen(nextOpen);
    setDraft(agent.name);
    setConfirming(false);
    setError(null);
  }

  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!changed) {
      return;
    }
    if (!canRenameAgent(agent.status)) {
      setError(agentRenameInlineError("agent_busy"));
      return;
    }
    if (validationError) {
      setError(validationError);
      inputRef.current?.focus();
      return;
    }
    setError(null);
    setConfirming(true);
  }

  async function confirm() {
    if (unavailable || !changed) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onRename(agent.id, draft);
      const copy = agentRenameSuccessCopy(agent.name, draft);
      setSuccess(copy.announcement);
      setOpen(false);
      setConfirming(false);
    } catch (reason) {
      setError(
        agentRenameInlineError(
          reason instanceof FlowentRequestError ? reason.code : "unknown",
          reason instanceof FlowentRequestError
            ? memberNameErrorMessage(reason.code, namePolicy)
            : null,
        ),
      );
      returnToEditor();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="member-rename">
      <Dialog
        description="Change this Agent's display name without changing its Member identity or history."
        onOpenAutoFocus={() => {
          inputRef.current?.select();
          return true;
        }}
        onOpenChange={changeOpen}
        open={open}
        title="Rename Agent"
        trigger={
          <Button
            aria-describedby={
              statusReason ? `agent-${agent.id}-rename-reason` : undefined
            }
            disabled={unavailable}
            variant="quiet"
          >
            Rename
          </Button>
        }
        triggerTooltip={statusReason ?? "Rename Agent"}
      >
        {confirming ? (
          <div className="member-delete-confirmation">
            <h3>{confirmation.title}</h3>
            <p>{confirmation.description}</p>
            {statusReason ? (
              <p className="caption-text text-danger" role="alert">
                {statusReason}
              </p>
            ) : null}
            <div className="member-agent-actions">
              <Button
                disabled={saving}
                onClick={returnToEditor}
                variant="quiet"
              >
                Back
              </Button>
              <Button
                disabled={saving || unavailable}
                onClick={() => void confirm()}
                variant="primary"
              >
                {saving ? "Renaming…" : "Confirm rename"}
              </Button>
            </div>
          </div>
        ) : (
          <form aria-label={`Rename ${agent.name}`} onSubmit={review}>
            <label
              className="member-agent-field"
              htmlFor={`agent-${agent.id}-rename`}
            >
              <span>Name</span>
              <Input
                aria-describedby={
                  [
                    `agent-${agent.id}-rename-constraints`,
                    count ? `agent-${agent.id}-rename-count` : null,
                    visibleError ? `agent-${agent.id}-rename-error` : null,
                  ]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
                aria-invalid={visibleError ? "true" : undefined}
                autoComplete="off"
                disabled={saving}
                id={`agent-${agent.id}-rename`}
                onChange={(event) => {
                  setDraft(event.currentTarget.value);
                  setError(null);
                }}
                ref={inputRef}
                required
                value={draft}
              />
            </label>
            <span
              className="sr-only"
              id={`agent-${agent.id}-rename-constraints`}
            >
              {constraints}
            </span>
            {count ? (
              <p
                className="caption-text m-0"
                id={`agent-${agent.id}-rename-count`}
                aria-live="polite"
              >
                {count}
              </p>
            ) : null}
            {statusReason ? (
              <p className="caption-text m-0 text-danger" role="alert">
                {statusReason}
              </p>
            ) : null}
            {visibleError ? (
              <p
                className="caption-text m-0 text-danger"
                id={`agent-${agent.id}-rename-error`}
                role="alert"
              >
                {visibleError}
              </p>
            ) : null}
            <div className="member-agent-actions">
              <Button onClick={() => changeOpen(false)} variant="quiet">
                Cancel
              </Button>
              <Button
                disabled={saving || !changed || validationError !== null}
                type="submit"
                variant="primary"
              >
                Review rename
              </Button>
            </div>
          </form>
        )}
      </Dialog>
      {statusReason ? (
        <p className="caption-text m-0" id={`agent-${agent.id}-rename-reason`}>
          {statusReason}
        </p>
      ) : null}
      <p aria-live="polite" className="caption-text m-0" role="status">
        {success}
      </p>
    </div>
  );
}
