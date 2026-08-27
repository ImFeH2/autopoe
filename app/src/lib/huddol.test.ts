import { describe, expect, it, vi } from "vitest";
import {
  type HuddolChannel,
  HuddolClient,
  HuddolRequestError,
} from "@/lib/huddol";

function createHarness() {
  const channel: HuddolChannel = { onmessage: () => undefined };
  const commands: Array<{ command: string; args?: Record<string, unknown> }> =
    [];
  const invokeCommand = vi.fn(
    async (command: string, args?: Record<string, unknown>) => {
      commands.push({ command, args });
      return undefined;
    },
  );
  const client = new HuddolClient({
    channelFactory: () => channel,
    invokeCommand,
    timeoutMs: 100,
  });
  return { channel, client, commands, invokeCommand };
}

function sentMessage(commands: ReturnType<typeof createHarness>["commands"]) {
  return commands.find(({ command }) => command === "send")?.args?.message as {
    id: number;
    method: string;
    params: Record<string, unknown>;
  };
}

describe("HuddolClient", () => {
  it("subscribes once before sending JSON requests and correlates responses", async () => {
    const { channel, client, commands, invokeCommand } = createHarness();

    const first = client.request("organization.get");
    await vi.waitFor(() => expect(invokeCommand).toHaveBeenCalledTimes(2));
    const firstMessage = sentMessage(commands);
    expect(commands[0]).toEqual({
      command: "subscribe",
      args: { channel },
    });
    expect(firstMessage).toEqual({
      id: 1,
      method: "organization.get",
      params: {},
    });
    channel.onmessage({
      id: firstMessage.id,
      result: { organization: { id: 1 } },
    });
    await expect(first).resolves.toEqual({ organization: { id: 1 } });

    const second = client.request("organization.create_agent", { name: "Ada" });
    await vi.waitFor(() => expect(invokeCommand).toHaveBeenCalledTimes(3));
    const secondMessage = commands[2].args?.message as { id: number };
    expect(secondMessage.id).toBe(2);
    channel.onmessage({ id: secondMessage.id, result: null });
    await expect(second).resolves.toBeNull();
    expect(
      commands.filter(({ command }) => command === "subscribe"),
    ).toHaveLength(1);
  });

  it("dispatches backend events without disturbing pending requests", async () => {
    const { channel, client, commands, invokeCommand } = createHarness();
    const events: Array<{ event: string; data: unknown }> = [];
    const unsubscribe = client.onEvent((event, data) =>
      events.push({ event, data }),
    );
    const response = client.request("organization.get");
    await vi.waitFor(() => expect(invokeCommand).toHaveBeenCalledTimes(2));

    channel.onmessage({
      event: "agent.history.updated",
      data: { agent_id: 2, type: "text_delta" },
    });
    expect(events).toEqual([
      {
        event: "agent.history.updated",
        data: { agent_id: 2, type: "text_delta" },
      },
    ]);

    channel.onmessage({ id: sentMessage(commands).id, result: { ok: true } });
    await expect(response).resolves.toEqual({ ok: true });
    unsubscribe();
  });

  it("rejects the matching request when Python returns a JSON error", async () => {
    const { channel, client, commands, invokeCommand } = createHarness();

    const response = client.request("organization.create_agent", { name: "" });
    await vi.waitFor(() => expect(invokeCommand).toHaveBeenCalledTimes(2));
    channel.onmessage({
      id: sentMessage(commands).id,
      error: { code: "invalid_name", message: "Agent name is required" },
    });

    await expect(response).rejects.toEqual(
      new HuddolRequestError("invalid_name", "Agent name is required"),
    );
  });

  it("rejects a request when the Rust send command fails", async () => {
    const channel: HuddolChannel = { onmessage: () => undefined };
    const invokeCommand = vi.fn(
      async (command: string, _args?: Record<string, unknown>) => {
        if (command === "send") {
          throw new Error("Huddol stopped");
        }
        return undefined;
      },
    );
    const client = new HuddolClient({
      channelFactory: () => channel,
      invokeCommand,
      timeoutMs: 100,
    });

    await expect(client.request("organization.get")).rejects.toThrow(
      "Huddol stopped",
    );
  });

  it("rejects malformed JSON envelopes received through the Channel", async () => {
    const { channel, client, invokeCommand } = createHarness();

    const response = client.request("organization.get");
    await vi.waitFor(() => expect(invokeCommand).toHaveBeenCalledTimes(2));
    channel.onmessage({ id: 1, result: {}, error: { message: "no" } });

    await expect(response).rejects.toThrow("expected result or error");
  });

  it("times out when Huddol does not return JSON for a request", async () => {
    vi.useFakeTimers();
    const { client } = createHarness();
    const response = expect(client.request("organization.get")).rejects.toThrow(
      "Huddol response timed out: organization.get",
    );
    await vi.advanceTimersByTimeAsync(101);

    await response;
    vi.useRealTimers();
  });
});
