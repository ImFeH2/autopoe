import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "@/App";
import { FlowentToastProvider } from "@/components/flowent/toast";
import { useFlowentToast } from "@/components/flowent/toast-context";

const emptyTelegramBot = () => ({
  enabled: false,
  error: "",
  has_bot_token: false,
  sessions: [],
  status: "disabled",
});

const commandMcpServer = (updates = {}) => ({
  args: [],
  command: "npx",
  config: {},
  enabled: true,
  error: "",
  id: "mcp-files",
  name: "Files",
  status: "ready",
  tools: [],
  type: "command",
  url: "",
  ...updates,
});

const projectSkill = (updates = {}) => ({
  description: "Review project changes.",
  enabled: true,
  error: "",
  id: "skill-project-review",
  name: "Project Review",
  path: "/workspace/.flowent/skills/project-review.md",
  scope: "project",
  slug: "project-review",
  ...updates,
});

const savedWorkflow = () => ({
  active_revision: 1,
  created_at: 1710000020,
  id: "workflow-1",
  name: "Launch Workflow",
  presentation: {
    connections: { "edge-input-output": { label: "" } },
    nodes: {
      input: {
        description: "",
        name: "Input",
        position: { x: 0, y: 0 },
      },
      output: {
        description: "",
        name: "Output",
        position: { x: 260, y: 0 },
      },
    },
  },
  revision: 1,
  spec: {
    connections: [
      {
        from: { node_id: "input", port: "output" },
        id: "edge-input-output",
        to: { node_id: "output", port: "input" },
      },
    ],
    nodes: [
      {
        config: { default_value: "launch checklist", input_type: "text" },
        id: "input",
        kind: "input",
      },
      {
        config: { output_key: "final_result", transform: "" },
        id: "output",
        kind: "output",
      },
    ],
  },
  updated_at: 1710000030,
});

const appState = (updates = {}) => ({
  mcp_servers: [],
  messages: [],
  providers: [],
  settings: {
    reasoning_effort: "default",
    selected_model: "",
    selected_provider_id: "",
  },
  skills: [],
  telegram_bot: emptyTelegramBot(),
  workflows: [],
  writable_paths: [],
  ...updates,
});

