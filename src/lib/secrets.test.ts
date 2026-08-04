import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

import {
  deleteProviderSecret,
  getProviderSecret,
  setProviderSecret,
} from "@/lib/secrets";

describe("provider secrets", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.invoke.mockResolvedValue(undefined);
  });

  it("stores API keys in the provider namespace", async () => {
    await setProviderSecret("provider-1", "secret");

    expect(mocks.invoke).toHaveBeenCalledWith("set_secret", {
      key: "provider/provider-1",
      value: "secret",
    });
  });

  it("reads and deletes API keys", async () => {
    mocks.invoke.mockResolvedValueOnce("secret");

    await expect(getProviderSecret("provider-1")).resolves.toBe("secret");
    await deleteProviderSecret("provider-1");

    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "get_secret", {
      key: "provider/provider-1",
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "delete_secret", {
      key: "provider/provider-1",
    });
  });
});
