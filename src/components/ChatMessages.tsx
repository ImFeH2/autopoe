import { CircleAlert, LoaderCircle, MessageSquare } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { ChatInfo, ChatMessage } from "@/lib/chats";
import type { AgentInfo } from "@/lib/runtime";

interface ChatMessagesProps {
  agents: AgentInfo[];
  chat: ChatInfo;
  error: string | null;
  messages: ChatMessage[];
  onInspect: (agentId: string) => void;
}

export function ChatMessages({
  agents,
  chat,
  error,
  messages,
  onInspect,
}: ChatMessagesProps) {
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
      {messages.length > 0 ? (
        <div className="space-y-6 pb-8" aria-live="polite">
          {messages.map((message) => {
            if (message.author === "user") {
              return (
                <Card
                  className="ml-auto max-w-[75%]"
                  key={message.id}
                  size="sm"
                >
                  <CardContent className="whitespace-pre-wrap leading-6">
                    {message.content}
                  </CardContent>
                </Card>
              );
            }
            const author = agents.find((agent) => agent.id === message.author);
            const authorName = author?.name ?? "Flowent";
            return (
              <article className="flex gap-3" key={message.id}>
                <Button
                  aria-label={`Inspect ${authorName}`}
                  disabled={!author}
                  onClick={() => author && onInspect(author.id)}
                  size="icon"
                  variant="ghost"
                >
                  <Avatar size="sm">
                    <AvatarImage alt="" src="/flowent.png" />
                    <AvatarFallback>
                      {authorName.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                </Button>
                <div className="min-w-0 flex-1 pt-1">
                  <strong className="mb-1 block text-sm font-medium">
                    {authorName}
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
            );
          })}
        </div>
      ) : (
        <section className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
          <MessageSquare className="size-6 text-muted-foreground" />
          <h1 className="text-xl font-medium">{chat.title}</h1>
          {chat.purpose ? (
            <p className="max-w-md text-sm text-muted-foreground">
              {chat.purpose}
            </p>
          ) : null}
          <Badge variant="secondary">
            {chat.members.length}{" "}
            {chat.members.length === 1 ? "member" : "members"}
          </Badge>
        </section>
      )}
    </div>
  );
}
