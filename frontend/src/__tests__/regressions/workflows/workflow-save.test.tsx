import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "@/App";

const singleInputWorkflow = () => ({
  created_at: 1710000020,
  definition: {
    edges: [],
    nodes: [
      {
        data: { default_value: "", input_type: "text" },
        description: "",
        id: "input",
        name: "Input",
        position: { x: 0, y: 0 },
        type: "input",
      },
    ],
    version: 1,
  },
  id: "workflow-draft",
  name: "Draft Workflow",
  updated_at: 1710000030,
});

const selectedProviderState = () => ({
  mcp_servers: [],
  messages: [],
  providers: [
    {
      api_key: "sk-local",
      base_url: "",
      id: "provider-openai",
      models: ["gpt-5.1"],
      name: "OpenAI",
      type: "openai",
    },
  ],
  settings: {
    reasoning_effort: "default",
    selected_model: "gpt-5.1",
    selected_provider_id: "provider-openai",
  },
  skills: [],
  telegram_bot: {
    bot_token: "",
    enabled: false,
    error: "",
    sessions: [],
    status: "disabled",
  },
  workflows: [singleInputWorkflow()],
});

describe("workflow save regressions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the specific run problem for a saved incomplete workflow draft", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      if (input === "/api/state") {
        return new Response(JSON.stringify(selectedProviderState()), {
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
      if (input === "/api/workflows" && init?.method === "PUT") {
        return new Response(String(init.body), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (
        typeof input === "string" &&
        input === "/api/workflows/workflow-draft/run" &&
        init?.method === "POST"
      ) {
        return new Response(
          JSON.stringify({ detail: "Workflow needs an output node." }),
          {
            headers: { "Content-Type": "application/json" },
            status: 400,
          },
        );
      }
      return new Response(JSON.stringify({}), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    });

    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: "Draft Workflow" }),
    );
    await user.click(screen.getByRole("button", { name: "Run" }));

    expect(
      await screen.findByText("Workflow needs an output node."),
    ).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("Run could not be completed.");
  });
});
