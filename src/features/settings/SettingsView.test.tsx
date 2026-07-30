import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Theme } from "@radix-ui/themes";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsView } from "@/features/settings/SettingsView";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

describe("SettingsView", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(
      async (
        _command: string,
        args: { name: string; payload: Record<string, unknown> },
      ) => {
        if (args.name === "settings.get") {
          return {
            model: {
              provider: "openai",
              model: "gpt-5.1",
              api_mode: "responses",
              credential_id: "default",
            },
            runtime: { default_workspace_mode: "worktree" },
            has_api_key: true,
            credential_store_available: true,
          };
        }
        return {
          model: args.payload.model,
          runtime: args.payload.runtime,
          has_api_key: true,
          credential_store_available: true,
        };
      },
    );
  });

  it("loads and saves model settings without exposing the stored key", async () => {
    render(
      <Theme appearance="dark">
        <SettingsView />
      </Theme>,
    );

    const model = await screen.findByDisplayValue("gpt-5.1");
    expect(screen.getByPlaceholderText("Stored securely")).toHaveValue("");
    fireEvent.change(model, { target: { value: "gpt-5.2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenLastCalledWith("runtime_request", {
        name: "settings.save",
        payload: {
          model: {
            provider: "openai",
            model: "gpt-5.2",
            api_mode: "responses",
            credential_id: "default",
          },
          runtime: { default_workspace_mode: "worktree" },
          clear_api_key: false,
        },
      });
    });
  });
});
