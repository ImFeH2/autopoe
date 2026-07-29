import { useEffect, useRef } from "react";
import { Button, ScrollArea } from "@radix-ui/themes";
import { SparkIcon } from "@/components/Icons";
import type { ChatMessage } from "@/types/agent";

interface MessageListProps {
  disabled: boolean;
  messages: ChatMessage[];
  suggestions: string[];
  onSuggestion: (suggestion: string) => void;
}

function AssistantMark() {
  return (
    <span className="assistant-mark" aria-hidden="true">
      <span />
    </span>
  );
}

function ThinkingIndicator() {
  return (
    <span className="thinking" aria-label="Thinking">
      <span />
      <span />
      <span />
    </span>
  );
}

export function MessageList({
  disabled,
  messages,
  suggestions,
  onSuggestion,
}: MessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages]);

  return (
    <ScrollArea className="message-scroll" scrollbars="vertical" type="auto">
      {messages.length === 0 ? (
        <div className="empty-state">
          <div className="empty-orbit" aria-hidden="true">
            <span className="empty-orbit-core" />
            <span className="empty-orbit-ring" />
          </div>
          <h1>What should we work on?</h1>
          <div className="suggestions">
            {suggestions.map((suggestion) => (
              <Button
                className="suggestion"
                color="gray"
                disabled={disabled}
                highContrast
                key={suggestion}
                onClick={() => onSuggestion(suggestion)}
                variant="soft"
              >
                <SparkIcon />
                {suggestion}
              </Button>
            ))}
          </div>
        </div>
      ) : (
        <div className="messages" role="log" aria-live="polite">
          {messages.map((message) =>
            message.role === "user" ? (
              <article className="message-row message-row-user" key={message.id}>
                <div className="user-message">{message.content}</div>
              </article>
            ) : (
              <article
                className="message-row message-row-assistant"
                data-state={message.state}
                key={message.id}
              >
                <AssistantMark />
                <div className="assistant-message">
                  {message.content.length > 0 ? (
                    <span>{message.content}</span>
                  ) : message.state === "running" || message.state === "pending" ? (
                    <ThinkingIndicator />
                  ) : null}
                  {message.state === "running" && message.content.length > 0 ? (
                    <span className="streaming-caret" aria-hidden="true" />
                  ) : null}
                </div>
              </article>
            ),
          )}
          <div ref={endRef} />
        </div>
      )}
    </ScrollArea>
  );
}
