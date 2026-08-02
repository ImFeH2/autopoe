import { describe, expect, it } from "vitest";

import {
  chatMessage,
  initialRuntimeState,
  reduceRuntimeMessage,
  stateRequest,
} from "@/lib/runtime";

const agent = {
  id: "leader",
  name: "Leader",
  role: "Leader",
  status: "running",
  model: "test",
  home: "/data/projects/default/agents/leader/home",
};

const turn = {
  id: "turn-1",
  status: "running",
  context: {
    instructions: "",
    input: "Hello",
    messages: [],
    tools: ["read_home_file"],
  },
  events: [{ kind: "started" }],
  usage: null,
  error: null,
};

describe("runtime protocol", () => {
  it("creates state and chat messages", () => {
    expect(stateRequest("state-1")).toEqual({
      id: "state-1",
      method: "state/get",
    });
    expect(chatMessage("Hello")).toEqual({
      method: "chat/send",
      params: { content: "Hello" },
    });
  });

  it("reduces a streamed turn", () => {
    const started = reduceRuntimeMessage(initialRuntimeState, {
      method: "turn/started",
      params: {
        agent,
        user_message: {
          id: "turn-1-user",
          author: "user",
          content: "Hello",
          status: "complete",
        },
        agent_message: {
          id: "turn-1-agent",
          author: "leader",
          content: "",
          status: "streaming",
        },
        turn,
      },
    });
    const streamed = reduceRuntimeMessage(started, {
      method: "turn/event",
      params: {
        turn_id: "turn-1",
        event: { kind: "text_delta", content: "Flowent" },
      },
    });
    const completed = reduceRuntimeMessage(streamed, {
      method: "turn/completed",
      params: {
        agent: { ...agent, status: "idle" },
        message: {
          id: "turn-1-agent",
          author: "leader",
          content: "Flowent",
          status: "complete",
        },
        turn: {
          ...turn,
          status: "completed",
          usage: { requests: 1, input_tokens: 4, output_tokens: 1 },
        },
      },
    });

    expect(streamed.messages[1]?.content).toBe("Flowent");
    expect(streamed.turn?.events).toHaveLength(2);
    expect(completed.agent?.status).toBe("idle");
    expect(completed.messages[1]?.status).toBe("complete");
    expect(completed.turn?.status).toBe("completed");
  });

  it("restores a runtime snapshot", () => {
    const state = reduceRuntimeMessage(initialRuntimeState, {
      id: "state-1",
      result: {
        agent: { ...agent, status: "idle" },
        messages: [],
        last_turn: null,
      },
    });

    expect(state.connection).toBe("ready");
    expect(state.agent?.name).toBe("Leader");
  });
});
