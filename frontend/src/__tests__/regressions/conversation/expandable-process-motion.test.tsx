import {
  fireEvent,
  render,
  screen,
  waitForElementToBeRemoved,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AssistantOutputGroup } from "@/features/workspace/model/message-types";
import { AssistantOutputTimeline } from "@/components/flowent/workspace/assistant-output";
import { ToolProcessItem } from "@/components/flowent/workspace/tool-process";

const noop = vi.fn();

describe("Workspace expandable process motion", () => {
  it("keeps tool details visible while the closing transition completes", async () => {
    render(
      <ToolProcessItem
        tool={{
          arguments: { path: "notes.txt" },
          id: "tool-1",
          name: "read_file",
          result: { text: "Project notes", type: "text" },
          status: "success",
          title: "Read notes.txt",
        }}
      />,
    );

    const toggle = screen.getByRole("button", { name: /Read notes\.txt/ });
    fireEvent.click(toggle);

    expect(screen.getByText("Project notes")).toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Project notes")).toBeInTheDocument();
    await waitForElementToBeRemoved(() => screen.queryByText("Project notes"));
  });

  it("animates the automatic collapse before completed thought details leave", async () => {
    const thinkingGroups: AssistantOutputGroup[] = [
      {
        id: "group-1",
        items: [
          {
            content: "Checked the current files.",
            id: "thinking-1",
            isStreaming: true,
            type: "thinking",
          },
        ],
      },
    ];
    const { rerender } = render(
      <AssistantOutputTimeline
        disableErrorRetry={false}
        groups={thinkingGroups}
        isStreaming={true}
        onRetryError={noop}
        showWaitingAfterOutput={false}
      />,
    );

    expect(screen.getByText("Checked the current files.")).toBeInTheDocument();

    rerender(
      <AssistantOutputTimeline
        disableErrorRetry={false}
        groups={[
          {
            ...thinkingGroups[0],
            items: thinkingGroups[0].items.map((item) => ({
              ...item,
              isStreaming: false,
            })),
          },
        ]}
        isStreaming={false}
        onRetryError={noop}
        showWaitingAfterOutput={false}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Thought Process" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Checked the current files.")).toBeInTheDocument();
    await waitForElementToBeRemoved(() =>
      screen.queryByText("Checked the current files."),
    );
  });
});
