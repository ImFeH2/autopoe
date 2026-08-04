import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
}));

vi.mock("@/lib/agent", () => ({ request: mocks.request }));

import { getDefaultModel, setDefaultModel } from "@/lib/models";

describe("default model", () => {
  beforeEach(() => {
    mocks.request.mockReset();
  });

  it("reads an empty model selection", async () => {
    mocks.request.mockResolvedValue(null);

    await expect(getDefaultModel()).resolves.toBeNull();
    expect(mocks.request).toHaveBeenCalledWith("model/get");
  });

  it("saves a model selection", async () => {
    mocks.request.mockResolvedValue({
      provider_id: "provider-1",
      model_id: "model-1",
    });

    await expect(
      setDefaultModel({ providerId: "provider-1", modelId: "model-1" }),
    ).resolves.toEqual({ providerId: "provider-1", modelId: "model-1" });
    expect(mocks.request).toHaveBeenCalledWith("model/set", {
      provider_id: "provider-1",
      model_id: "model-1",
    });
  });
});
