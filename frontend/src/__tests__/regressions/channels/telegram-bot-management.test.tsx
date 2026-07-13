import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "@/App";
import type { TestTelegramBot, TestTelegramSession } from "@/test/app-fixtures";
import { mockChannelsAppRequests } from "@/test/channels-app-harness";

const telegramSession = (
  updates: Partial<TestTelegramSession> = {},
): TestTelegramSession => ({
  chat_id: "2001",
  display_name: "Alice Example",
  recent_message: "Can Flowent help here?",
  status: "pending",
  updated_at: 1,
  user_id: "1001",
  username: "alice",
  ...updates,
});

const telegramBot = (
  updates: Partial<TestTelegramBot> = {},
): TestTelegramBot => ({
  enabled: true,
  error: "",
  has_bot_token: true,
  sessions: [],
  status: "running",
  ...updates,
});

describe("Telegram Bot channel management", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, "", "/");
    window.localStorage.clear();
  });

  it("opens Channels as a global Telegram Bot page", async () => {
    const user = userEvent.setup();
    mockChannelsAppRequests();
    render(<App />);

    await user.click(screen.getByRole("tab", { name: "Channels" }));

    expect(
      await screen.findByRole("form", { name: "Telegram Bot" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Enabled" })).toHaveTextContent(
      "Off",
    );
    expect(screen.getByLabelText("Bot secret")).toBeInTheDocument();
    expect(screen.getByText("Disabled")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText("Approved")).toBeInTheDocument();
    expect(screen.getByText("No requests")).toBeInTheDocument();
    expect(screen.getByText("No conversations")).toBeInTheDocument();
  });

  it("saves the global Telegram Bot from Channels", async () => {
    const user = userEvent.setup();
    mockChannelsAppRequests();
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "Channels" }));
    await user.type(screen.getByLabelText("Bot secret"), "bot-secret");
    await user.click(screen.getByRole("combobox", { name: "Enabled" }));
    await user.click(screen.getByRole("option", { name: "On" }));
    await waitFor(() => {
      expect(
        screen.getByRole("combobox", { name: "Enabled" }),
      ).toHaveTextContent("On");
    });
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(window.fetch).toHaveBeenCalledWith(
      "/api/telegram-bot",
      expect.objectContaining({
        body: expect.stringContaining('"bot_token":"bot-secret"'),
        method: "PUT",
      }),
    );
    expect(window.fetch).toHaveBeenCalledWith(
      "/api/telegram-bot",
      expect.objectContaining({
        body: expect.stringContaining('"enabled":true'),
        method: "PUT",
      }),
    );
  });

  it("shows the selected Telegram Bot enabled value", async () => {
    const user = userEvent.setup();
    mockChannelsAppRequests();
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "Channels" }));
    await user.click(screen.getByRole("combobox", { name: "Enabled" }));
    await user.click(screen.getByRole("option", { name: "On" }));

    await waitFor(() => {
      expect(
        screen.getByRole("combobox", { name: "Enabled" }),
      ).toHaveTextContent("On");
    });
  });

  it("loads the persisted Telegram Bot when the app starts", async () => {
    const user = userEvent.setup();
    mockChannelsAppRequests({
      initialBot: telegramBot({
        sessions: [
          telegramSession({ recent_message: "Pair this chat" }),
          telegramSession({
            chat_id: "2002",
            display_name: "Launch Room",
            recent_message: "Draft the checklist",
            status: "approved",
            updated_at: 2,
            user_id: "1002",
            username: "bob",
          }),
        ],
      }),
    });

    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "Channels" }));

    expect(screen.getByLabelText("Bot secret")).toHaveValue("");
    expect(screen.getByLabelText("Bot secret")).toHaveAttribute(
      "placeholder",
      "Saved",
    );
    expect(screen.getByRole("combobox", { name: "Enabled" })).toHaveTextContent(
      "On",
    );
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Alice Example")).toBeInTheDocument();
    expect(screen.getByText("Launch Room")).toBeInTheDocument();
  });

  it("shows a Telegram Bot connection error in Channels", async () => {
    const user = userEvent.setup();
    mockChannelsAppRequests({
      initialBot: telegramBot({
        error: "Secret is invalid",
        status: "error",
      }),
    });

    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "Channels" }));

    expect(screen.getByText("Error")).toBeInTheDocument();
    expect(screen.getByText("Secret is invalid")).toBeInTheDocument();
  });

  it("shows pending Telegram conversations with request details", async () => {
    const user = userEvent.setup();
    mockChannelsAppRequests({
      initialBot: telegramBot({ sessions: [telegramSession()] }),
    });

    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "Channels" }));

    expect(screen.getByText("Alice Example")).toBeInTheDocument();
    expect(
      screen.getByText("Chat 2001 · User 1001 · @alice"),
    ).toBeInTheDocument();
    expect(screen.getByText("Can Flowent help here?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
  });

  it("approves a pending Telegram conversation from Channels", async () => {
    const user = userEvent.setup();
    mockChannelsAppRequests({
      initialBot: telegramBot({ sessions: [telegramSession()] }),
    });

    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "Channels" }));
    await user.click(screen.getByRole("button", { name: "Approve" }));

    expect(window.fetch).toHaveBeenCalledWith(
      "/api/telegram-bot/approve",
      expect.objectContaining({
        body: JSON.stringify({ chat_id: "2001" }),
        method: "POST",
      }),
    );
    await waitFor(() => {
      expect(screen.getByText("No requests")).toBeInTheDocument();
    });
    expect(screen.getByText("Alice Example")).toBeInTheDocument();
    expect(screen.getAllByText("Approved").length).toBeGreaterThan(1);
  });
});
