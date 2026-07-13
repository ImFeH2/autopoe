import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "@/App";
import { selectedProviderState, type TestProvider } from "@/test/app-fixtures";
import { mockProviderAppRequests } from "@/test/provider-app-harness";

const provider = (updates: Partial<TestProvider> = {}): TestProvider => ({
  base_url: "",
  has_api_key: true,
  id: "provider-openai",
  models: ["gpt-5.1"],
  name: "OpenAI",
  type: "openai",
  ...updates,
});

describe("Provider management", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("starts provider setup from an empty provider sidebar", async () => {
    const user = userEvent.setup();
    mockProviderAppRequests();
    render(<App />);

    await user.click(screen.getByRole("tab", { name: "Providers" }));

    expect(screen.getByRole("button", { name: "New" })).toBeInTheDocument();
    expect(screen.getByText("No providers")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Provider name" })).toHaveValue(
      "",
    );
    expect(
      screen.getByRole("combobox", { name: "Provider type" }),
    ).toHaveTextContent("OpenAI");
    expect(screen.getByRole("textbox", { name: "Base URL" })).toHaveValue("");
    expect(screen.getByLabelText("Access key")).toBeInTheDocument();
    expect(screen.getByText("No models")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "New" }));

    expect(screen.getByRole("textbox", { name: "Provider name" })).toHaveValue(
      "",
    );
    expect(
      screen.getByRole("combobox", { name: "Provider type" }),
    ).toHaveTextContent("OpenAI");

    await user.click(screen.getByRole("combobox", { name: "Provider type" }));

    expect(screen.getByRole("option", { name: "OpenAI" })).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "OpenAI Responses" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Anthropic" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Gemini" })).toBeInTheDocument();
  });

  it("updates provider models from fetched model results", async () => {
    const user = userEvent.setup();
    mockProviderAppRequests({
      modelResults: ["claude-sonnet-4-5", "claude-haiku-4-5"],
    });
    render(<App />);

    await user.click(screen.getByRole("tab", { name: "Providers" }));
    await user.click(screen.getByRole("combobox", { name: "Provider type" }));
    await user.click(screen.getByRole("option", { name: "Anthropic" }));
    await user.click(screen.getByRole("button", { name: "Fetch" }));

    expect(window.fetch).toHaveBeenCalledWith(
      "/api/providers/models",
      expect.objectContaining({
        body: JSON.stringify({
          base_url: "",
          provider: "anthropic",
          provider_id: "new",
          secret_reference: "",
        }),
        method: "POST",
      }),
    );
    expect(await screen.findByText("claude-sonnet-4-5")).toBeInTheDocument();
    expect(screen.getByText("claude-haiku-4-5")).toBeInTheDocument();
  });

  it("updates Settings model options from the saved provider models", async () => {
    const user = userEvent.setup();
    mockProviderAppRequests({
      modelResults: ["gpt-5.1", "gpt-5.1-mini"],
    });
    render(<App />);

    await user.click(screen.getByRole("tab", { name: "Providers" }));
    await user.type(
      screen.getByRole("textbox", { name: "Provider name" }),
      "OpenAI",
    );
    await user.click(screen.getByRole("button", { name: "Fetch" }));
    expect(await screen.findByText("gpt-5.1-mini")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(screen.getByRole("tab", { name: "Settings" }));
    await user.click(screen.getByRole("combobox", { name: "Provider" }));
    await user.click(screen.getByRole("option", { name: "OpenAI" }));
    await user.click(screen.getByRole("combobox", { name: "Model" }));

    expect(screen.getByRole("option", { name: "gpt-5.1" })).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "gpt-5.1-mini" }),
    ).toBeInTheDocument();
  });

  it("switches to Settings and updates models for the selected provider", async () => {
    const user = userEvent.setup();
    mockProviderAppRequests();
    render(<App />);

    await user.click(screen.getByRole("tab", { name: "Settings" }));

    expect(
      screen.getByRole("combobox", { name: "Provider" }),
    ).toHaveTextContent("No providers");
    expect(screen.getByRole("combobox", { name: "Provider" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Model" })).toHaveTextContent(
      "No models",
    );
    expect(screen.getByRole("combobox", { name: "Model" })).toBeDisabled();
    expect(
      screen.getByRole("combobox", { name: "Reasoning" }),
    ).toHaveTextContent("Default");
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("loads persisted providers when the app starts", async () => {
    mockProviderAppRequests({
      initialState: {
        providers: [provider({ has_api_key: false })],
        settings: {
          selected_model: "",
          selected_provider_id: "",
        },
      },
    });

    render(<App />);
    await userEvent.click(
      await screen.findByRole("tab", { name: "Providers" }),
    );

    expect(screen.getByRole("button", { name: "OpenAI" })).toBeInTheDocument();
  });

  it("removes a saved provider and selects the nearest provider in the editor", async () => {
    const user = userEvent.setup();
    mockProviderAppRequests({
      initialState: {
        providers: [
          provider({ base_url: "https://api.example.test/v1" }),
          provider({
            id: "provider-anthropic",
            models: ["claude-sonnet-4-5"],
            name: "Anthropic",
            type: "anthropic",
          }),
          provider({
            id: "provider-gemini",
            models: ["gemini-3-pro"],
            name: "Gemini",
            type: "gemini",
          }),
        ],
        settings: {
          reasoning_effort: "default",
          selected_model: "gemini-3-pro",
          selected_provider_id: "provider-gemini",
        },
      },
    });

    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "Providers" }));
    await user.click(screen.getByRole("button", { name: "OpenAI" }));
    await user.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "OpenAI" }),
      ).not.toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: "Anthropic" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Gemini" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Provider name" })).toHaveValue(
      "Anthropic",
    );
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
    expect(window.fetch).toHaveBeenCalledWith(
      "/api/providers/provider-openai",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(window.fetch).not.toHaveBeenCalledWith(
      "/api/settings",
      expect.objectContaining({
        body: JSON.stringify({
          agent_prompt: "",
          context_window_limit: null,
          reasoning_effort: "default",
          selected_model: "",
          selected_provider_id: "",
        }),
        method: "PUT",
      }),
    );
    await user.click(screen.getByRole("tab", { name: "Settings" }));

    expect(
      screen.getByRole("combobox", { name: "Provider" }),
    ).toHaveTextContent("Gemini");
    expect(screen.getByRole("combobox", { name: "Model" })).toHaveTextContent(
      "gemini-3-pro",
    );
  });

  it("selects the nearest Settings provider and its first model when the active provider is removed", async () => {
    const user = userEvent.setup();
    mockProviderAppRequests({
      initialState: {
        providers: [
          provider({ base_url: "https://api.example.test/v1" }),
          provider({
            id: "provider-anthropic",
            models: ["claude-sonnet-4-5", "claude-haiku-4-5"],
            name: "Anthropic",
            type: "anthropic",
          }),
        ],
        settings: {
          reasoning_effort: "default",
          selected_model: "gpt-5.1",
          selected_provider_id: "provider-openai",
        },
      },
    });

    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "Providers" }));
    await user.click(screen.getByRole("button", { name: "OpenAI" }));
    await user.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "OpenAI" }),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByRole("textbox", { name: "Provider name" })).toHaveValue(
      "Anthropic",
    );
    await user.click(screen.getByRole("tab", { name: "Settings" }));

    expect(
      screen.getByRole("combobox", { name: "Provider" }),
    ).toHaveTextContent("Anthropic");
    expect(screen.getByRole("combobox", { name: "Model" })).toHaveTextContent(
      "claude-sonnet-4-5",
    );
    expect(window.fetch).toHaveBeenCalledWith(
      "/api/providers/provider-openai",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(window.fetch).toHaveBeenCalledWith(
      "/api/settings",
      expect.objectContaining({
        body: JSON.stringify({
          agent_prompt: "",
          context_window_limit: null,
          reasoning_effort: "default",
          selected_model: "claude-sonnet-4-5",
          selected_provider_id: "provider-anthropic",
        }),
        method: "PUT",
      }),
    );
  });

  it("selects the previous Settings provider when the removed active provider is last", async () => {
    const user = userEvent.setup();
    mockProviderAppRequests({
      initialState: {
        providers: [
          provider({ base_url: "https://api.example.test/v1" }),
          provider({
            id: "provider-anthropic",
            models: ["claude-sonnet-4-5"],
            name: "Anthropic",
            type: "anthropic",
          }),
        ],
        settings: {
          reasoning_effort: "default",
          selected_model: "claude-sonnet-4-5",
          selected_provider_id: "provider-anthropic",
        },
      },
    });

    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "Providers" }));
    await user.click(screen.getByRole("button", { name: "Anthropic" }));
    await user.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Anthropic" }),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByRole("textbox", { name: "Provider name" })).toHaveValue(
      "OpenAI",
    );
    await user.click(screen.getByRole("tab", { name: "Settings" }));

    expect(
      screen.getByRole("combobox", { name: "Provider" }),
    ).toHaveTextContent("OpenAI");
    expect(screen.getByRole("combobox", { name: "Model" })).toHaveTextContent(
      "gpt-5.1",
    );
    expect(window.fetch).toHaveBeenCalledWith(
      "/api/settings",
      expect.objectContaining({
        body: JSON.stringify({
          agent_prompt: "",
          context_window_limit: null,
          reasoning_effort: "default",
          selected_model: "gpt-5.1",
          selected_provider_id: "provider-openai",
        }),
        method: "PUT",
      }),
    );
  });

  it("clears the Settings provider and model when the last provider is removed", async () => {
    const user = userEvent.setup();
    mockProviderAppRequests({ initialState: selectedProviderState() });

    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "Providers" }));
    await user.click(screen.getByRole("button", { name: "OpenAI" }));
    await user.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(screen.getByText("No providers")).toBeInTheDocument();
    });
    expect(screen.getByRole("textbox", { name: "Provider name" })).toHaveValue(
      "",
    );
    await user.click(screen.getByRole("tab", { name: "Settings" }));

    expect(
      screen.getByRole("combobox", { name: "Provider" }),
    ).toHaveTextContent("No providers");
    expect(screen.getByRole("combobox", { name: "Provider" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Model" })).toHaveTextContent(
      "No models",
    );
    expect(screen.getByRole("combobox", { name: "Model" })).toBeDisabled();
    expect(window.fetch).toHaveBeenCalledWith(
      "/api/providers/provider-openai",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(window.fetch).toHaveBeenCalledWith(
      "/api/settings",
      expect.objectContaining({
        body: JSON.stringify({
          agent_prompt: "",
          context_window_limit: null,
          reasoning_effort: "default",
          selected_model: "",
          selected_provider_id: "",
        }),
        method: "PUT",
      }),
    );
  });

  it("loads persisted Settings selection when the app starts", async () => {
    const user = userEvent.setup();
    mockProviderAppRequests({
      initialState: {
        providers: [provider({ models: ["gpt-5.1", "gpt-5.1-mini"] })],
        settings: {
          reasoning_effort: "xhigh",
          selected_model: "gpt-5.1-mini",
          selected_provider_id: "provider-openai",
        },
      },
    });

    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "Settings" }));

    expect(
      screen.getByRole("combobox", { name: "Provider" }),
    ).toHaveTextContent("OpenAI");
    expect(screen.getByRole("combobox", { name: "Model" })).toHaveTextContent(
      "gpt-5.1-mini",
    );
    expect(
      screen.getByRole("combobox", { name: "Reasoning" }),
    ).toHaveTextContent("XHigh");
  });

  it("persists the model list when a provider is saved", async () => {
    const user = userEvent.setup();
    mockProviderAppRequests({ modelResults: ["gpt-5.1"] });

    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "Providers" }));
    await user.type(
      screen.getByRole("textbox", { name: "Provider name" }),
      "OpenAI",
    );
    await user.click(screen.getByRole("button", { name: "Fetch" }));
    expect(await screen.findByText("gpt-5.1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(window.fetch).toHaveBeenCalledWith(
      "/api/providers",
      expect.objectContaining({
        body: expect.stringContaining('"models":["gpt-5.1"]'),
        method: "POST",
      }),
    );
  });
});
