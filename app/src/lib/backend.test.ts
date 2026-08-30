import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const channels: { onmessage?: (frame: unknown) => void }[] = [];

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
  Channel: class {
    onmessage?: (frame: unknown) => void;
    constructor() {
      channels.push(this);
    }
  },
}));

const { Backend, BackendError } = await import("./backend");

function connected() {
  const backend = new Backend();
  invoke.mockResolvedValue(undefined);
  return backend;
}

function reply(frame: Record<string, unknown>) {
  for (const channel of channels) channel.onmessage?.(frame);
}

describe("Backend", () => {
  beforeEach(() => {
    invoke.mockReset();
    channels.length = 0;
  });

  it("subscribes once and reuses the same channel", async () => {
    const backend = connected();
    await backend.connect();
    await backend.connect();
    expect(
      invoke.mock.calls.filter(([name]) => name === "subscribe"),
    ).toHaveLength(1);
  });

  it("correlates a response with its request id", async () => {
    const backend = connected();
    const promise = backend.createAgent("Main");
    await vi.waitFor(() =>
      expect(invoke.mock.calls.some(([name]) => name === "send")).toBe(true),
    );
    const [, payload] = invoke.mock.calls.find(([name]) => name === "send")!;
    const message = (payload as { message: { id: number; method: string } })
      .message;
    expect(message.method).toBe("organization.create_agent");

    reply({
      type: "response",
      id: message.id,
      result: { id: 2, name: "Main" },
    });
    await expect(promise).resolves.toMatchObject({ name: "Main" });
  });

  it("rejects with a typed error carrying the backend code", async () => {
    const backend = connected();
    const promise = backend.createAgent("  ");
    await vi.waitFor(() =>
      expect(invoke.mock.calls.some(([name]) => name === "send")).toBe(true),
    );
    const [, payload] = invoke.mock.calls.find(([name]) => name === "send")!;
    const { id } = (payload as { message: { id: number } }).message;

    reply({
      type: "response",
      id,
      error: { code: "invalid_name", message: "Member name must not be empty" },
    });
    await expect(promise).rejects.toBeInstanceOf(BackendError);
    await expect(promise).rejects.toMatchObject({ code: "invalid_name" });
  });

  it("keeps concurrent requests independent", async () => {
    const backend = connected();
    const first = backend.discussions();
    const second = backend.organization();
    await vi.waitFor(() =>
      expect(
        invoke.mock.calls.filter(([name]) => name === "send"),
      ).toHaveLength(2),
    );
    const ids = invoke.mock.calls
      .filter(([name]) => name === "send")
      .map(
        ([, payload]) => (payload as { message: { id: number } }).message.id,
      );
    expect(new Set(ids).size).toBe(2);

    reply({ type: "response", id: ids[1], result: { members: [] } });
    reply({ type: "response", id: ids[0], result: [] });
    await expect(first).resolves.toEqual([]);
    await expect(second).resolves.toMatchObject({ members: [] });
  });

  it("delivers non-response frames to event listeners", async () => {
    const backend = connected();
    const seen: unknown[] = [];
    backend.onEvent((event) => seen.push(event));
    await backend.connect();

    reply({ type: "message.created", discussion_id: 1, id: 4 });
    reply({ type: "turn.started", agent_id: 2 });
    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({
      type: "message.created",
      discussion_id: 1,
    });
  });

  it("does not leak responses into the event stream", async () => {
    const backend = connected();
    const seen: unknown[] = [];
    backend.onEvent((event) => seen.push(event));
    const promise = backend.discussions();
    await vi.waitFor(() =>
      expect(invoke.mock.calls.some(([name]) => name === "send")).toBe(true),
    );
    const [, payload] = invoke.mock.calls.find(([name]) => name === "send")!;
    const { id } = (payload as { message: { id: number } }).message;

    reply({ type: "response", id, result: [] });
    await promise;
    expect(seen).toHaveLength(0);
  });

  it("ignores a response for an unknown id", async () => {
    const backend = connected();
    await backend.connect();
    expect(() =>
      reply({ type: "response", id: 999, result: null }),
    ).not.toThrow();
  });

  it("unsubscribing stops delivery", async () => {
    const backend = connected();
    const seen: unknown[] = [];
    const off = backend.onEvent((event) => seen.push(event));
    await backend.connect();
    off();
    reply({ type: "member.created", id: 3 });
    expect(seen).toHaveLength(0);
  });
});
