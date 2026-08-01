import { beforeEach, describe, expect, it, vi } from "vitest";

interface MockChannel {
  onmessage: (message: unknown) => void;
}

const mocks = vi.hoisted(() => ({
  channels: [] as MockChannel[],
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage: (message: unknown) => void;

    constructor(onmessage: (message: unknown) => void) {
      this.onmessage = onmessage;
      mocks.channels.push(this);
    }
  },
  invoke: mocks.invoke,
}));

describe("agent transport", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.channels.length = 0;
    mocks.invoke.mockReset();
    mocks.invoke.mockResolvedValue(undefined);
  });

  it("sends messages through the generic command", async () => {
    const { send } = await import("@/lib/agent");
    const message = { id: "ui-1", method: "app/info" };

    await send(message);

    expect(mocks.invoke).toHaveBeenCalledWith("send", { message });
  });

  it("shares one channel between subscribers", async () => {
    const { subscribe } = await import("@/lib/agent");
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = await subscribe(first);
    await subscribe(second);
    const message = { method: "runtime/ready", params: {} };

    mocks.channels[0]?.onmessage(message);
    stopFirst();
    mocks.channels[0]?.onmessage(message);

    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledWith("subscribe", {
      channel: mocks.channels[0],
    });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });
});
