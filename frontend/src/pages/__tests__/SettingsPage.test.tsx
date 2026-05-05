import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { SettingsPage } from "@/pages/SettingsPage";
import type { Provider, Role } from "@/types";
import type { SettingsBootstrapData, UserSettings } from "@/pages/settings/lib";

const {
  fetchSettingsBootstrap,
  saveSettings,
  toastError,
  toastSuccess,
  requireReauth,
} = vi.hoisted(() => ({
  fetchSettingsBootstrap: vi.fn(),
  saveSettings: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  requireReauth: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  fetchSettingsBootstrap,
  saveSettings,
}));

vi.mock("@/context/useAccess", () => ({
  useAccess: () => ({
    requireReauth,
  }),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  SelectValue: ({ placeholder }: { placeholder?: string }) => (
    <span>{placeholder ?? null}</span>
  ),
}));

vi.mock("@/components/ModelParamsFields", () => ({
  ModelParamsFields: () => <div data-testid="model-params-fields" />,
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
  },
}));

function buildProvider(
  overrides: Partial<Provider> & Pick<Provider, "id" | "name">,
): Provider {
  return {
    id: overrides.id,
    name: overrides.name,
    type: overrides.type ?? "openai_compatible",
    base_url: overrides.base_url ?? "https://api.example.com/v1",
    api_key: overrides.api_key ?? "",
    headers: overrides.headers ?? {},
    retry_429_delay_seconds: overrides.retry_429_delay_seconds ?? 0,
    models: overrides.models ?? [],
  };
}

function buildRole(
  overrides: Partial<Role> & Pick<Role, "name" | "description">,
): Role {
  return {
    name: overrides.name,
    description: overrides.description,
    system_prompt: overrides.system_prompt ?? "Default.",
    model: overrides.model ?? null,
    model_params: overrides.model_params ?? null,
    included_tools: overrides.included_tools ?? [],
    excluded_tools: overrides.excluded_tools ?? [],
    is_builtin: overrides.is_builtin ?? true,
  };
}

function buildSettings(overrides: Partial<UserSettings> = {}): UserSettings {
  return {
    app_data_dir: overrides.app_data_dir ?? "/home/test/.flowent",
    working_dir: overrides.working_dir ?? "/workspace/project",
    access: {
      configured: true,
      ...(overrides.access ?? {}),
    },
    assistant: {
      role_name: "Steward",
      allow_network: true,
      write_dirs: ["/workspace/project"],
      ...(overrides.assistant ?? {}),
    },
    leader: {
      role_name: "Conductor",
      ...(overrides.leader ?? {}),
    },
    model: {
      active_provider_id: "provider-1",
      active_model: "gpt-5.2",
      input_image: null,
      output_image: null,
      capabilities: { input_image: true, output_image: false },
      context_window_tokens: null,
      resolved_context_window_tokens: 128000,
      timeout_ms: 10000,
      retry_policy: "limited",
      max_retries: 5,
      retry_initial_delay_seconds: 0.5,
      retry_max_delay_seconds: 8,
      retry_backoff_cap_retries: 5,
      auto_compact_token_limit: null,
      params: {
        reasoning_effort: null,
        verbosity: null,
        max_output_tokens: null,
        temperature: null,
        top_p: null,
      },
      ...(overrides.model ?? {}),
    },
    mcp_servers: overrides.mcp_servers ?? [],
  };
}

function buildBootstrapData(
  overrides: Partial<SettingsBootstrapData> = {},
): SettingsBootstrapData {
  return {
    settings: buildSettings(),
    providers: [
      buildProvider({
        id: "provider-1",
        name: "Primary",
        models: [
          {
            model: "gpt-5.2",
            source: "discovered",
            context_window_tokens: 128000,
            input_image: true,
            output_image: false,
          },
        ],
      }),
    ],
    roles: [
      buildRole({
        name: "Steward",
        description: "Human-facing assistant role",
      }),
      buildRole({
        name: "Conductor",
        description: "Default leader role",
        system_prompt: "Lead.",
      }),
    ],
    version: "1.2.3",
    ...overrides,
  };
}

