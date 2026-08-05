import { request } from "@/lib/agent";
import type { AgentInfo } from "@/lib/runtime";

export interface WorkerInput {
  name: string;
  role: string;
}

export async function listAgents(): Promise<AgentInfo[]> {
  const result = await request("agents/list");
  if (!Array.isArray(result)) {
    throw new Error("Invalid agent list");
  }
  return result.map(readAgent);
}

export async function createWorker(input: WorkerInput): Promise<AgentInfo> {
  return readAgent(
    await request("agents/create", {
      name: input.name,
      role: input.role,
    }),
  );
}

export async function updateWorker(
  agentId: string,
  input: WorkerInput,
): Promise<AgentInfo> {
  return readAgent(
    await request("agents/update", {
      id: agentId,
      name: input.name,
      role: input.role,
    }),
  );
}

export async function archiveWorker(agentId: string): Promise<void> {
  await request("agents/archive", { id: agentId });
}

function readAgent(value: unknown): AgentInfo {
  if (!isRecord(value)) {
    throw new Error("Invalid agent");
  }
  const { id, kind, name, role, status, model, home } = value;
  if (
    typeof id !== "string" ||
    (kind !== "leader" && kind !== "worker") ||
    typeof name !== "string" ||
    typeof role !== "string" ||
    !["idle", "running", "waiting", "failed"].includes(String(status)) ||
    (model !== null && typeof model !== "string") ||
    typeof home !== "string"
  ) {
    throw new Error("Invalid agent");
  }
  return {
    id,
    kind,
    name,
    role,
    status: status as AgentInfo["status"],
    model,
    home,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
