import type { Message, Request } from "@/lib/agent";

export interface AppInfo {
  name: string;
  version: string;
}

export type AppInfoReply =
  | { status: "ready"; info: AppInfo }
  | { status: "error" }
  | undefined;

export function appInfoRequest(id: string): Request {
  return { id, method: "app/info" };
}

export function readAppInfoReply(message: Message, id: string): AppInfoReply {
  if (!("id" in message) || message.id !== id) {
    return undefined;
  }
  if ("error" in message) {
    return { status: "error" };
  }
  if (
    !("result" in message) ||
    typeof message.result !== "object" ||
    message.result === null ||
    Array.isArray(message.result)
  ) {
    return { status: "error" };
  }

  const { name, version } = message.result;
  if (typeof name !== "string" || typeof version !== "string") {
    return { status: "error" };
  }
  return { status: "ready", info: { name, version } };
}
