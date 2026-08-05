import { describe, expect, it } from "vitest";

import {
  approvalResponse,
  chatMessage,
  initialRuntimeState,
  projectOpenRequest,
  reduceRuntimeMessage,
  runtimeError,
  stateRequest,
} from "@/lib/runtime";

const agent = {
  id: "leader",
  kind: "leader" as const,
  name: "Leader",
  role: "Leader",
  status: "running" as const,
  model: "test",
  home: "/data/projects/default/agents/leader/home",
};

const project = {
  id: "project-1",
  name: "Flowent",
  workspace: "/projects/flowent",
};

const turn = {
  id: "turn-1",
  status: "running" as const,
  context: {
    instructions: "",
    input: "Hello",
    messages: [],
    tools: [
      "list_files",
      "read_file",
      "search_files",
      "write_file",
      "replace_in_file",
      "run_command",
    ],
  },
  events: [{ kind: "started" }],
  usage: null,
  error: null,
};

describe("runtime protocol", () => {
  it("creates state, project, and chat messages", () => {
    expect(stateRequest("state-1")).toEqual({
      id: "state-1",
      method: "state/get",
    });
    expect(chatMessage("Hello")).toEqual({
      method: "chat/send",
      params: { content: "Hello" },
    });
    expect(approvalResponse("desktop-1", true)).toEqual({
      id: "desktop-1",
      result: true,
    });
    expect(projectOpenRequest("project-1", project.workspace)).toEqual({
      id: "project-1",
      method: "project/open",
      params: { workspace: project.workspace },
    });
  });

  it("reduces a streamed turn", () => {
    const started = reduceRuntimeMessage(initialRuntimeState, {
      method: "turn/started",
      params: {
        agent,
        user_message: {
          id: "turn-1-user",
          chat_id: "general",
          turn_id: "turn-1",
          author: "user",
          content: "Hello",
          status: "complete",
        },
        agent_message: {
          id: "turn-1-agent",
          chat_id: "general",
          turn_id: "turn-1",
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
          chat_id: "general",
          turn_id: "turn-1",
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
        project,
        agent: { ...agent, status: "idle" },
        agents: [{ ...agent, status: "idle" }],
        chat: { id: "general", title: "General", purpose: "" },
        messages: [],
        last_turn: null,
      },
    });

    expect(state.connection).toBe("ready");
    expect(state.project).toEqual(project);
    expect(state.agent?.name).toBe("Leader");
  });

  it("keeps a restored failed turn in the conversation", () => {
    const state = reduceRuntimeMessage(initialRuntimeState, {
      id: "state-1",
      result: {
        project,
        agent: { ...agent, status: "failed" },
        agents: [{ ...agent, status: "failed" }],
        chat: { id: "general", title: "General", purpose: "" },
        messages: [
          {
            id: "turn-1-agent",
            chat_id: "general",
            turn_id: "turn-1",
            author: "leader",
            content: "Model unavailable",
            status: "failed",
          },
        ],
        last_turn: {
          ...turn,
          status: "failed",
          error: "Model unavailable",
        },
      },
    });

    expect(state.error).toBeNull();
    expect(state.messages[0]?.content).toBe("Model unavailable");
    expect(state.turn?.status).toBe("failed");
  });

  it("updates the active agent model", () => {
    const state = reduceRuntimeMessage(
      {
        ...initialRuntimeState,
        agent: { ...agent, model: null },
        error: "model is not configured",
      },
      {
        method: "agent/updated",
        params: { ...agent, status: "idle", model: "gpt-5.4" },
      },
    );

    expect(state.agent?.model).toBe("gpt-5.4");
    expect(state.error).toBeNull();
  });

  it("updates the project agent directory", () => {
    const worker = {
      ...agent,
      id: "worker-1",
      kind: "worker" as const,
      name: "Backend Engineer",
      role: "Backend",
      status: "idle" as const,
    };
    const state = reduceRuntimeMessage(
      { ...initialRuntimeState, agent, agents: [agent] },
      {
        method: "agents/updated",
        params: { agents: [agent, worker] },
      },
    );

    expect(state.agent?.id).toBe("leader");
    expect(state.agents).toEqual([agent, worker]);
  });

  it("tracks a command approval until it is resolved", () => {
    const requested = reduceRuntimeMessage(
      { ...initialRuntimeState, turn },
      {
        id: "desktop-1",
        method: "approval/request",
        params: {
          turn_id: "turn-1",
          agent_id: "leader",
          tool_call_id: "command-1",
          tool: "run_command",
          input: {
            space: "workspace",
            command: "pnpm test",
          },
        },
      },
    );
    const resolved = reduceRuntimeMessage(requested, {
      method: "turn/event",
      params: {
        turn_id: "turn-1",
        event: {
          kind: "approval_resolved",
          tool_call_id: "command-1",
          approved: true,
        },
      },
    });

    expect(requested.approval?.input.command).toBe("pnpm test");
    expect(resolved.approval).toBeNull();
  });

  it("restores an empty project state", () => {
    const state = reduceRuntimeMessage(initialRuntimeState, {
      id: "state-1",
      result: {
        project: null,
        agent: null,
        agents: [],
        chat: null,
        messages: [],
        last_turn: null,
      },
    });

    expect(state.connection).toBe("ready");
    expect(state.project).toBeNull();
    expect(state.agent).toBeNull();
  });

  it("reports a project error without disconnecting the runtime", () => {
    const state = runtimeError(
      { ...initialRuntimeState, connection: "ready" },
      new Error("Workspace is unavailable"),
    );

    expect(state.connection).toBe("ready");
    expect(state.error).toBe("Workspace is unavailable");
  });
});
