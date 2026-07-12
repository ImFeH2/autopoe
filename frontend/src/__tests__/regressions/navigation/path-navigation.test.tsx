import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "@/App";

const workflow = {
  active_revision: null,
  created_at: 1,
  id: "workflow-draft",
  name: "Draft Workflow",
  presentation: {
    connections: {},
    nodes: {
      input: {
        description: "",
        name: "Input",
        position: { x: 80, y: 120 },
      },
      output: {
        description: "",
        name: "Output",
        position: { x: 360, y: 120 },
      },
    },
  },
  revision: 1,
  spec: {
    connections: [],
    nodes: [
      {
        config: { default_value: "", input_type: "text" },
        id: "input",
        kind: "input",
      },
      {
        config: { output_key: "result", transform: "" },
        id: "output",
        kind: "output",
      },
    ],
  },
  updated_at: 1,
};

const appState = () => ({
  mcp_servers: [],
  messages: [],
  providers: [],
  settings: {
    agent_prompt: "",
    context_window_limit: null,
    reasoning_effort: "default",
    selected_model: "",
    selected_provider_id: "",
  },
  skills: [],
  telegram_bot: {
    enabled: false,
    error: "",
    has_bot_token: false,
    sessions: [],
    status: "disabled",
  },
  workflows: [workflow],
  writable_paths: [],
});

const mockAppFetch = () => {
  vi.spyOn(window, "fetch").mockImplementation(async (input) => {
    if (input === "/api/state") {
      return new Response(JSON.stringify(appState()), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }

    if (input === "/api/about") {
      return new Response(JSON.stringify({}), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }

    return new Response(JSON.stringify({}), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  });
};

describe("path navigation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
  });

  it("writes sidebar pages as paths", async () => {
    const user = userEvent.setup();
    mockAppFetch();

    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "MCP" }));

    await waitFor(() => {
      expect(window.location.pathname).toBe("/mcp");
    });
    expect(window.location.search).toBe("");
    expect(screen.getByRole("tab", { name: "MCP" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("replaces legacy view query links with paths", async () => {
    mockAppFetch();
    window.history.replaceState(null, "", "/?view=mcp");

    render(<App />);

    await waitFor(() => {
      expect(window.location.pathname).toBe("/mcp");
    });
    expect(window.location.search).toBe("");
    expect(screen.getByRole("tab", { name: "MCP" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("keeps workflow paths in browser history", async () => {
    const user = userEvent.setup();
    mockAppFetch();

    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: "Draft Workflow" }),
    );

    await waitFor(() => {
      expect(window.location.pathname).toBe("/workflows/workflow-draft");
    });
    expect(screen.queryByRole("textbox", { name: "Workflow name" })).toBeNull();
    expect(await screen.findByRole("button", { name: "Run" })).toBeVisible();

    window.history.back();

    await waitFor(() => {
      expect(window.location.pathname).toBe("/");
    });
    expect(screen.getByRole("tab", { name: "Workspace" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
