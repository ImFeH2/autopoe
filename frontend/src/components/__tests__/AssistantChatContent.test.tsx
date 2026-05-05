import {
  createRef,
  type KeyboardEventHandler,
  type ReactElement,
  useState,
} from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AssistantChatComposer,
  AssistantChatMessages,
} from "@/components/AssistantChatContent";
import { ImageViewerProvider } from "@/components/ImageViewer";
import type { AssistantChatItem, Node } from "@/types";

afterEach(() => {
  cleanup();
});

function renderWithImageViewer(ui: ReactElement) {
  return render(<ImageViewerProvider>{ui}</ImageViewerProvider>);
}

function expectDocumentOrder(
  first: HTMLElement,
  second: HTMLElement,
  relation: number,
) {
  expect(first.compareDocumentPosition(second) & relation).toBeTruthy();
}

describe("AssistantChatMessages", () => {
  it("renders thinking and assistant text timeline items", () => {
    render(
      <AssistantChatMessages
        items={[
          {
            type: "AssistantThinking",
            content:
              "First, decide whether this needs a dedicated planning worker.",
            timestamp: 2,
            streaming: true,
          },
          {
            type: "AssistantText",
            content: "Here is a draft plan with priorities and next steps.",
            timestamp: 5,
          },
        ]}
        nodes={new Map()}
        onScroll={() => {}}
        scrollRef={createRef<HTMLDivElement>()}
      />,
    );

    expect(
      screen.getByRole("button", { name: /Thinking/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "First, decide whether this needs a dedicated planning worker.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Here is a draft plan with priorities and next steps."),
    ).toBeInTheDocument();
  });

  it("renders tool call disclosures and idle results", () => {
    const nodes = new Map<string, Node>([
      [
        "worker-1",
        {
          id: "worker-1",
          node_type: "agent",
          is_leader: false,
          state: "running",
          connections: [],
          name: "Project Analyst",
          todos: [],
          role_name: "Worker",
        },
      ],
    ]);
    const items: AssistantChatItem[] = [
      {
        type: "ToolCall",
        tool_name: "create_root",
        tool_call_id: "tool-1",
        arguments: { role: "Worker" },
        result: '{"agent_id":"worker-1"}',
        timestamp: 3,
        streaming: false,
      },
      {
        type: "ToolCall",
        tool_name: "idle",
        tool_call_id: "tool-2",
        arguments: {},
        timestamp: 4,
        streaming: true,
      },
      {
        type: "ToolCall",
        tool_name: "idle",
        tool_call_id: "tool-2b",
        arguments: {},
        result: "idle 1.25s",
        timestamp: 4,
        streaming: false,
      },
    ];

    render(
      <AssistantChatMessages
        items={items}
        nodes={nodes}
        onScroll={() => {}}
        scrollRef={createRef<HTMLDivElement>()}
      />,
    );

    expect(
      screen.getByRole("button", { name: /Create Root/i }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Create Root/i }));
    expect(
      screen.getByText(
        (_, element) => element?.textContent === '{\n    "role": "Worker"\n}',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        (_, element) =>
          element?.textContent === '{\n    "agent_id": "worker-1"\n}',
      ),
    ).toBeInTheDocument();
    const idleButtons = screen.getAllByRole("button", { name: /idle/i });
    expect(idleButtons).toHaveLength(2);
    expect(screen.queryByText("Running...")).not.toBeInTheDocument();
    fireEvent.click(idleButtons[0]!);
    expect(
      within(idleButtons[0]!.parentElement as HTMLElement).queryByText(
        "Result",
      ),
    ).not.toBeInTheDocument();
    fireEvent.click(idleButtons[1]!);
    expect(screen.getByText("idle 1.25s")).toBeInTheDocument();
  });

  it("keeps message activity content collapsed until opened", () => {
    const nodes = new Map<string, Node>([
      [
        "worker-1",
        {
          id: "worker-1",
          node_type: "agent",
          is_leader: false,
          state: "running",
          connections: [],
          name: "Project Analyst",
          todos: [],
          role_name: "Worker",
        },
      ],
    ]);

    render(
      <AssistantChatMessages
        items={[
          {
            type: "ReceivedMessage",
            from_id: "worker-1",
            content: "I have inspected the project root.",
            timestamp: 5.5,
          },
          {
            type: "SentMessage",
            content: "Worker, continue the task.",
            to_ids: ["worker-1"],
            timestamp: 6,
          },
        ]}
        nodes={nodes}
        onScroll={() => {}}
        scrollRef={createRef<HTMLDivElement>()}
      />,
    );

    expect(screen.getByText("From Project Analyst")).toBeInTheDocument();
    expect(screen.getByText("To Project Analyst")).toBeInTheDocument();
    expect(
      screen.queryByText("I have inspected the project root."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Worker, continue the task."),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /From Project Analyst/i }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /To Project Analyst/i }),
    );

    expect(
      screen.getByText("I have inspected the project root."),
    ).toBeInTheDocument();
    expect(screen.getByText("Worker, continue the task.")).toBeInTheDocument();
  });

  it("applies bottom inset space for an overlay composer", () => {
    const scrollRef = createRef<HTMLDivElement>();

    render(
      <AssistantChatMessages
        bottomInset={120}
        items={[]}
        onScroll={() => {}}
        scrollRef={scrollRef}
      />,
    );

    expect(scrollRef.current).not.toBeNull();
    expect(scrollRef.current?.style.paddingBottom).toBe("134px");
    expect(scrollRef.current?.style.scrollPaddingBottom).toBe("134px");
  });

  it("renders an inline running hint at the end of the timeline", () => {
    const scrollRef = createRef<HTMLDivElement>();

    renderWithImageViewer(
      <AssistantChatMessages
        items={[
          {
            type: "PendingHumanMessage",
            id: "pending-2",
            from: "human",
            content: "Inspect the deployment issue",
            timestamp: 10,
          },
        ]}
        onScroll={() => {}}
        runningHint={{
          label: "Running tools...",
          toolName: "manage_roles",
        }}
        scrollRef={scrollRef}
      />,
    );

    expect(screen.getByText("Running tools...")).toBeInTheDocument();
    expect(screen.getByText("manage_roles")).toBeInTheDocument();
  });

  it("shows the empty state when only state entries remain after a chat clear", () => {
    const scrollRef = createRef<HTMLDivElement>();

    renderWithImageViewer(
      <AssistantChatMessages
        items={[
          {
            type: "StateEntry",
            state: "idle",
            reason: "assistant chat cleared",
            timestamp: 1,
          },
        ]}
        onScroll={() => {}}
        scrollRef={scrollRef}
      />,
    );

    expect(screen.getAllByText("Start a conversation").length).toBeGreaterThan(
      0,
    );
  });

  it("renders human bubbles with the shared workspace surface", () => {
    const workspaceScrollRef = createRef<HTMLDivElement>();
    const panelScrollRef = createRef<HTMLDivElement>();
    const workspaceItems: AssistantChatItem[] = [
      {
        type: "ReceivedMessage",
        from_id: "human",
        content: "Workspace message",
        timestamp: 1,
      },
    ];
    const panelItems: AssistantChatItem[] = [
      {
        type: "ReceivedMessage",
        from_id: "human",
        content: "Panel message",
        timestamp: 2,
      },
    ];

    const { rerender } = render(
      <AssistantChatMessages
        items={workspaceItems}
        onScroll={() => {}}
        scrollRef={workspaceScrollRef}
      />,
    );

    const workspaceBubble =
      screen.getByText("Workspace message").parentElement?.parentElement
        ?.parentElement?.parentElement;
    expect(workspaceBubble).not.toBeNull();
    expect(workspaceBubble).toHaveClass(
      "bg-accent/80",
      "text-accent-foreground",
      "border-border",
    );

    rerender(
      <AssistantChatMessages
        items={panelItems}
        onScroll={() => {}}
        scrollRef={panelScrollRef}
      />,
    );

    const panelBubble =
      screen.getByText("Panel message").parentElement?.parentElement
        ?.parentElement?.parentElement;
    expect(panelBubble).not.toBeNull();
    expect(panelBubble).toHaveClass(
      "bg-accent/80",
      "text-accent-foreground",
      "border-border",
    );
  });

  it("renders streaming assistant text with an inline cursor", () => {
    const scrollRef = createRef<HTMLDivElement>();

    render(
      <AssistantChatMessages
        items={[
          {
            type: "AssistantText",
            content: "Streaming response",
            timestamp: 1,
            streaming: true,
          },
        ]}
        onScroll={() => {}}
        scrollRef={scrollRef}
      />,
    );

    const textNode = screen.getByText("Streaming response");
    const contentBlock = textNode.parentElement;
    expect(contentBlock).not.toBeNull();
    expect(contentBlock?.querySelector(".streaming-cursor")).not.toBeNull();
  });

  it("copies human message content with the same copy action style", async () => {
    const scrollRef = createRef<HTMLDivElement>();
    const writeText = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(
      <AssistantChatMessages
        items={[
          {
            type: "ReceivedMessage",
            from_id: "human",
            content: "Copy this human message",
            timestamp: 1,
          },
        ]}
        onScroll={() => {}}
        scrollRef={scrollRef}
      />,
    );

    const messageGroup = screen
      .getByText("Copy this human message")
      .closest(".group");

    expect(messageGroup).not.toBeNull();
    fireEvent.click(
      within(messageGroup as HTMLElement).getByRole("button", { name: "Copy" }),
    );

    expect(writeText).toHaveBeenCalledWith("Copy this human message");
  });

  it("shows retry on committed human messages and invokes the callback", () => {
    const scrollRef = createRef<HTMLDivElement>();
    const onRetryHumanMessage = vi.fn();

    render(
      <AssistantChatMessages
        items={[
          {
            type: "ReceivedMessage",
            from_id: "human",
            content: "Retry this human message",
            message_id: "msg-1",
            timestamp: 1,
          },
        ]}
        onRetryHumanMessage={onRetryHumanMessage}
        onScroll={() => {}}
        scrollRef={scrollRef}
      />,
    );

    const messageGroup = screen
      .getByText("Retry this human message")
      .closest(".group");

    expect(messageGroup).not.toBeNull();
    fireEvent.click(
      within(messageGroup as HTMLElement).getByRole("button", {
        name: "Retry",
      }),
    );

    expect(onRetryHumanMessage).toHaveBeenCalledWith("msg-1");
  });

  it("disables retry for image messages when image input is unavailable", () => {
    const scrollRef = createRef<HTMLDivElement>();

    renderWithImageViewer(
      <AssistantChatMessages
        items={[
          {
            type: "ReceivedMessage",
            from_id: "human",
            message_id: "msg-image",
            parts: [
              {
                type: "text",
                text: "Retry this image message",
              },
              {
                type: "image",
                asset_id: "asset-1",
                mime_type: "image/png",
                width: 1,
                height: 1,
              },
            ],
            timestamp: 1,
          },
        ]}
        onRetryHumanMessage={() => {}}
        onScroll={() => {}}
        retryImageInputEnabled={false}
        scrollRef={scrollRef}
      />,
    );

    expect(screen.getByRole("button", { name: "Retry" })).toBeDisabled();
  });

  it("opens sent image parts in the shared preview surface", () => {
    const scrollRef = createRef<HTMLDivElement>();

    renderWithImageViewer(
      <AssistantChatMessages
        items={[
          {
            type: "AssistantText",
            parts: [
              {
                type: "image",
                asset_id: "asset-1",
                alt: "Architecture diagram",
                mime_type: "image/png",
                width: 1600,
                height: 900,
              },
            ],
            timestamp: 1,
          },
        ]}
        onScroll={() => {}}
        scrollRef={scrollRef}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Architecture diagram/i }),
    );

    expect(
      screen.getAllByRole("button", { name: "Close image preview" }).length,
    ).toBeGreaterThan(0);
  });

  it("pins human message images above the text body after sending", () => {
    const scrollRef = createRef<HTMLDivElement>();

    renderWithImageViewer(
      <AssistantChatMessages
        items={[
          {
            type: "ReceivedMessage",
            from_id: "human",
            content: "Please review the attached sketch.",
            parts: [
              {
                type: "text",
                text: "Please review the attached sketch.",
              },
              {
                type: "image",
                asset_id: "asset-human-1",
                alt: "Pinned sketch",
                mime_type: "image/png",
                width: 1600,
                height: 900,
              },
            ],
            timestamp: 1,
          },
        ]}
        onScroll={() => {}}
        scrollRef={scrollRef}
      />,
    );

    const imageButton = screen.getByRole("button", { name: /Pinned sketch/i });
    const textBody = screen.getByText("Please review the attached sketch.");

    expectDocumentOrder(
      imageButton,
      textBody,
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(screen.queryByText(/\[image:/i)).not.toBeInTheDocument();
  });

  it("keeps formal parts semantics when copying a pinned human message", () => {
    const scrollRef = createRef<HTMLDivElement>();
    const writeText = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    renderWithImageViewer(
      <AssistantChatMessages
        items={[
          {
            type: "ReceivedMessage",
            from_id: "human",
            content: "Please review the attached sketch.",
            parts: [
              {
                type: "text",
                text: "Please review the attached sketch.",
              },
              {
                type: "image",
                asset_id: "asset-human-1",
                alt: "Pinned sketch",
                mime_type: "image/png",
                width: 1600,
                height: 900,
              },
            ],
            timestamp: 1,
          },
        ]}
        onScroll={() => {}}
        scrollRef={scrollRef}
      />,
    );

    const messageGroup = screen
      .getByText("Please review the attached sketch.")
      .closest(".group");

    expect(messageGroup).not.toBeNull();
    fireEvent.click(
      within(messageGroup as HTMLElement).getByRole("button", { name: "Copy" }),
    );

    expect(writeText).toHaveBeenCalledWith(
      "Please review the attached sketch.[image: Pinned sketch]",
    );
  });

  it("keeps non-human mixed content in formal parts order", () => {
    const scrollRef = createRef<HTMLDivElement>();
    const nodes = new Map<string, Node>([
      [
        "worker-1",
        {
          id: "worker-1",
          node_type: "agent",
          is_leader: false,
          state: "running",
          connections: [],
          name: "Project Analyst",
          todos: [],
          role_name: "Worker",
        },
      ],
    ]);

    renderWithImageViewer(
      <AssistantChatMessages
        items={[
          {
            type: "AssistantText",
            parts: [
              {
                type: "text",
                text: "First explain the diagram.",
              },
              {
                type: "image",
                asset_id: "asset-assistant-1",
                alt: "Assistant diagram",
                mime_type: "image/png",
                width: 1600,
                height: 900,
              },
            ],
            timestamp: 1,
          },
          {
            type: "ReceivedMessage",
            from_id: "worker-1",
            parts: [
              {
                type: "text",
                text: "Worker reply first.",
              },
              {
                type: "image",
                asset_id: "asset-worker-received-1",
                alt: "Worker received diagram",
                mime_type: "image/png",
                width: 1600,
                height: 900,
              },
            ],
            timestamp: 2,
          },
          {
            type: "SentMessage",
            to_ids: ["worker-1"],
            parts: [
              {
                type: "text",
                text: "Directive first.",
              },
              {
                type: "image",
                asset_id: "asset-worker-sent-1",
                alt: "Worker sent diagram",
                mime_type: "image/png",
                width: 1600,
                height: 900,
              },
            ],
            timestamp: 3,
          },
        ]}
        nodes={nodes}
        onScroll={() => {}}
        scrollRef={scrollRef}
      />,
    );

    const textBody = screen.getByText("First explain the diagram.");
    const imageButton = screen.getByRole("button", {
      name: /Assistant diagram/i,
    });

    expectDocumentOrder(
      textBody,
      imageButton,
      Node.DOCUMENT_POSITION_FOLLOWING,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /From Project Analyst/i }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /To Project Analyst/i }),
    );

    expectDocumentOrder(
      screen.getByText("Worker reply first."),
      screen.getByRole("button", { name: /Worker received diagram/i }),
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expectDocumentOrder(
      screen.getByText("Directive first."),
      screen.getByRole("button", { name: /Worker sent diagram/i }),
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
});

describe("AssistantChatComposer", () => {
  function PastedImageHarness({
    imageInputEnabled = true,
  }: {
    imageInputEnabled?: boolean;
  }) {
    const [images, setImages] = useState<
      Array<{
        id: string;
        previewUrl: string;
        name: string;
        width: number | null;
        height: number | null;
        status: "uploading" | "ready";
      }>
    >([]);

    return (
      <AssistantChatComposer
        disabled={false}
        imageInputEnabled={imageInputEnabled}
        images={images}
        input="/"
        onAddImages={(files) =>
          setImages(
            Array.from(files).map((file, index) => ({
              id: `${index}`,
              previewUrl: `blob:${file.name}`,
              name: file.name,
              width: null,
              height: null,
              status: "ready",
            })),
          )
        }
        onChange={() => {}}
        onKeyDown={() => {}}
        onSend={() => {}}
      />
    );
  }

  it("keeps the send action inside the composer shell and grows with multiline input", () => {
    const onSend = vi.fn();
    const { rerender } = render(
      <AssistantChatComposer
        disabled={false}
        input=""
        onChange={() => {}}
        onKeyDown={() => {}}
        onSend={onSend}
      />,
    );

    const textarea = screen.getByPlaceholderText(
      "Message Assistant or type / for commands",
    );
    const sendButton = screen.getByRole("button", {
      name: "Send Assistant message",
    });
    const composerShell = textarea.parentElement?.parentElement;

    expect(composerShell).not.toBeNull();
    expect(composerShell).toContainElement(sendButton);
    expect(composerShell?.className).toContain("border-border");
    expect(composerShell?.className).toContain("shadow-sm");

    const originalGetComputedStyle = window.getComputedStyle;
    const getComputedStyleSpy = vi
      .spyOn(window, "getComputedStyle")
      .mockImplementation((element) => {
        if (element === textarea) {
          return {
            ...originalGetComputedStyle(element),
            lineHeight: "20px",
            paddingTop: "8px",
            paddingBottom: "8px",
          } as CSSStyleDeclaration;
        }

        return originalGetComputedStyle(element);
      });

    Object.defineProperty(textarea, "scrollHeight", {
      configurable: true,
      value: 96,
    });

    rerender(
      <AssistantChatComposer
        disabled={false}
        input={"line 1\nline 2\nline 3\nline 4"}
        onChange={() => {}}
        onKeyDown={() => {}}
        onSend={onSend}
      />,
    );

    expect(textarea.style.height).toBe("96px");
    expect(textarea.style.overflowY).toBe("hidden");

    Object.defineProperty(textarea, "scrollHeight", {
      configurable: true,
      value: 240,
    });

    rerender(
      <AssistantChatComposer
        disabled={false}
        input={"1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11"}
        onChange={() => {}}
        onKeyDown={() => {}}
        onSend={onSend}
      />,
    );

    expect(textarea.style.height).toBe("176px");
    expect(textarea.style.overflowY).toBe("auto");

    getComputedStyleSpy.mockRestore();
  });

  it("switches the workspace action to stop while the assistant is running", () => {
    const onSend = vi.fn();
    const onStop = vi.fn();

    render(
      <AssistantChatComposer
        busy
        disabled
        input=""
        onChange={() => {}}
        onKeyDown={() => {}}
        onSend={onSend}
        onStop={onStop}
      />,
    );

    const stopButton = screen.getByRole("button", { name: "Stop Assistant" });
    expect(stopButton).toHaveTextContent("Stop");
    expect(stopButton.className).toContain("bg-destructive/18");

    fireEvent.click(stopButton);

    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("shows filtered command suggestions and inserts compact with a trailing space", () => {
    const onChange = vi.fn();
    const onKeyDown = vi.fn();

    render(
      <AssistantChatComposer
        disabled={false}
        input="/"
        onChange={onChange}
        onKeyDown={onKeyDown}
        onSend={() => {}}
      />,
    );

    const textarea = screen.getByPlaceholderText(
      "Message Assistant or type / for commands",
    );

    expect(
      screen.getByRole("listbox", { name: "Assistant commands" }),
    ).toBeInTheDocument();

    fireEvent.keyDown(textarea, { key: "ArrowDown" });
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith("/compact ");
    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it("prioritizes input history browsing over command panel arrow handling", () => {
    const onChange = vi.fn();
    const onKeyDown = vi.fn();
    const onNavigateHistory = vi.fn().mockReturnValue(true);

    render(
      <AssistantChatComposer
        disabled={false}
        input="/"
        onChange={onChange}
        onNavigateHistory={onNavigateHistory}
        onKeyDown={onKeyDown}
        onSend={() => {}}
      />,
    );

    const textarea = screen.getByPlaceholderText(
      "Message Assistant or type / for commands",
    ) as HTMLTextAreaElement;

    textarea.focus();
    textarea.setSelectionRange(1, 1);
    fireEvent.keyDown(textarea, { key: "ArrowDown" });
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(onNavigateHistory).toHaveBeenCalledWith(1, {
      start: 1,
      end: 1,
    });
    expect(onChange).toHaveBeenCalledWith("/clear ");
    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it("keeps command arrows on the native textarea when a recalled history item is no longer at a boundary", () => {
    const onChange = vi.fn();
    const onKeyDown = vi.fn();
    const onNavigateHistory = vi.fn().mockReturnValue(false);

    render(
      <AssistantChatComposer
        disabled={false}
        input="/compact focus"
        onChange={onChange}
        onNavigateHistory={onNavigateHistory}
        onKeyDown={onKeyDown}
        onSend={() => {}}
        suppressCommandNavigation
      />,
    );

    const textarea = screen.getByPlaceholderText(
      "Message Assistant or type / for commands",
    ) as HTMLTextAreaElement;

    textarea.focus();
    textarea.setSelectionRange(4, 4);
    fireEvent.keyDown(textarea, { key: "ArrowDown" });

    expect(onNavigateHistory).toHaveBeenCalledWith(1, {
      start: 4,
      end: 4,
    });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("inserts help with a trailing space when completing a non-argument command", () => {
    const onChange = vi.fn();
    const onKeyDown = vi.fn();

    render(
      <AssistantChatComposer
        disabled={false}
        input="/he"
        onChange={onChange}
        onKeyDown={onKeyDown}
        onSend={() => {}}
      />,
    );

    const textarea = screen.getByPlaceholderText(
      "Message Assistant or type / for commands",
    );

    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith("/help ");
    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it("completes the selected command with Tab and keeps focus in the composer", () => {
    const onChange = vi.fn();
    const onKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = vi.fn(
      (event) => {
        event.currentTarget.blur();
      },
    );

    render(
      <AssistantChatComposer
        disabled={false}
        input="/"
        onChange={onChange}
        onKeyDown={onKeyDown}
        onSend={() => {}}
      />,
    );

    const textarea = screen.getByPlaceholderText(
      "Message Assistant or type / for commands",
    ) as HTMLTextAreaElement;

    textarea.focus();
    fireEvent.keyDown(textarea, { key: "ArrowDown" });
    fireEvent.keyDown(textarea, { key: "Tab" });

    expect(onChange).toHaveBeenCalledWith("/compact ");
    expect(onKeyDown).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(textarea);
  });

  it("dismisses the command suggestions with Escape without clearing the input", () => {
    render(
      <AssistantChatComposer
        disabled={false}
        input="/"
        onChange={() => {}}
        onKeyDown={() => {}}
        onSend={() => {}}
      />,
    );

    const textarea = screen.getByPlaceholderText(
      "Message Assistant or type / for commands",
    ) as HTMLTextAreaElement;

    fireEvent.keyDown(textarea, { key: "Escape" });

    expect(
      screen.queryByRole("listbox", { name: "Assistant commands" }),
    ).not.toBeInTheDocument();
    expect(textarea.value).toBe("/");
  });

  it("adds pasted clipboard images into the same pending image list and hides commands", () => {
    renderWithImageViewer(<PastedImageHarness />);

    const textarea = screen.getByPlaceholderText(
      "Message Assistant or type / for commands",
    );
    const file = new File(["image"], "pasted.png", { type: "image/png" });

    expect(
      screen.getByRole("listbox", { name: "Assistant commands" }),
    ).toBeInTheDocument();

    fireEvent.paste(textarea, {
      clipboardData: {
        items: [
          {
            kind: "file",
            type: "image/png",
            getAsFile: () => file,
          },
        ],
      },
    });

    expect(
      screen.queryByRole("listbox", { name: "Assistant commands" }),
    ).not.toBeInTheDocument();
    expect(screen.getByAltText("pasted.png")).toBeInTheDocument();
  });

  it("ignores pasted clipboard images when image input is disabled", () => {
    renderWithImageViewer(<PastedImageHarness imageInputEnabled={false} />);

    const textarea = screen.getByPlaceholderText(
      "Message Assistant or type / for commands",
    );
    const file = new File(["image"], "pasted.png", { type: "image/png" });

    fireEvent.paste(textarea, {
      clipboardData: {
        items: [
          {
            kind: "file",
            type: "image/png",
            getAsFile: () => file,
          },
        ],
      },
    });

    expect(
      screen.getByRole("listbox", { name: "Assistant commands" }),
    ).toBeInTheDocument();
    expect(screen.queryByAltText("pasted.png")).not.toBeInTheDocument();
  });

  it("opens pending image thumbnails in the same preview surface and keeps remove available", () => {
    const onRemoveImage = vi.fn();

    renderWithImageViewer(
      <AssistantChatComposer
        disabled={false}
        images={[
          {
            id: "draft-1",
            previewUrl: "blob:draft-preview",
            name: "draft.png",
            width: 1200,
            height: 800,
            status: "ready",
          },
        ]}
        input=""
        onChange={() => {}}
        onKeyDown={() => {}}
        onRemoveImage={onRemoveImage}
        onSend={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Preview draft.png" }));

    expect(
      screen.getAllByRole("button", { name: "Close image preview" }).length,
    ).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Remove draft.png" }));

    expect(onRemoveImage).toHaveBeenCalledWith("draft-1");
  });

  it("keeps the command panel open with an empty state when no command matches", () => {
    render(
      <AssistantChatComposer
        disabled={false}
        input="/unknown"
        onChange={() => {}}
        onKeyDown={() => {}}
        onSend={() => {}}
      />,
    );

    expect(
      screen.getByRole("listbox", { name: "Assistant commands" }),
    ).toBeInTheDocument();
    expect(screen.getByText("No matching commands.")).toBeInTheDocument();
  });

  it("keeps the exact command selected and lets Enter pass through for sending", () => {
    const onChange = vi.fn();
    const onKeyDown = vi.fn();

    render(
      <AssistantChatComposer
        disabled={false}
        input="/help"
        onChange={onChange}
        onKeyDown={onKeyDown}
        onSend={() => {}}
      />,
    );

    const textarea = screen.getByPlaceholderText(
      "Message Assistant or type / for commands",
    );

    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not rewrite an already-sendable command when Tab is pressed", () => {
    const onChange = vi.fn();
    const onKeyDown = vi.fn();

    render(
      <AssistantChatComposer
        disabled={false}
        input="/help"
        onChange={onChange}
        onKeyDown={onKeyDown}
        onSend={() => {}}
      />,
    );

    const textarea = screen.getByPlaceholderText(
      "Message Assistant or type / for commands",
    );

    fireEvent.keyDown(textarea, { key: "Tab" });

    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not hijack Tab when there is no matching command candidate", () => {
    const onChange = vi.fn();
    const onKeyDown = vi.fn();

    render(
      <AssistantChatComposer
        disabled={false}
        input="/unknown"
        onChange={onChange}
        onKeyDown={onKeyDown}
        onSend={() => {}}
      />,
    );

    const textarea = screen.getByPlaceholderText(
      "Message Assistant or type / for commands",
    );

    fireEvent.keyDown(textarea, { key: "Tab" });

    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("leaves Shift+Tab to the browser instead of using it for command completion", () => {
    const onChange = vi.fn();
    const onKeyDown = vi.fn();

    render(
      <AssistantChatComposer
        disabled={false}
        input="/"
        onChange={onChange}
        onKeyDown={onKeyDown}
        onSend={() => {}}
      />,
    );

    const textarea = screen.getByPlaceholderText(
      "Message Assistant or type / for commands",
    );

    fireEvent.keyDown(textarea, { key: "Tab", shiftKey: true });

    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });
});
