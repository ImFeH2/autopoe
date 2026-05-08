import type { ReactElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HistoryView } from "@/components/HistoryView";
import { ImageViewerProvider } from "@/components/ImageViewer";
import type { HistoryEntry, Node } from "@/types";

afterEach(() => {
  cleanup();
});

function renderWithImageViewer(ui: ReactElement) {
  return render(<ImageViewerProvider>{ui}</ImageViewerProvider>);
}

describe("HistoryView", () => {
  it("renders message and assistant entries collapsed by default and expands on demand", () => {
    const history: HistoryEntry[] = [
      {
        type: "ReceivedMessage",
        from_id: "agent-12345678",
        content: "Review the workshop notes.",
        timestamp: 1,
      },
      {
        type: "AssistantText",
        content: "The notes cover schedule, speakers, and logistics.",
        timestamp: 2,
      },
    ];
    const nodes = new Map<string, Node>([
      [
        "agent-12345678",
        {
          id: "agent-12345678",
          node_type: "agent",
          is_leader: false,
          state: "idle",
          connections: [],
          name: "Directory Analyzer",
          todos: [],
          role_name: "Worker",
        },
      ],
    ]);

    render(
      <HistoryView
        history={history}
        agentLabel="Project Planner"
        nodes={nodes}
      />,
    );

    expect(
      screen.getByRole("button", { name: /From Directory Analyzer/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Project Planner/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Review the workshop notes."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("The notes cover schedule, speakers, and logistics."),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Project Planner/i }));

    expect(
      screen.getByText("The notes cover schedule, speakers, and logistics."),
    ).toBeInTheDocument();
  });

  it("shows Human for received messages from the user", () => {
    render(
      <HistoryView
        history={[
          {
            type: "ReceivedMessage",
            from_id: "human",
            content: "Need a quick summary.",
            timestamp: 1,
          },
        ]}
      />,
    );

    expect(
      screen.getByRole("button", { name: /From Human/i }),
    ).toBeInTheDocument();
  });

  it("renders sent messages separately from assistant text", () => {
    render(
      <HistoryView
        history={[
          {
            type: "SentMessage",
            to_ids: ["assistant"],
            content: "Done.",
            timestamp: 1,
          },
        ]}
      />,
    );

    expect(
      screen.getByRole("button", { name: /To Assistant/i }),
    ).toBeInTheDocument();
  });

  it("renders workflow path labels for sent and received messages", () => {
    render(
      <HistoryView
        history={[
          {
            type: "ReceivedMessage",
            from_id: "agent-a",
            content: "Draft ready.",
            from_output_port_key: "out",
            to_input_port_key: "review",
            timestamp: 1,
          },
          {
            type: "SentMessage",
            to_id: "agent-b",
            content: "Please review.",
            from_output_port_key: "final",
            to_input_port_key: "in",
            timestamp: 2,
          },
        ]}
      />,
    );

    expect(
      screen.getByRole("button", { name: /From agent-a · out to review/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /To agent-b · final to in/i }),
    ).toBeInTheDocument();
  });

  it("renders non-message port inputs", () => {
    render(
      <HistoryView
        history={[
          {
            type: "PortInboundEntry",
            from_id: "code-a",
            source_label: "Formatter",
            from_output_port_key: "json",
            to_input_port_key: "payload",
            port_type: "json",
            value: { status: "ready" },
            value_summary: '{"status":"ready"}',
            timestamp: 1,
          },
        ]}
      />,
    );

    expect(
      screen.getByRole("button", {
        name: /Input from Formatter · json to payload/i,
      }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: /Input from Formatter · json to payload/i,
      }),
    );

    expect(screen.getByText("json")).toBeInTheDocument();
    expect(
      screen
        .getAllByText((_, element) =>
          Boolean(element?.textContent?.includes('"status": "ready"')),
        )
        .some((element) => element.tagName === "PRE"),
    ).toBe(true);
  });

  it("does not render state-only entries as history rows", () => {
    render(
      <HistoryView
        history={[
          {
            type: "SystemEntry",
            content: "",
            timestamp: 1,
          },
        ]}
      />,
    );

    expect(screen.queryByRole("button", { name: /State/i })).toBeNull();
  });

  it("shows streaming message content immediately", () => {
    render(
      <HistoryView
        history={[
          {
            type: "ReceivedMessage",
            from_id: "agent-12345678",
            message_id: "msg-1",
            content: "Streaming update",
            timestamp: 2,
            streaming: true,
          },
        ]}
      />,
    );

    expect(screen.getByText("Streaming update")).toBeInTheDocument();
  });

  it("renders markdown for completed history entries", () => {
    render(
      <HistoryView
        history={[
          {
            type: "AssistantText",
            content: "**Summary**\n\n- First item\n- Second item",
            timestamp: 1,
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Agent/i }));

    const summary = screen.getByText("Summary");
    expect(summary.tagName).toBe("STRONG");
    expect(screen.getByText("First item")).toBeInTheDocument();
    expect(screen.getByText("Second item")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("formats json tool output with four-space indentation", () => {
    render(
      <HistoryView
        history={[
          {
            type: "ToolCall",
            tool_name: "inspect_result",
            arguments: { outer: { value: 1 } },
            result: '{"outer":{"value":1}}',
            timestamp: 1,
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /inspect_result/i }));

    const expected = '{\n    "outer": {\n        "value": 1\n    }\n}';

    expect(
      screen.getAllByText((_, element) => element?.textContent === expected),
    ).toHaveLength(2);
  });

  it("opens history image previews in the global viewer", () => {
    renderWithImageViewer(
      <HistoryView
        history={[
          {
            type: "ReceivedMessage",
            from_id: "human",
            parts: [
              {
                type: "image",
                asset_id: "asset-1",
                alt: "History preview",
                mime_type: "image/png",
                width: 640,
                height: 480,
              },
            ],
            timestamp: 1,
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /From Human/i }));
    fireEvent.click(screen.getByRole("button", { name: /History preview/i }));

    expect(
      screen.getAllByRole("button", { name: "Close image preview" }).length,
    ).toBeGreaterThan(0);
  });
});
