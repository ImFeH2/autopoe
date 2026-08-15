import type { FormEvent, RefObject } from "react";
import { PageHeader } from "@/components/layout";
import { Button, Input, StatusIndicator } from "@/components/ui";
import { agentStatusTone } from "@/features/agent-status";
import type { AgentMember } from "@/lib/backend";

type AgentsPageProps = {
  agentName: string;
  agentNameInputRef: RefObject<HTMLInputElement | null>;
  agents: AgentMember[];
  disabled: boolean;
  onAgentNameChange: (name: string) => void;
  onCreateAgent: (event: FormEvent<HTMLFormElement>) => void;
  onRetryAgent: (agentId: number) => void;
};

export function AgentsPage({
  agentName,
  agentNameInputRef,
  agents,
  disabled,
  onAgentNameChange,
  onCreateAgent,
  onRetryAgent,
}: AgentsPageProps) {
  return (
    <section className="page-pane page-pane--agents">
      <PageHeader count={agents.length} title="Agents" />
      <form
        className="entity-create-form border-border border-b"
        aria-label="Create Agent"
        onSubmit={onCreateAgent}
      >
        <Input
          aria-label="Agent name"
          disabled={disabled}
          onChange={(event) => onAgentNameChange(event.target.value)}
          placeholder="Agent name"
          ref={agentNameInputRef}
          required
          value={agentName}
        />
        <Button disabled={disabled} type="submit" variant="primary">
          New
        </Button>
      </form>
      {agents.length === 0 ? (
        <div className="page-empty">
          <p className="body-compact m-0 text-text-tertiary">No Agents</p>
        </div>
      ) : (
        <ul className="entity-list">
          {agents.map((agent) => (
            <li key={agent.id}>
              <span
                className="entity-mark entity-mark--agent"
                aria-hidden="true"
              >
                {agent.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="entity-copy">
                <strong>{agent.name}</strong>
                <span>Agent {agent.id}</span>
              </span>
              <StatusIndicator tone={agentStatusTone(agent.status)}>
                {agent.status.toUpperCase()}
              </StatusIndicator>
              {agent.error ? (
                <div className="entity-error">
                  <span className="caption-text text-danger" role="alert">
                    {agent.error}
                  </span>
                  <Button
                    aria-label={`Retry ${agent.name}`}
                    disabled={disabled}
                    onClick={() => onRetryAgent(agent.id)}
                    size="compact"
                    variant="quiet"
                  >
                    Retry
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
