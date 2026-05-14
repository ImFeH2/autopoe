import { useState } from "react";
import { AssistantPanel } from "@/components/AssistantPanel";
import { AgentDetailPanel } from "@/components/workspace/WorkspacePanels";
import { useAgentNodesRuntime } from "@/context/AgentContext";
import { getAssistantNode } from "@/lib/assistant";

export function AssistantPage() {
  const { agents } = useAgentNodesRuntime();
  const assistantNode = getAssistantNode(agents);
  const [detailsOpen, setDetailsOpen] = useState(false);

  return (
    <div className="flex h-full flex-col min-h-0">
      {detailsOpen && assistantNode ? (
        <div className="h-full overflow-hidden p-6">
          <div className="h-full overflow-hidden rounded-xl border border-border bg-surface-overlay/90">
            <AgentDetailPanel
              agent={assistantNode}
              onClose={() => setDetailsOpen(false)}
            />
          </div>
        </div>
      ) : (
        <AssistantPanel
          onOpenDetails={assistantNode ? () => setDetailsOpen(true) : undefined}
        />
      )}
    </div>
  );
}
