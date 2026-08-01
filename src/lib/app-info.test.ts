import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { getAppInfo } from "@/lib/app-info";

describe("getAppInfo", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("loads app information through Tauri", async () => {
    const info = { name: "Flowent", version: "0.0.0" };
    invoke.mockResolvedValue(info);

    await expect(getAppInfo()).resolves.toEqual(info);
    expect(invoke).toHaveBeenCalledWith("get_app_info");
  });
});
