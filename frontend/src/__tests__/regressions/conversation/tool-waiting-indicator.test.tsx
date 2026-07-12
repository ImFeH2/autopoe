import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WorkspaceView } from "@/components/flowent/workspace-view";
import type { AssistantOutputItem, Message } from "@/components/flowent/types";

const renderWorkspace = (messages: Message[]) =>
  render(
    <WorkspaceView
      commands={[]}
      contextWindowLimit={null}
      draft=""
      isRefiningContext={false}
      isResponding={true}
      messages={messages}
      onCommand={() => false}
      onCommandError={vi.fn()}
      onDraftChange={vi.fn()}
      onEditMessage={vi.fn()}
      onRetryError={vi.fn()}
      onRetryMessage={vi.fn()}
      onSendMessage={vi.fn()}
      onStopResponse={vi.fn()}
      skills={[]}
      usageInfo={null}
    />,
  );

const assistantWithItems = (
  items: AssistantOutputItem[],
  isStreamingText = false,
): Message => ({
  author: "assistant",
  content: items
    .filter((item) => item.type === "text")
    .map((item) => item.content)
    .join(""),
  groups: [
    {
      id: "message-assistant-group-1",
      items,
    },
  ],
  id: "message-assistant",
  isStreamingText,
  status: "running",
});

describe("tool waiting indicator regressions", () => {
  it("shows the thinking indicator when the latest output item is a running tool", () => {
    renderWorkspace([
      {
        author: "user",
        content: "Read the notes.",
        id: "message-user",
      },
      assistantWithItems([
        {
          content: "I will check the notes first.",
          id: "message-assistant-text-1",
          type: "text",
        },
        {
          id: "tool-tool-1",
          tool: {
            id: "tool-1",
            name: "read_file",
            status: "running",
            title: "Reading notes.txt",
          },
          type: "tool",
        },
      ]),
    ]);

    expect(screen.getByText("Reading notes.txt")).toBeInTheDocument();
    expect(
      screen.getByRole("status", { name: "Thinking" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("response-cursor")).not.toBeInTheDocument();
  });

  it("replaces the thinking indicator with the streaming cursor when text starts", () => {
    renderWorkspace([
      {
        author: "user",
        content: "Read the notes.",
        id: "message-user",
      },
      assistantWithItems(
        [
          {
            id: "tool-tool-1",
            tool: {
              id: "tool-1",
              name: "read_file",
              status: "success",
              title: "Reading notes.txt",
            },
            type: "tool",
          },
          {
            content: "The notes",
            id: "message-assistant-text-1",
            type: "text",
          },
        ],
        true,
      ),
    ]);

    expect(screen.getByTestId("response-cursor")).toBeInTheDocument();
    expect(
      screen.queryByRole("status", { name: "Thinking" }),
    ).not.toBeInTheDocument();
  });

  it("does not show the thinking indicator while a tool waits for confirmation", () => {
    renderWorkspace([
      {
        author: "user",
        content: "Update the file.",
        id: "message-user",
      },
      {
        ...assistantWithItems([
          {
            id: "tool-tool-1",
            tool: {
              id: "tool-1",
              name: "shell_command",
              status: "waiting",
              title: "Update notes.txt",
            },
            type: "tool",
          },
        ]),
        isStreamingText: false,
      },
    ]);

    expect(screen.getByText("Update notes.txt")).toBeInTheDocument();
    expect(screen.getByText("Waiting")).toBeInTheDocument();
    expect(
      screen.queryByRole("status", { name: "Thinking" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("response-cursor")).not.toBeInTheDocument();
  });
});
