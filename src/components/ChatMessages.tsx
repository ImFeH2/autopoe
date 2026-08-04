import { CircleAlert, LoaderCircle } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { AgentInfo, ChatMessage, RuntimeState } from "@/lib/runtime";

interface ChatMessagesProps {
  agent: AgentInfo | null;
  connection: RuntimeState["connection"];
  error: string | null;
  messages: ChatMessage[];
  onInspect: () => void;
}

const agentStatusLabel = {
  idle: "Ready",
  running: "Working",
  failed: "Failed",
} as const;

export function ChatMessages({
  agent,
  connection,
  error,
  messages,
  onInspect,
}: ChatMessagesProps) {
  const agentName = agent?.name ?? "Leader";
  const state = agent
    ? agent.model
      ? agentStatusLabel[agent.status]
      : "No model"
    : connection === "connecting"
      ? "Connecting"
      : "Unavailable";

  if (error) {
    return (
      <div className="flex min-h-full items-center justify-center p-6">
        <Alert className="max-w-xl" variant="destructive">
          <CircleAlert />
          <AlertTitle>Runtime unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-full w-full max-w-4xl px-6 py-8">
      <section className="flex flex-col items-center gap-3 py-8 text-center">
        <Button
          aria-label={`Inspect ${agentName}`}
          disabled={!agent}
          onClick={onInspect}
          size="icon-lg"
          variant="ghost"
        >
          <Avatar>
            <AvatarImage alt="" src="/flowent.png" />
            <AvatarFallback>L</AvatarFallback>
          </Avatar>
        </Button>
        <h1 className="text-xl font-medium">{agentName}</h1>
        <Badge variant="secondary">{state}</Badge>
      </section>

      {messages.length > 0 ? (
        <div className="space-y-6 pb-8" aria-live="polite">
          {messages.map((message) =>
            message.author === "user" ? (
              <Card className="ml-auto max-w-[75%]" key={message.id} size="sm">
                <CardContent className="whitespace-pre-wrap leading-6">
                  {message.content}
                </CardContent>
              </Card>
            ) : (
              <article className="flex gap-3" key={message.id}>
                <Button
                  aria-label={`Inspect ${agentName}`}
                  disabled={!agent}
                  onClick={onInspect}
                  size="icon"
                  variant="ghost"
                >
                  <Avatar size="sm">
                    <AvatarImage alt="" src="/flowent.png" />
                    <AvatarFallback>L</AvatarFallback>
                  </Avatar>
                </Button>
                <div className="min-w-0 flex-1 pt-1">
                  <strong className="mb-1 block text-sm font-medium">
                    {agentName}
                  </strong>
                  {message.content ? (
                    <p className="whitespace-pre-wrap text-sm leading-6">
                      {message.content}
                    </p>
                  ) : (
                    <LoaderCircle
                      aria-label="Thinking"
                      className="animate-spin text-muted-foreground"
                      role="status"
                    />
                  )}
                </div>
              </article>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}
