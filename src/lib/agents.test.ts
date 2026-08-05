import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
}));

vi.mock("@/lib/agent", () => ({ request: mocks.request }));

import {
  archiveWorker,
  createWorker,
  listAgents,
  updateWorker,
} from "@/lib/agents";

const worker = {
  id: "worker-1",
  kind: "worker",
  name: "Backend Engineer",
  role: "Backend",
  status: "idle",
  model: "test",
  home: "/data/agents/worker-1/home",
};

describe("agents", () => {
  beforeEach(() => {
    mocks.request.mockReset();
  });

  it("lists project agents", async () => {
    mocks.request.mockResolvedValue([worker]);

    await expect(listAgents()).resolves.toEqual([worker]);
    expect(mocks.request).toHaveBeenCalledWith("agents/list");
  });

  it("creates and updates workers", async () => {
    mocks.request.mockResolvedValue(worker);

    await createWorker({ name: worker.name, role: worker.role });
    expect(mocks.request).toHaveBeenLastCalledWith("agents/create", {
      name: worker.name,
      role: worker.role,
    });

    await updateWorker(worker.id, { name: "API Engineer", role: "API" });
    expect(mocks.request).toHaveBeenLastCalledWith("agents/update", {
      id: worker.id,
      name: "API Engineer",
      role: "API",
    });
  });

  it("archives a worker", async () => {
    mocks.request.mockResolvedValue({ archived: worker.id });

    await archiveWorker(worker.id);

    expect(mocks.request).toHaveBeenCalledWith("agents/archive", {
      id: worker.id,
    });
  });
});
