import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Bot, GitPullRequestArrow, Repeat2, ShieldCheck } from "lucide-react";
import type { WorkflowNodeKind } from "@/types/workflow";

export interface WorkflowCardData extends Record<string, unknown> {
  label: string;
  kind: WorkflowNodeKind;
  agentName?: string;
  model?: string;
  dependencies: number;
  maxIterations?: number;
}

export type WorkflowFlowNode = Node<WorkflowCardData, "workflowNode">;

const kindIcons = {
  agent: Bot,
  loop: Repeat2,
  approval: ShieldCheck,
};

const kindLabels = {
  agent: "Agent",
  loop: "Loop",
  approval: "Gate",
};

export const WorkflowNodeCard = memo(function WorkflowNodeCard({
  data,
  selected,
}: NodeProps<WorkflowFlowNode>) {
  const Icon = kindIcons[data.kind];
  const detail =
    data.kind === "agent"
      ? data.agentName
      : data.kind === "loop"
        ? `${data.maxIterations ?? 1} iterations`
        : "User approval";

  return (
    <article
      className="workflow-node-card"
      data-kind={data.kind}
      data-selected={selected ? "true" : "false"}
    >
      <Handle
        className="workflow-handle"
        position={Position.Left}
        type="target"
      />
      <div className="node-card-head">
        <span className="node-icon" aria-hidden="true">
          <Icon size={15} strokeWidth={1.7} />
        </span>
        <span className="node-kind">{kindLabels[data.kind]}</span>
        {data.dependencies > 1 ? (
          <GitPullRequestArrow
            className="node-merge-icon"
            size={13}
            strokeWidth={1.6}
          />
        ) : null}
      </div>
      <strong>{data.label}</strong>
      <span className="node-detail">{detail}</span>
      {data.kind === "agent" && data.model ? (
        <span className="node-model">{data.model}</span>
      ) : null}
      <Handle
        className="workflow-handle"
        position={Position.Right}
        type="source"
      />
    </article>
  );
});
