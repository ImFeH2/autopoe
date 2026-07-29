import { Channel, invoke } from "@tauri-apps/api/core";
import type { AgentMessage, RunEvent } from "@/types/agent";

export async function runAgent(
  messages: AgentMessage[],
  onEvent: (event: RunEvent) => void,
) {
  const events = new Channel<RunEvent>();
  events.onmessage = onEvent;

  await invoke("run_agent", { messages, events });
}
