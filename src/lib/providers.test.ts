import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
}));

vi.mock("@/lib/agent", () => ({ request: mocks.request }));

import {
  deleteProvider,
  fetchProviderModels,
  listProviders,
  saveProvider,
} from "@/lib/providers";

describe("providers", () => {
  beforeEach(() => {
    mocks.request.mockReset();
  });

  it("maps provider metadata from the sidecar", async () => {
    mocks.request.mockResolvedValue([
      {
        id: "provider-1",
        name: "OpenAI",
        type: "openai",
        base_url: "https://api.openai.com/v1",
      },
    ]);

    await expect(listProviders()).resolves.toEqual([
      {
        id: "provider-1",
        name: "OpenAI",
        type: "openai",
        baseUrl: "https://api.openai.com/v1",
      },
    ]);
    expect(mocks.request).toHaveBeenCalledWith("providers/list");
  });

  it("saves provider metadata without an API key", async () => {
    mocks.request.mockResolvedValue({
      id: "provider-1",
      name: "Local",
      type: "openai-compatible",
      base_url: "http://localhost:11434/v1",
    });

    await saveProvider({
      id: null,
      name: "Local",
      type: "openai-compatible",
      baseUrl: "http://localhost:11434/v1",
    });

    expect(mocks.request).toHaveBeenCalledWith("providers/save", {
      id: null,
      name: "Local",
      type: "openai-compatible",
      base_url: "http://localhost:11434/v1",
    });
  });

  it("fetches models with a temporary API key", async () => {
    mocks.request.mockResolvedValue([{ id: "model-1", name: "Model 1" }]);

    await expect(fetchProviderModels("provider-1", "secret")).resolves.toEqual([
      { id: "model-1", name: "Model 1" },
    ]);
    expect(mocks.request).toHaveBeenCalledWith("providers/models", {
      id: "provider-1",
      api_key: "secret",
    });
  });

  it("deletes provider metadata", async () => {
    mocks.request.mockResolvedValue({ deleted: "provider-1" });

    await deleteProvider("provider-1");

    expect(mocks.request).toHaveBeenCalledWith("providers/delete", {
      id: "provider-1",
    });
  });
});
