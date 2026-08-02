import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import type { AgentInfo, TurnSnapshot } from "@/lib/runtime";

interface ContextInspectorProps {
  agent: AgentInfo;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  turn: TurnSnapshot | null;
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-64 max-w-full overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-3 font-mono text-xs">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function ContextInspector({
  agent,
  onOpenChange,
  open,
  turn,
}: ContextInspectorProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle>{agent.name}</DialogTitle>
            <Badge variant="secondary">{agent.status}</Badge>
          </div>
          <DialogDescription>Agent context</DialogDescription>
        </DialogHeader>

        <ScrollArea className="h-[70vh] w-full min-w-0 pr-4">
          <div className="min-w-0 space-y-6">
            <section className="space-y-3">
              <h3 className="font-medium">Identity</h3>
              <dl className="grid grid-cols-[5rem_1fr] gap-2 text-sm">
                <dt className="text-muted-foreground">Role</dt>
                <dd>{agent.role}</dd>
                <dt className="text-muted-foreground">Model</dt>
                <dd className="font-mono text-xs">{agent.model}</dd>
                <dt className="text-muted-foreground">Home</dt>
                <dd className="break-all font-mono text-xs">{agent.home}</dd>
              </dl>
            </section>

            {turn ? (
              <>
                <Separator />
                <section className="space-y-3">
                  <h3 className="font-medium">Loaded Context</h3>
                  <div className="space-y-1">
                    <span className="text-sm text-muted-foreground">Input</span>
                    <p className="text-sm leading-6">{turn.context.input}</p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-sm text-muted-foreground">
                      Instructions
                    </span>
                    <pre className="max-w-full whitespace-pre-wrap break-words rounded-lg bg-muted p-3 font-mono text-xs">
                      {turn.context.instructions || "Empty"}
                    </pre>
                  </div>
                  <div className="space-y-1">
                    <span className="text-sm text-muted-foreground">
                      Messages
                    </span>
                    <JsonBlock value={turn.context.messages} />
                  </div>
                  <div className="space-y-1">
                    <span className="text-sm text-muted-foreground">Tools</span>
                    <JsonBlock value={turn.context.tools} />
                  </div>
                </section>

                <Separator />
                <section className="space-y-3">
                  <h3 className="font-medium">Events</h3>
                  <JsonBlock value={turn.events} />
                </section>

                <Separator />
                <section className="space-y-3">
                  <h3 className="font-medium">Usage</h3>
                  <JsonBlock value={turn.usage} />
                </section>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No turns yet</p>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
