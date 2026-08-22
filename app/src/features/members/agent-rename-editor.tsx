import { type FormEvent, useEffect, useRef, useState } from "react";
import { Button, Dialog, Input } from "@/components/ui";
import type { AgentMember } from "@/lib/backend";
import { FlowentRequestError } from "@/lib/flowent";
import {
  agentRenameConfirmationCopy,
  agentRenameDisabledReason,
  agentRenameInlineError,
  agentRenameSuccessCopy,
  canRenameAgent,
  hasAgentRenameBoundaryWhitespace,
} from "./agent-rename-policy";

type AgentRenameEditorProps = {
  agent: AgentMember;
  disabled?: boolean;
  onRename: (memberId: number, name: string) => Promise<void>;
};

export function AgentRenameEditor({
  agent,
  disabled = false,
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
  const confirmation = agentRenameConfirmationCopy(agent.name, draft);

  useEffect(() => {
    if (!saving && !canRenameAgent(agent.status)) {
      setConfirming(false);
    }
  }, [agent.status, saving]);

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
    if (hasAgentRenameBoundaryWhitespace(draft)) {
      setError(agentRenameInlineError("invalid_name"));
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
        ),
      );
      setConfirming(false);
      requestAnimationFrame(() => inputRef.current?.focus());
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
                onClick={() => setConfirming(false)}
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
                  error ? `agent-${agent.id}-rename-error` : undefined
                }
                aria-invalid={error ? "true" : undefined}
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
            {statusReason ? (
              <p className="caption-text m-0 text-danger" role="alert">
                {statusReason}
              </p>
            ) : null}
            {error ? (
              <p
                className="caption-text m-0 text-danger"
                id={`agent-${agent.id}-rename-error`}
                role="alert"
              >
                {error}
              </p>
            ) : null}
            <div className="member-agent-actions">
              <Button onClick={() => changeOpen(false)} variant="quiet">
                Cancel
              </Button>
              <Button
                disabled={saving || !changed}
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
