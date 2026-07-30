import { useRef, useState } from "react";
import { ChatComposer } from "@/components/ChatComposer";
import { MessageList } from "@/components/MessageList";
import { runAgent } from "@/lib/agent";
import type { AgentMessage, ChatMessage, RunEvent } from "@/types/agent";

const suggestions = ["Plan a feature", "Review a change", "Explain this code"];

let messageSequence = 0;

function createMessageId(role: ChatMessage["role"]) {
  messageSequence += 1;
  return `${role}-${Date.now()}-${messageSequence}`;
}

function toAgentMessages(messages: ChatMessage[]): AgentMessage[] {
  return messages
    .filter(
      (message) =>
        message.content.trim().length > 0 &&
        (message.role === "user" || message.state === "completed"),
    )
    .map(({ role, content }) => ({ role, content }));
}

function applyRunEvent(
  messages: ChatMessage[],
  assistantId: string,
  event: RunEvent,
) {
  return messages.map((message) => {
    if (message.id !== assistantId) {
      return message;
    }
    switch (event.type) {
      case "started":
        return { ...message, state: "running" as const };
      case "text_delta":
        return {
          ...message,
          content: `${message.content}${event.delta}`,
          state: "running" as const,
        };
      case "completed":
        return { ...message, state: "completed" as const };
      case "failed":
        return {
          ...message,
          content: message.content || event.message,
          state: "failed" as const,
        };
      case "cancelled":
        return { ...message, state: "cancelled" as const };
    }
  });
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function ChatView() {
  const [draft, setDraft] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const runningRef = useRef(false);

  async function sendMessage(value = draft) {
    const content = value.trim();
    if (content.length === 0 || runningRef.current) {
      return;
    }
    runningRef.current = true;
    setIsRunning(true);
    setDraft("");

    const userMessage: ChatMessage = {
      id: createMessageId("user"),
      role: "user",
      content,
    };
    const assistantMessage: ChatMessage = {
      id: createMessageId("assistant"),
      role: "assistant",
      content: "",
      state: "pending",
    };
    const nextMessages = [...messages, userMessage];
    let terminalEventReceived = false;
    setMessages([...nextMessages, assistantMessage]);

    try {
      await runAgent(toAgentMessages(nextMessages), (event) => {
        if (
          event.type === "completed" ||
          event.type === "failed" ||
          event.type === "cancelled"
        ) {
          terminalEventReceived = true;
        }
        setMessages((current) =>
          applyRunEvent(current, assistantMessage.id, event),
        );
      });
    } catch (error) {
      if (!terminalEventReceived) {
        setMessages((current) =>
          applyRunEvent(current, assistantMessage.id, {
            type: "failed",
            message: getErrorMessage(error),
          }),
        );
      }
    } finally {
      runningRef.current = false;
      setIsRunning(false);
    }
  }

  return (
    <section className="chat-view">
      <MessageList
        disabled={isRunning}
        messages={messages}
        onSuggestion={(suggestion) => void sendMessage(suggestion)}
        suggestions={suggestions}
      />
      <ChatComposer
        disabled={isRunning}
        onChange={setDraft}
        onSubmit={() => void sendMessage()}
        value={draft}
      />
    </section>
  );
}
