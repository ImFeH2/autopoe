import { useRef, useState } from "react";
import { Theme } from "@radix-ui/themes";
import { ChatComposer } from "@/components/ChatComposer";
import { MessageList } from "@/components/MessageList";
import { Sidebar } from "@/components/Sidebar";
import { runAgent } from "@/lib/agent";
import type {
  AgentMessage,
  ChatMessage,
  RunEvent,
} from "@/types/agent";

const suggestions = ["Plan a feature", "Review a change", "Explain this code"];

let messageSequence = 0;

function createMessageId(role: ChatMessage["role"]) {
  messageSequence += 1;
  return `${role}-${Date.now()}-${messageSequence}`;
}

function getConversationTitle(messages: ChatMessage[]) {
  const firstUserMessage = messages.find((message) => message.role === "user");
  if (!firstUserMessage) {
    return "New conversation";
  }

  const title = firstUserMessage.content.trim();
  return title.length > 32 ? `${title.slice(0, 32)}…` : title;
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

function App() {
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

  function startNewConversation() {
    if (runningRef.current) {
      return;
    }
    setDraft("");
    setMessages([]);
  }

  return (
    <Theme
      accentColor="lime"
      appearance="dark"
      className="flowent-theme"
      grayColor="olive"
      radius="large"
      scaling="100%"
    >
      <main className="app-shell">
        <Sidebar
          disabled={isRunning}
          onNew={startNewConversation}
          title={getConversationTitle(messages)}
        />
        <section className="conversation">
          <header className="topbar">
            <div className="mobile-brand">
              <span className="brand-mark" aria-hidden="true">
                <span />
              </span>
              Flowent
            </div>
            <span className="conversation-title">
              {getConversationTitle(messages)}
            </span>
            <span className="demo-pill">Demo</span>
          </header>
          <div className="conversation-body">
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
          </div>
        </section>
      </main>
    </Theme>
  );
}

export default App;
