import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "@/App";

const contextUsage = (totalTokens: number) => ({
  cached_input_tokens: 0,
  input_tokens: 0,
  output_tokens: 0,
  reasoning_output_tokens: 0,
  total_tokens: totalTokens,
});

const contextUsageInfo = (totalTokens: number, modelContextWindow: number) => ({
  last_token_usage: contextUsage(totalTokens),
  model_context_window: modelContextWindow,
  total_token_usage: contextUsage(totalTokens),
});

describe("model context window regressions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refreshes the context capacity when the selected model changes", async () => {
    const user = userEvent.setup();
    let selectedModel = "gpt-5.1";
    const modelContextWindows: Record<string, number> = {
      "gpt-5.1": 272_000,
      "gpt-5.5": 1_050_000,
    };
    const appState = () => ({
      mcp_servers: [],
      messages: [],
      providers: [
        {
          api_key: "sk-local",
          base_url: "",
          id: "provider-openai",
          models: ["gpt-5.1", "gpt-5.5"],
          name: "OpenAI",
          type: "openai",
        },
      ],
      settings: {
        agent_prompt: "",
        reasoning_effort: "default",
        selected_model: selectedModel,
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
      usage_info: contextUsageInfo(30_000, modelContextWindows[selectedModel]),
      writable_paths: [],
    });

    vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
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
      if (input === "/api/settings" && init?.method === "PUT") {
        const settings = JSON.parse(String(init.body)) as {
          selected_model: string;
        };
        selectedModel = settings.selected_model;
        return new Response(init.body, {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      return new Response(JSON.stringify({}), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    });

    render(<App />);

    expect(await screen.findByText("30k / 272k")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Settings" }));
    await user.click(screen.getByRole("combobox", { name: "Model" }));
    await user.click(screen.getByRole("option", { name: "gpt-5.5" }));
    await user.click(screen.getByRole("tab", { name: "Workspace" }));

    expect(await screen.findByText("30k / 1050k")).toBeInTheDocument();
  });
});