const mockAppFetch = (
  state: Record<string, unknown>,
  handler: (input: RequestInfo | URL, init?: RequestInit) => Response | null,
) => {
  vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
    if (input === "/api/state") {
      return new Response(JSON.stringify(state), {
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

    const response = handler(input, init);
    if (response) {
      return response;
    }

    return new Response(JSON.stringify({}), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  });
};

function ToastStackHarness() {
  const toast = useFlowentToast();

  return (
    <button
      onClick={() => {
        for (const message of ["One", "Two", "Three", "Four"]) {
          toast.error({ duration: 60_000, message });
        }
      }}
      type="button"
    >
      Show notifications
    </button>
  );
}

function ShortToastHarness() {
  const toast = useFlowentToast();

  return (
    <button
      onClick={() => toast.error({ duration: 80, message: "Short message" })}
      type="button"
    >
      Show short notification
    </button>
  );
}

describe("toast notifications", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("keeps only three visible notifications and lets users dismiss one", async () => {
    const user = userEvent.setup();
    render(
      <FlowentToastProvider>
        <ToastStackHarness />
      </FlowentToastProvider>,
    );

    await user.click(
      screen.getByRole("button", { name: "Show notifications" }),
    );

    await waitFor(() => {
      expect(screen.getAllByRole("alert")).toHaveLength(3);
    });
    expect(screen.queryByText("One")).not.toBeInTheDocument();
    expect(screen.getByText("Two")).toBeInTheDocument();
    expect(screen.getByText("Three")).toBeInTheDocument();
    expect(screen.getByText("Four")).toBeInTheDocument();

    await user.click(
      within(screen.getAllByRole("alert")[0]).getByRole("button", {
        name: "Dismiss notification",
      }),
    );

    await waitFor(() => {
      expect(screen.getAllByRole("alert")).toHaveLength(2);
    });
  });

  it("removes short notifications automatically", async () => {
    vi.useFakeTimers();
    render(
      <FlowentToastProvider>
        <ShortToastHarness />
      </FlowentToastProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Show short notification" }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Short message");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(79);
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Short message");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.queryByText("Short message")).not.toBeInTheDocument();
  });

  it.each([
    [
      "connection_failed",
      "Connection failed.",
      "Check the address and try again.",
    ],
    ["access_denied", "Access denied.", "Check the key and account access."],
    [
      "rate_limited",
      "Too many requests.",
      "Please wait a moment and try again.",
    ],
    [
      "provider_unavailable",
      "Provider unavailable.",
      "The service is currently unreachable.",
    ],
    [
      "request_failed",
      "Request failed.",
      "Check the connection settings and try again.",
    ],
  ])("shows %s provider fetch failures as a notification", async (code, message, description) => {
    const user = userEvent.setup();
    mockAppFetch(appState(), (input, init) => {
      if (input === "/api/providers/models" && init?.method === "POST") {
        return new Response(JSON.stringify({ detail: { code } }), {
          headers: { "Content-Type": "application/json" },
          status: 502,
        });
      }
      return null;
    });
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "Providers" }));
    await user.click(await screen.findByRole("button", { name: "Fetch" }));

    const notification = await screen.findByRole("alert");
    expect(notification).toHaveTextContent(message);
    expect(notification).toHaveTextContent(description);
  });

  it("shows empty provider fetch results as a notification", async () => {
    const user = userEvent.setup();
    mockAppFetch(appState(), (input, init) => {
      if (input === "/api/providers/models" && init?.method === "POST") {
        return new Response(JSON.stringify({ models: [] }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      return null;
    });
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "Providers" }));
    await user.type(
      screen.getByLabelText("Base URL"),
      "https://example.invalid",
    );
    await user.type(screen.getByLabelText("Access key"), "not-a-real-key");
    await user.click(screen.getByRole("button", { name: "Fetch" }));

    const notification = await screen.findByRole("alert");
    expect(notification).toHaveTextContent("No models found.");
    expect(notification).toHaveTextContent(
      "No models available for this provider.",
    );
    expect(screen.getByText("No models")).toBeInTheDocument();
  });

  it("shows failed writable path additions as a notification", async () => {
    const user = userEvent.setup();
    mockAppFetch(appState(), (input, init) => {
      if (
        input === "/api/permissions/writable-paths" &&
        init?.method === "POST"
      ) {
        return new Response(null, { status: 500 });
      }
      return null;
    });
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "Permissions" }));
    await user.type(
      await screen.findByLabelText("Directory path"),
      "/tmp/cache",
    );
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Directory could not be added.",
    );
    expect(screen.getByLabelText("Directory path")).not.toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("shows MCP import scan failures as a notification", async () => {
    const user = userEvent.setup();
    mockAppFetch(appState(), (input, init) => {
      if (input === "/api/mcp/import/preview" && init?.method === "POST") {
        return new Response(null, { status: 500 });
      }
      return null;
    });
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "MCP" }));
    await user.click(await screen.findByRole("button", { name: "Import" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Scan could not be completed.",
    );
  });

  it("shows workflow run failures as a notification", async () => {
    const user = userEvent.setup();
    mockAppFetch(appState({ workflows: [savedWorkflow()] }), (input, init) => {
      if (input === "/api/workflows" && init?.method === "PUT") {
        return new Response(String(init.body), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (
        input === "/api/workflows/workflow-1/run" &&
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
      return null;
    });
    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: "Launch Workflow" }),
    );
    await user.click(await screen.findByRole("button", { name: "Run" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Workflow needs an output node.",
    );
  });

  it("shows channel status errors as a notification while keeping the page status", async () => {
    const user = userEvent.setup();
    mockAppFetch(
      appState({
        telegram_bot: {
          enabled: true,
          error: "",
          has_bot_token: true,
          sessions: [],
          status: "running",
        },
      }),
      (input, init) => {
        if (input === "/api/telegram-bot" && init?.method === "PUT") {
          return new Response(
            JSON.stringify({
              enabled: true,
              error: "Secret is invalid",
              has_bot_token: true,
              sessions: [],
              status: "error",
            }),
            {
              headers: { "Content-Type": "application/json" },
              status: 200,
            },
          );
        }
        return null;
      },
    );
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "Channels" }));
    await user.click(await screen.findByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Secret is invalid",
    );
    expect(screen.getByText("Error")).toBeInTheDocument();
  });

  it("shows skill enablement errors as a notification while keeping the skill error", async () => {
    const user = userEvent.setup();
    const disabledSkill = projectSkill({ enabled: false });
    mockAppFetch(appState({ skills: [disabledSkill] }), (input, init) => {
      if (
        input === "/api/skills/skill-project-review" &&
        init?.method === "PUT"
      ) {
        return new Response(
          JSON.stringify({
            ...disabledSkill,
            enabled: true,
            error: "Skill could not be loaded.",
          }),
          {
            headers: { "Content-Type": "application/json" },
            status: 200,
          },
        );
      }
      return null;
    });
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "Skills" }));
    await user.click(await screen.findByRole("button", { name: "On" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Skill could not be loaded.",
    );
    expect(
      screen.getAllByText("Skill could not be loaded.").length,
    ).toBeGreaterThan(1);
  });

  it("shows MCP connection errors as a notification while keeping the server error", async () => {
    const user = userEvent.setup();
    mockAppFetch(
      appState({ mcp_servers: [commandMcpServer({ status: "disabled" })] }),
      (input, init) => {
        if (input === "/api/mcp/servers" && init?.method === "PUT") {
          return new Response(
            JSON.stringify(
              commandMcpServer({
                error: "Server could not connect.",
                status: "error",
              }),
            ),
            {
              headers: { "Content-Type": "application/json" },
              status: 200,
            },
          );
        }
        return null;
      },
    );
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "MCP" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Server could not connect.",
    );
    expect(
      screen.getAllByText("Server could not connect.").length,
    ).toBeGreaterThan(1);
  });
});
