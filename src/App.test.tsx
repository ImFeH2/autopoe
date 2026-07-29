import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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

  it("shows the empty conversation", () => {
    render(<App />);

    expect(
      screen.getByRole("heading", { name: "What should we work on?" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Message" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("streams an agent response into the conversation", async () => {
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

    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
      target: { value: "Hello" },
    });
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

  it("does not send failed assistant errors as conversation history", async () => {
    invokeMock
      .mockImplementationOnce(
        async (
          _command: string,
          args: { events: { onmessage?: (event: RunEvent) => void } },
        ) => {
          args.events.onmessage?.({ type: "started" });
          args.events.onmessage?.({
            type: "failed",
            message: "Provider unavailable",
          });
          throw new Error("Provider unavailable");
        },
      )
      .mockImplementationOnce(
        async (
          _command: string,
          args: { events: { onmessage?: (event: RunEvent) => void } },
        ) => {
          args.events.onmessage?.({ type: "started" });
          args.events.onmessage?.({ type: "text_delta", delta: "Recovered" });
          args.events.onmessage?.({ type: "completed" });
        },
      );

    render(<App />);

    const input = screen.getByRole("textbox", { name: "Message" });
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
