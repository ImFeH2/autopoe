import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "@/App";

const appState = () => ({
  mcp_servers: [],
  messages: [],
  providers: [
    {
      base_url: "https://api.example.test/v1",
      has_api_key: true,
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
    enabled: false,
    error: "",
    has_bot_token: true,
    sessions: [],
    status: "disabled",
  },
  workflows: [],
  writable_paths: [],
});

const jsonResponse = (body: object) =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });

const mockAppFetch = () => {
  vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
    if (input === "/api/state") {
      return jsonResponse(appState());
    }
    if (input === "/api/about") {
      return jsonResponse({});
    }
    if (input === "/api/providers/models" && init?.method === "POST") {
      return jsonResponse({ models: ["gpt-5.1", "gpt-5.1-mini"] });
    }
    if (input === "/api/providers" && init?.method === "POST") {
      const request = JSON.parse(String(init.body)) as {
        base_url: string;
        id: string;
        models: string[];
        name: string;
        type: "openai";
      };
      return jsonResponse({
        base_url: request.base_url,
        has_api_key: true,
        id: request.id,
        models: request.models,
        name: request.name,
        type: request.type,
      });
    }
    if (input === "/api/telegram-bot" && init?.method === "PUT") {
      const request = JSON.parse(String(init.body)) as { enabled: boolean };
      return jsonResponse({
        enabled: request.enabled,
        error: "",
        has_bot_token: true,
        sessions: [],
        status: "disabled",
      });
    }
    return new Response(null, { status: 404 });
  });
};

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

describe("saved credentials", () => {
  it("keeps a saved Provider key out of the input and reuses it for Fetch", async () => {
    const user = userEvent.setup();
    mockAppFetch();
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "Providers" }));
    await user.click(await screen.findByRole("button", { name: "OpenAI" }));
    const accessKey = await screen.findByLabelText("Access key");

    expect(accessKey).toHaveValue("");
    expect(accessKey).toHaveAttribute("placeholder", "Saved");

    await user.click(screen.getByRole("button", { name: "Fetch" }));

    expect(window.fetch).toHaveBeenCalledWith(
      "/api/providers/models",
      expect.objectContaining({
        body: JSON.stringify({
          base_url: "https://api.example.test/v1",
          provider: "openai",
          provider_id: "provider-openai",
          secret_reference: "",
        }),
      }),
    );

    await user.click(screen.getByRole("button", { name: "Save" }));
    const saveWithoutReplacement = vi
      .mocked(window.fetch)
      .mock.calls.find(
        ([input, init]) =>
          input === "/api/providers" && init?.method === "POST",
      );
    expect(saveWithoutReplacement).toBeDefined();
    expect(
      JSON.parse(String(saveWithoutReplacement?.[1]?.body)),
    ).not.toHaveProperty("api_key");

    await user.type(accessKey, "connection-replacement");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(accessKey).toHaveValue(""));
    expect(accessKey).toHaveAttribute("placeholder", "Saved");
    expect(window.fetch).toHaveBeenCalledWith(
      "/api/providers",
      expect.objectContaining({
        body: expect.stringContaining('"api_key":"connection-replacement"'),
      }),
    );
  });

  it("keeps a saved Telegram secret out of the input and clears replacements", async () => {
    const user = userEvent.setup();
    mockAppFetch();
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "Channels" }));
    const botSecret = await screen.findByLabelText("Bot secret");

    expect(botSecret).toHaveValue("");
    expect(botSecret).toHaveAttribute("placeholder", "Saved");

    await user.click(screen.getByRole("button", { name: "Save" }));

    const saveWithoutReplacement = vi
      .mocked(window.fetch)
      .mock.calls.find(
        ([input, init]) =>
          input === "/api/telegram-bot" && init?.method === "PUT",
      );
    expect(saveWithoutReplacement).toBeDefined();
    expect(
      JSON.parse(String(saveWithoutReplacement?.[1]?.body)),
    ).not.toHaveProperty("bot_token");

    await user.type(botSecret, "telegram-replacement");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(botSecret).toHaveValue(""));
    expect(botSecret).toHaveAttribute("placeholder", "Saved");
    expect(window.fetch).toHaveBeenCalledWith(
      "/api/telegram-bot",
      expect.objectContaining({
        body: expect.stringContaining('"bot_token":"telegram-replacement"'),
      }),
    );
  });
});
