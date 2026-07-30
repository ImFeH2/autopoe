import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";
import type { RunEvent } from "@/types/agent";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class<T> {
    onmessage?: (message: T) => void;
  },
  invoke: invokeMock,
}));

describe("App", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("opens the editable workflow workspace", async () => {
    render(<App />);

    expect(
      screen.getByRole("button", { name: "Workflows" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      await screen.findByRole("textbox", { name: "Workflow name" }),
    ).toHaveValue("Software delivery");
    expect(screen.getAllByText("Requirements").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Run" })).toBeEnabled();
  });

  it("edits the selected workflow node", async () => {
    render(<App />);

    const nodeName = await screen.findByDisplayValue("Requirements");
    fireEvent.change(nodeName, { target: { value: "Discovery" } });

    expect(screen.getAllByText("Discovery").length).toBeGreaterThan(0);
  });

  it("opens and edits the steps inside a loop", async () => {
    render(<App />);

    fireEvent.doubleClick(await screen.findByText("Quality loop"));

    expect((await screen.findAllByText("Code review")).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText("Tests")).toBeInTheDocument();
    expect(screen.getByText("Repair")).toBeInTheDocument();
    expect(screen.getByText("Verification")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
  });

  it("creates another editable workflow", async () => {
    render(<App />);

    fireEvent.pointerDown(
      await screen.findByRole("button", { name: "Select workflow" }),
      { button: 0, ctrlKey: false },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "New" }));

    expect(
      await screen.findByRole("textbox", { name: "Workflow name" }),
    ).toHaveValue("Untitled workflow");
    expect(screen.getAllByText("Agent").length).toBeGreaterThan(0);
  });

  it("queues a workflow run and opens its console", async () => {
    invokeMock.mockImplementation(async (command: string, args: any) => {
      if (command === "runtime_request" && args.name === "workflow.publish") {
        return { version: { version: 1 } };
      }
      if (command === "runtime_request" && args.name === "workflow.get") {
        throw new Error("Not saved");
      }
      if (command === "runtime_request" && args.name === "workflow.cancel") {
        return { cancelled: true };
      }
      if (command === "run_workflow") {
        args.events.onmessage?.({
          name: "workflow.started",
          sequence: 0,
          scope: { run_id: args.runId },
          payload: {},
        });
        return {};
      }
      return {};
    });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Run" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Request"), {
      target: { value: "Add search" },
    });
    fireEvent.change(within(dialog).getByLabelText("Repository"), {
      target: { value: "/project/flowent" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Run" }));

    expect(
      await screen.findByRole("button", { name: "Runs" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      (await screen.findAllByText("Software delivery")).length,
    ).toBeGreaterThan(0);
    expect(await screen.findByText("workflow started")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("runtime_request", {
        name: "workflow.cancel",
        payload: { run_id: expect.any(String) },
      });
    });
  });

  it("loads and replays persisted workflow runs", async () => {
    invokeMock.mockImplementation(async (command: string, args: any) => {
      if (command !== "runtime_request") {
        return {};
      }
      if (args.name === "workflow.get") {
        throw new Error("Not saved");
      }
      if (args.name === "run.list") {
        return {
          runs: [
            {
              id: "stored-run",
              workflow_name: "Stored delivery",
              status: "completed",
              input: {},
              created_at: "2026-07-30T10:00:00+00:00",
            },
          ],
        };
      }
      if (args.name === "run.events") {
        return {
          events: [
            {
              name: "agent.text_delta",
              sequence: 1,
              scope: {
                run_id: "stored-run",
                workflow_run_id: "stored-run",
                agent_run_id: "agent-1",
              },
              payload: { node_id: "requirements", delta: "Stored output" },
              created_at: "2026-07-30T10:01:00+00:00",
            },
            {
              name: "workflow.completed",
              sequence: 2,
              scope: { run_id: "stored-run" },
              payload: {},
              created_at: "2026-07-30T10:02:00+00:00",
            },
          ],
        };
      }
      return {};
    });
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Runs" }));

    expect(await screen.findByText("Stored output")).toBeInTheDocument();
    expect(screen.getAllByText("Stored delivery").length).toBeGreaterThan(0);
  });

  it("streams an agent response in chat", async () => {
    invokeMock.mockImplementation(
      async (
        _command: string,
        args: { events: { onmessage?: (event: RunEvent) => void } },
      ) => {
        args.events.onmessage?.({ type: "started" });
        args.events.onmessage?.({ type: "text_delta", delta: "Streaming " });
        args.events.onmessage?.({ type: "text_delta", delta: "works." });
        args.events.onmessage?.({ type: "completed" });
      },
    );
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    const input = await screen.findByRole("textbox", { name: "Message" });
    fireEvent.change(input, { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("Streaming works.")).toBeInTheDocument();
    expect(within(screen.getByRole("log")).getByText("Hello")).toBeInTheDocument();
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "run_agent",
        expect.objectContaining({
          messages: [{ role: "user", content: "Hello" }],
          events: expect.anything(),
        }),
      );
    });
  });

  it("excludes failed assistant output from later chat history", async () => {
    let attempts = 0;
    invokeMock.mockImplementation(
      async (
        command: string,
        args: { events?: { onmessage?: (event: RunEvent) => void } },
      ) => {
        if (command !== "run_agent" || !args.events) {
          return {};
        }
        attempts += 1;
        args.events.onmessage?.({ type: "started" });
        if (attempts === 1) {
          args.events.onmessage?.({
            type: "failed",
            message: "Provider unavailable",
          });
          throw new Error("Provider unavailable");
        }
        args.events.onmessage?.({ type: "text_delta", delta: "Recovered" });
        args.events.onmessage?.({ type: "completed" });
        return {};
      },
    );
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    const input = await screen.findByRole("textbox", { name: "Message" });
    fireEvent.change(input, { target: { value: "First attempt" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Provider unavailable")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "Try again" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Recovered")).toBeInTheDocument();

    expect(invokeMock).toHaveBeenLastCalledWith(
      "run_agent",
      expect.objectContaining({
        messages: [
          { role: "user", content: "First attempt" },
          { role: "user", content: "Try again" },
        ],
      }),
    );
  });
});
