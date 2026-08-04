import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

import { deleteProviderSecret, setProviderSecret } from "@/lib/secrets";

describe("provider secrets", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.invoke.mockResolvedValue(undefined);
  });

  it("stores provider API keys", async () => {
    await setProviderSecret("provider-1", "secret");

    expect(mocks.invoke).toHaveBeenCalledWith("set_provider_secret", {
      providerId: "provider-1",
      value: "secret",
    });
  });

  it("deletes provider API keys", async () => {
    await deleteProviderSecret("provider-1");

    expect(mocks.invoke).toHaveBeenCalledWith("delete_provider_secret", {
      providerId: "provider-1",
    });
  });
});