function renderSettingsPage() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <SettingsPage />
    </SWRConfig>,
  );
}

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireReauth.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("loads bootstrap metadata and shows derived model details", async () => {
    const user = userEvent.setup();
    fetchSettingsBootstrap.mockResolvedValue(buildBootstrapData());

    renderSettingsPage();

    expect(await screen.findByLabelText("Request Timeout")).toHaveValue(
      "10000",
    );

    await user.click(screen.getByRole("tab", { name: "Path" }));
    expect(await screen.findByLabelText("App Data Directory")).toHaveValue(
      "/home/test/.flowent",
    );
    expect(screen.getByLabelText("Working Directory")).toHaveValue(
      "/workspace/project",
    );

    await user.click(screen.getByRole("tab", { name: "Model" }));
    expect(
      await screen.findByText("Context window: 128,000"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Capabilities: input_image=true, output_image=false, structured_output=false",
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Assistant" }));
    expect(
      await screen.findByTestId("assistant-role-guidance"),
    ).toHaveTextContent("Human-facing assistant role");

    await user.click(screen.getByRole("tab", { name: "Leader" }));
    expect(
      (await screen.findAllByText("Default leader role")).length,
    ).toBeGreaterThan(0);
  });

  it("keeps assistant identity guidance visible for a non-Steward selected role", async () => {
    fetchSettingsBootstrap.mockResolvedValue(
      buildBootstrapData({
        settings: buildSettings({
          assistant: {
            role_name: "Designer",
            allow_network: true,
            write_dirs: ["/workspace/project"],
          },
        }),
        roles: [
          buildRole({
            name: "Steward",
            description: "Human-facing assistant role",
          }),
          buildRole({
            name: "Designer",
            description: "Visual-first system behavior",
            system_prompt: "Design.",
            is_builtin: true,
          }),
          buildRole({
            name: "Conductor",
            description: "Default leader role",
            system_prompt: "Lead.",
          }),
        ],
      }),
    );

    const user = userEvent.setup();
    renderSettingsPage();

    const assistantTab = await screen.findByRole("tab", { name: "Assistant" });
    await user.click(assistantTab);

    const guidance = await screen.findByTestId("assistant-role-guidance");

    expect(guidance).toHaveTextContent("Visual-first system behavior");
  });

  it("saves normalized settings payload after focused edits", async () => {
    fetchSettingsBootstrap.mockResolvedValue(buildBootstrapData());
    saveSettings.mockResolvedValue({
      settings: buildSettings({
        assistant: {
          role_name: "Steward",
          allow_network: false,
          write_dirs: ["/workspace/project"],
        },
        model: {
          active_provider_id: "provider-1",
          active_model: "gpt-5.2",
          input_image: null,
          output_image: null,
          capabilities: { input_image: true, output_image: false },
          context_window_tokens: 64000,
          resolved_context_window_tokens: 64000,
          timeout_ms: 15000,
          retry_policy: "limited",
          max_retries: 5,
          retry_initial_delay_seconds: 0.5,
          retry_max_delay_seconds: 8,
          retry_backoff_cap_retries: 5,
          auto_compact_token_limit: null,
          params: {
            reasoning_effort: null,
            verbosity: null,
            max_output_tokens: null,
            temperature: null,
            top_p: null,
          },
        },
      }),
      reauthRequired: false,
    });

    const user = userEvent.setup();
    renderSettingsPage();

    const timeoutInput = await screen.findByLabelText("Request Timeout");
    const contextWindowInput = screen.getByLabelText("Context Window");

    fireEvent.change(timeoutInput, { target: { value: "15000" } });
    fireEvent.change(contextWindowInput, { target: { value: "64000" } });

    await user.click(screen.getByRole("tab", { name: "Assistant" }));
    const networkAccessSwitch = await screen.findByRole("switch", {
      name: "Network Access",
    });

    fireEvent.click(networkAccessSwitch);
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() =>
      expect(saveSettings).toHaveBeenCalledWith({
        working_dir: "/workspace/project",
        assistant: {
          role_name: "Steward",
          allow_network: false,
          write_dirs: ["/workspace/project"],
        },
        leader: { role_name: "Conductor" },
        model: {
          active_provider_id: "provider-1",
          active_model: "gpt-5.2",
          input_image: null,
          output_image: null,
          context_window_tokens: 64000,
          timeout_ms: 15000,
          retry_policy: "limited",
          max_retries: 5,
          retry_initial_delay_seconds: 0.5,
          retry_max_delay_seconds: 8,
          retry_backoff_cap_retries: 5,
          auto_compact_token_limit: null,
          params: {
            reasoning_effort: null,
            verbosity: null,
            max_output_tokens: null,
            temperature: null,
            top_p: null,
          },
        },
      }),
    );

    expect(toastSuccess).toHaveBeenCalledWith("Settings saved");
    expect(toastError).not.toHaveBeenCalled();
  });

  it("blocks saving a compact token limit that reaches the known safe window", async () => {
    fetchSettingsBootstrap.mockResolvedValue(buildBootstrapData());

    renderSettingsPage();

    const autoCompactTokenLimitInput = await screen.findByLabelText(
      "Automatic Compact Token Limit",
    );

    fireEvent.change(autoCompactTokenLimitInput, {
      target: { value: "126976" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(saveSettings).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      "Automatic Compact token limit must stay below the known safe input window",
    );
  });
});
