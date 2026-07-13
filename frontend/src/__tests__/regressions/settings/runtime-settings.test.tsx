import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "@/App";
import { selectedProviderState } from "@/test/app-fixtures";
import { mockSettingsAppRequests } from "@/test/settings-app-harness";

describe("Runtime settings", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, "", "/");
    window.localStorage.clear();
  });

  it("saves the selected Settings reasoning effort", async () => {
    const user = userEvent.setup();
    mockSettingsAppRequests();
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "Settings" }));
    await user.click(
      await screen.findByRole("combobox", { name: "Reasoning" }),
    );
    await user.click(screen.getByRole("option", { name: "XHigh" }));

    expect(
      screen.getByRole("combobox", { name: "Reasoning" }),
    ).toHaveTextContent("XHigh");
    expect(window.fetch).toHaveBeenCalledWith(
      "/api/settings",
      expect.objectContaining({
        body: JSON.stringify({
          agent_prompt: "",
          context_window_limit: null,
          reasoning_effort: "xhigh",
          selected_model: "gpt-5.1",
          selected_provider_id: "provider-openai",
        }),
        method: "PUT",
      }),
    );
  });

  it("loads and saves the configured Agent prompt from Settings", async () => {
    const user = userEvent.setup();
    mockSettingsAppRequests({
      initialSettings: {
        ...selectedProviderState().settings,
        agent_prompt: "Prefer careful implementation plans.",
      },
    });
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "Settings" }));
    const agentPrompt = screen.getByRole("textbox", {
      name: "Agent prompt",
    });

    expect(agentPrompt).toHaveValue("Prefer careful implementation plans.");

    await user.clear(agentPrompt);
    await user.type(agentPrompt, "Always inspect files before editing.");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(window.fetch).toHaveBeenCalledWith(
      "/api/settings",
      expect.objectContaining({
        body: JSON.stringify({
          agent_prompt: "Always inspect files before editing.",
          context_window_limit: null,
          reasoning_effort: "default",
          selected_model: "gpt-5.1",
          selected_provider_id: "provider-openai",
        }),
        method: "PUT",
      }),
    );
  });

  it("defaults Settings reasoning effort when persisted state has no value", async () => {
    const user = userEvent.setup();
    mockSettingsAppRequests({
      initialSettings: {
        selected_model: "gpt-5.1",
        selected_provider_id: "provider-openai",
      },
    });

    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "Settings" }));

    expect(
      screen.getByRole("combobox", { name: "Reasoning" }),
    ).toHaveTextContent("Default");
  });
});
