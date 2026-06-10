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

  it("subtracts fixed context overhead from the displayed capacity percent", async () => {
    vi.spyOn(window, "fetch").mockImplementation(async (input) => {
      if (input === "/api/state") {
        return new Response(
          JSON.stringify({
            mcp_servers: [],
            messages: [],
            providers: [],
            settings: {
              agent_prompt: "",
              reasoning_effort: "default",
              selected_model: "gpt-5.1",
              selected_provider_id: "",
            },
            skills: [],
            telegram_bot: {
              bot_token: "",
              enabled: false,
              error: "",
              sessions: [],
              status: "disabled",
            },
            usage_info: contextUsageInfo(12_000, 120_000),
            writable_paths: [],
          }),
          {
            headers: { "Content-Type": "application/json" },
            status: 200,
          },
        );
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

    render(<App />);

    expect(await screen.findByText("12k / 120k")).toBeInTheDocument();
    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", { name: "Context capacity status" }),
    ).toHaveAttribute("aria-valuenow", "0");
  });

  it("estimates draft context with UTF-8 bytes", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "fetch").mockImplementation(async (input) => {
      if (input === "/api/state") {
        return new Response(
          JSON.stringify({
            mcp_servers: [],
            messages: [],
            providers: [],
            settings: {
              agent_prompt: "",
              reasoning_effort: "default",
              selected_model: "gpt-5.1",
              selected_provider_id: "",
            },
            skills: [],
            telegram_bot: {
              bot_token: "",
              enabled: false,
              error: "",
              sessions: [],
              status: "disabled",
            },
            usage_info: null,
            writable_paths: [],
          }),
          {
            headers: { "Content-Type": "application/json" },
            status: 200,
          },
        );
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

    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "你你你你");

    expect(await screen.findByText("3 / 120k")).toBeInTheDocument();
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

  it("uses a saved manual context limit for the context capacity", async () => {
    const user = userEvent.setup();
    let contextWindowLimit: number | null = null;
    const appState = () => ({
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
        agent_prompt: "",
        context_window_limit: contextWindowLimit,
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
      usage_info: contextUsageInfo(30_000, contextWindowLimit ?? 272_000),
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
          context_window_limit: number | null;
        };
        contextWindowLimit = settings.context_window_limit;
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
    await user.click(screen.getByRole("combobox", { name: "Context window" }));
    await user.click(screen.getByRole("option", { name: "Manual" }));
    await user.type(
      screen.getByRole("textbox", { name: "Context size" }),
      "64000",
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(screen.getByRole("tab", { name: "Workspace" }));

    expect(await screen.findByText("30k / 64k")).toBeInTheDocument();
  });

  it("uses a saved manual context limit when no usage exists yet", async () => {
    const user = userEvent.setup();
    let contextWindowLimit: number | null = null;
    const appState = () => ({
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
        agent_prompt: "",
        context_window_limit: contextWindowLimit,
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
      usage_info: null,
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
          context_window_limit: number | null;
        };
        contextWindowLimit = settings.context_window_limit;
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

    expect(await screen.findByText("0 / 120k")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Settings" }));
    await user.click(screen.getByRole("combobox", { name: "Context window" }));
    await user.click(screen.getByRole("option", { name: "Manual" }));
    await user.type(
      screen.getByRole("textbox", { name: "Context size" }),
      "64000",
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(screen.getByRole("tab", { name: "Workspace" }));

    expect(await screen.findByText("0 / 64k")).toBeInTheDocument();
  });

  it("keeps the manual context limit when the selected model changes", async () => {
    const user = userEvent.setup();
    let selectedModel = "gpt-5.1";
    let contextWindowLimit: number | null = 64_000;
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
        context_window_limit: contextWindowLimit,
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
      usage_info: contextUsageInfo(
        30_000,
        contextWindowLimit ?? modelContextWindows[selectedModel],
      ),
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
          context_window_limit: number | null;
          selected_model: string;
        };
        contextWindowLimit = settings.context_window_limit;
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

    expect(await screen.findByText("30k / 64k")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Settings" }));
    await user.click(screen.getByRole("combobox", { name: "Model" }));
    await user.click(screen.getByRole("option", { name: "gpt-5.5" }));
    await user.click(screen.getByRole("tab", { name: "Workspace" }));

    expect(await screen.findByText("30k / 64k")).toBeInTheDocument();
  });

  it.each(["0", "-1", "abc"])(
    "prevents saving an invalid manual context limit: %s",
    async (contextLimitDraft) => {
      const user = userEvent.setup();
      const settingsRequests: unknown[] = [];
      const appState = () => ({
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
          agent_prompt: "",
          context_window_limit: null,
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
        usage_info: contextUsageInfo(30_000, 272_000),
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
          settingsRequests.push(JSON.parse(String(init.body)));
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

      await screen.findByText("30k / 272k");

      await user.click(screen.getByRole("tab", { name: "Settings" }));
      await user.click(
        screen.getByRole("combobox", { name: "Context window" }),
      );
      await user.click(screen.getByRole("option", { name: "Manual" }));
      await user.type(
        screen.getByRole("textbox", { name: "Context size" }),
        contextLimitDraft,
      );

      expect(screen.getByText("Enter a positive integer")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
      expect(settingsRequests).toEqual([]);
    },
  );
});
