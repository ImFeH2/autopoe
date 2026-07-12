import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "@/App";

type WorkflowFixture = {
  active_revision: number;
  created_at: number;
  id: string;
  name: string;
  presentation: {
    connections: Record<string, { label: string }>;
    nodes: Record<
      string,
      {
        description: string;
        name: string;
        position: { x: number; y: number };
      }
    >;
  };
  revision: number;
  spec: {
    connections: Array<{
      from: { node_id: string; port: "output" };
      id: string;
      to: { node_id: string; port: "input" };
    }>;
    nodes: Array<{
      config: Record<string, unknown>;
      id: string;
      kind: "input" | "output" | "timer";
    }>;
  };
  updated_at: number;
};

type ScheduleFixture = {
  last_error: string;
  last_result: null | {
    node_results: Array<{
      error: { code: string; message: string } | null;
      id: string;
      inputs: string[];
      output: string;
      status: "failed" | "pending" | "running" | "success";
    }>;
    outputs: Record<string, string>;
    run_id: string;
    status: "failed" | "success";
    trigger: "manual" | "schedule";
    workflow_id: string;
    workflow_revision: number;
  };
  last_run_at: number | null;
  next_run_at: number | null;
  status: "error" | "running" | "scheduled" | "stopped";
  timezone: string;
  workflow_id: string;
};

type ScheduleResponse =
  | ScheduleFixture
  | null
  | Promise<ScheduleFixture | null>;
type WorkflowResultFixture = NonNullable<ScheduleFixture["last_result"]>;

const timerWorkflow = (): WorkflowFixture => ({
  active_revision: 1,
  created_at: 1710000020,
  id: "timer-workflow",
  name: "Timer Workflow",
  presentation: {
    connections: { "edge-timer-output": { label: "" } },
    nodes: {
      output: {
        description: "",
        name: "Output",
        position: { x: 260, y: 0 },
      },
      timer: {
        description: "",
        name: "Timer",
        position: { x: 0, y: 0 },
      },
    },
  },
  revision: 1,
  spec: {
    connections: [
      {
        from: { node_id: "timer", port: "output" },
        id: "edge-timer-output",
        to: { node_id: "output", port: "input" },
      },
    ],
    nodes: [
      {
        config: {
          interval_seconds: 60,
          mode: "interval",
          payload: "Timer fired.",
        },
        id: "timer",
        kind: "timer",
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

const manualWorkflow = (): WorkflowFixture => ({
  active_revision: 1,
  created_at: 1710000020,
  id: "manual-workflow",
  name: "Manual Workflow",
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
        config: { default_value: "Manual input", input_type: "text" },
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

const workflowResult = (
  workflowId: string,
  output: string,
  status: "failed" | "success" = "success",
): WorkflowResultFixture => ({
  node_results: [
    {
      error:
        status === "failed"
          ? { code: "node_execution_failed", message: output }
          : null,
      id: status === "failed" ? "timer" : "output",
      inputs: [],
      output: status === "success" ? output : "",
      status,
    },
  ],
  outputs: status === "success" ? { final_result: output } : {},
  run_id: `${workflowId}-run`,
  status,
  trigger: workflowId === "timer-workflow" ? "schedule" : "manual",
  workflow_id: workflowId,
  workflow_revision: 1,
});

const schedule = (updates: Partial<ScheduleFixture> = {}): ScheduleFixture => ({
  last_error: "",
  last_result: null,
  last_run_at: null,
  next_run_at: null,
  status: "stopped",
  timezone: "Asia/Shanghai",
  workflow_id: "timer-workflow",
  ...updates,
});

const appState = (workflow: WorkflowFixture) => ({
  mcp_servers: [],
  messages: [],
  providers: [],
  settings: {
    agent_prompt: "",
    context_window_limit: null,
    reasoning_effort: "default",
    selected_model: "",
    selected_provider_id: "",
  },
  skills: [],
  telegram_bot: {
    enabled: false,
    error: "",
    has_bot_token: false,
    sessions: [],
    status: "disabled",
  },
  workflows: [workflow],
  writable_paths: [],
});

const jsonResponse = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
    status,
  });

const scheduleTime = (timestamp: number, timezone = "Asia/Shanghai") =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(timestamp * 1000));

const scheduleLabel = (timestamp: number, timezone = "Asia/Shanghai") =>
  `Next run ${scheduleTime(timestamp, timezone)} (${timezone})`;

const mockWorkflowApi = ({
  firstScheduleRejects = false,
  getSchedules = [schedule()] as ScheduleResponse[],
  runResult = workflowResult("manual-workflow", "Manual result."),
  startSchedule = schedule({
    next_run_at: 1_788_888_600,
    status: "scheduled",
  }),
  startScheduleRejects = false,
  stopSchedule = schedule(),
  workflow = timerWorkflow(),
}: {
  firstScheduleRejects?: boolean;
  getSchedules?: ScheduleResponse[];
  runResult?: ReturnType<typeof workflowResult>;
  startSchedule?: ScheduleFixture;
  startScheduleRejects?: boolean;
  stopSchedule?: ScheduleFixture;
  workflow?: WorkflowFixture;
} = {}) => {
  let scheduleRequestIndex = 0;
  return vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
    if (input === "/api/state") {
      return jsonResponse(appState(workflow));
    }
    if (input === "/api/about") {
      return jsonResponse({});
    }
    if (input === "/api/workflows" && init?.method === "PUT") {
      const request = JSON.parse(String(init.body)) as {
        base_revision: number | null;
        workflow: Pick<
          WorkflowFixture,
          "id" | "name" | "presentation" | "spec"
        >;
      };
      return jsonResponse({
        ...request.workflow,
        active_revision: (request.base_revision ?? 0) + 1,
        created_at: 1710000020,
        revision: (request.base_revision ?? 0) + 1,
        updated_at: 1710000030,
      });
    }
    if (input === `/api/workflows/${workflow.id}/schedule`) {
      if (firstScheduleRejects && scheduleRequestIndex === 0) {
        scheduleRequestIndex += 1;
        throw new TypeError("Failed to fetch");
      }
      const responseIndex = Math.min(
        scheduleRequestIndex,
        getSchedules.length - 1,
      );
      scheduleRequestIndex += 1;
      const response = await (getSchedules[responseIndex] ?? null);
      return response ? jsonResponse(response) : jsonResponse({}, 500);
    }
    if (
      input === `/api/workflows/${workflow.id}/schedule/start` &&
      init?.method === "POST"
    ) {
      if (startScheduleRejects) {
        throw new TypeError("Failed to fetch");
      }
      return jsonResponse(startSchedule);
    }
    if (
      input === `/api/workflows/${workflow.id}/schedule/stop` &&
      init?.method === "POST"
    ) {
      return jsonResponse(stopSchedule);
    }
    if (
      input === `/api/workflows/${workflow.id}/run` &&
      init?.method === "POST"
    ) {
      return jsonResponse(runResult);
    }
    return jsonResponse({});
  });
};

const openWorkflow = async (name: string) => {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name }));
  return user;
};

describe("server managed workflow schedules", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
  });

  it("restores a running timer workflow with its next run and latest result", async () => {
    const nextRunAt = 1_788_888_600;
    mockWorkflowApi({
      getSchedules: [
        schedule({
          last_result: workflowResult("timer-workflow", "Timer completed."),
          last_run_at: nextRunAt - 60,
          next_run_at: nextRunAt,
          status: "running",
        }),
      ],
    });
    window.history.replaceState(null, "", "/workflows/timer-workflow");

    render(<App />);

    expect(
      await screen.findByRole("button", { name: "Stop" }, { timeout: 15_000 }),
    ).toBeVisible();
    expect(screen.getByText("Running now")).toBeVisible();
    expect(screen.getByText(/Next run/)).toBeVisible();
    expect(screen.getByText("Timer completed.")).toBeVisible();
  });

  it("starts a timer workflow once on the server without browser-triggered runs", async () => {
    const fetchMock = mockWorkflowApi();
    render(<App />);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Timer Workflow" }),
    );
    await user.click(await screen.findByRole("button", { name: "Run" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/workflows/timer-workflow/schedule/start",
        expect.objectContaining({
          method: "POST",
        }),
      );
    });
    const startCall = fetchMock.mock.calls.find(
      ([input]) => input === "/api/workflows/timer-workflow/schedule/start",
    );
    expect(JSON.parse(String(startCall?.[1]?.body))).toMatchObject({
      inputs: {},
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });

    expect(
      fetchMock.mock.calls.filter(
        ([input]) => input === "/api/workflows/timer-workflow/run",
      ),
    ).toHaveLength(0);
  });

  it("stops a timer workflow through the server", async () => {
    const fetchMock = mockWorkflowApi({
      getSchedules: [
        schedule({ next_run_at: 1_788_888_600, status: "scheduled" }),
      ],
    });
    render(<App />);
    const user = await openWorkflow("Timer Workflow");

    await user.click(await screen.findByRole("button", { name: "Stop" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/workflows/timer-workflow/schedule/stop",
        expect.objectContaining({ method: "POST" }),
      );
    });
    expect(await screen.findByRole("button", { name: "Run" })).toBeVisible();
  });

  it("keeps ordinary workflow runs on the one-time run endpoint", async () => {
    const workflow = manualWorkflow();
    const fetchMock = mockWorkflowApi({ workflow });
    render(<App />);
    const user = await openWorkflow("Manual Workflow");

    await user.click(await screen.findByRole("button", { name: "Run" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/workflows/manual-workflow/run",
        expect.objectContaining({ method: "POST" }),
      );
    });
    expect(await screen.findByText("Manual result.")).toBeVisible();
  });

  it("keeps timer controls unavailable when schedule state cannot be loaded", async () => {
    mockWorkflowApi({ getSchedules: [null] });
    render(<App />);

    await openWorkflow("Timer Workflow");

    expect(
      await screen.findByRole("button", { name: "Unavailable" }),
    ).toBeDisabled();
    expect(screen.getByText("Could not load run status.")).toBeVisible();
  });

  it("recovers timer controls after the first schedule request loses connection", async () => {
    const nextRunAt = 1_788_888_600;
    mockWorkflowApi({
      firstScheduleRejects: true,
      getSchedules: [schedule({ next_run_at: nextRunAt, status: "scheduled" })],
    });
    render(<App />);

    await openWorkflow("Timer Workflow");

    expect(
      await screen.findByRole("button", { name: "Unavailable" }),
    ).toBeDisabled();
    expect(screen.getByText("Could not load run status.")).toBeVisible();

    expect(
      await screen.findByRole("button", { name: "Stop" }, { timeout: 5_000 }),
    ).toBeVisible();
    expect(screen.getByText(scheduleLabel(nextRunAt))).toBeVisible();
    expect(
      screen.queryByText("Could not load run status."),
    ).not.toBeInTheDocument();
  });

  it("keeps a stopped timer ready without showing an unavailable status", async () => {
    mockWorkflowApi({ getSchedules: [schedule()] });
    render(<App />);

    await openWorkflow("Timer Workflow");

    expect(await screen.findByRole("button", { name: "Run" })).toBeVisible();
    expect(screen.queryByText("Unavailable")).not.toBeInTheDocument();
    expect(screen.queryByText(/Next run/)).not.toBeInTheDocument();
  });

  it("keeps the current schedule state when the selected workflow is clicked again", async () => {
    mockWorkflowApi({ getSchedules: [schedule()] });
    render(<App />);
    const user = await openWorkflow("Timer Workflow");
    expect(await screen.findByRole("button", { name: "Run" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Timer Workflow" }));

    expect(screen.getByRole("button", { name: "Run" })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Loading..." }),
    ).not.toBeInTheDocument();
  });

  it("detects a timer started through another channel", async () => {
    const firstNextRun = 1_788_888_600;
    const secondNextRun = firstNextRun + 60;
    mockWorkflowApi({
      getSchedules: [
        schedule(),
        schedule({ next_run_at: firstNextRun, status: "scheduled" }),
        schedule({ next_run_at: secondNextRun, status: "scheduled" }),
      ],
    });
    render(<App />);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Timer Workflow" }),
    );
    expect(await screen.findByRole("button", { name: "Run" })).toBeVisible();

    expect(
      await screen.findByText("Running", {}, { timeout: 4_000 }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Stop" })).toBeVisible();
    expect(screen.getByText(scheduleLabel(firstNextRun))).toBeVisible();
    expect(
      await screen.findByText(
        scheduleLabel(secondNextRun),
        {},
        { timeout: 4_000 },
      ),
    ).toBeVisible();
  });

  it("shows the timezone used for a schedule started from another channel", async () => {
    const nextRunAt = 1_788_888_600;
    const timezone = "Pacific/Honolulu";
    mockWorkflowApi({
      getSchedules: [
        schedule({
          next_run_at: nextRunAt,
          status: "scheduled",
          timezone,
        }),
      ],
    });
    render(<App />);

    await openWorkflow("Timer Workflow");

    expect(
      await screen.findByText(scheduleLabel(nextRunAt, timezone)),
    ).toBeVisible();
  });

  it("places schedule details below workflow controls on narrow screens", async () => {
    const nextRunAt = 1_788_888_600;
    mockWorkflowApi({
      getSchedules: [schedule({ next_run_at: nextRunAt, status: "scheduled" })],
    });
    render(<App />);

    await openWorkflow("Timer Workflow");

    const scheduleStatus = (
      await screen.findByText(scheduleLabel(nextRunAt))
    ).closest('[data-slot="workflow-schedule-status"]');
    expect(scheduleStatus).toHaveClass(
      "top-3",
      "left-3",
      "max-[640px]:top-16",
      "max-[640px]:right-3",
    );
  });

  it("keeps polling after one schedule request fails", async () => {
    const nextRunAt = 1_788_888_600;
    mockWorkflowApi({
      getSchedules: [
        schedule(),
        null,
        schedule({ next_run_at: nextRunAt, status: "scheduled" }),
      ],
    });
    render(<App />);
    await openWorkflow("Timer Workflow");
    expect(await screen.findByRole("button", { name: "Run" })).toBeVisible();

    expect(
      await screen.findByText("Running", {}, { timeout: 7_000 }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Stop" })).toBeVisible();
  });

  it("waits for a slow schedule request before starting the next poll", async () => {
    let resolveSlowPoll: (value: ScheduleFixture | null) => void = () => {};
    const slowPoll = new Promise<ScheduleFixture | null>((resolve) => {
      resolveSlowPoll = resolve;
    });
    const fetchMock = mockWorkflowApi({
      getSchedules: [schedule(), slowPoll, schedule()],
    });
    const view = render(<App />);
    await openWorkflow("Timer Workflow");
    expect(await screen.findByRole("button", { name: "Run" })).toBeVisible();

    await waitFor(
      () => {
        expect(
          fetchMock.mock.calls.filter(([input]) =>
            String(input).endsWith("/schedule"),
          ),
        ).toHaveLength(2);
      },
      { timeout: 3_000 },
    );
    await new Promise((resolve) => window.setTimeout(resolve, 2_200));

    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).endsWith("/schedule"),
      ),
    ).toHaveLength(2);
    resolveSlowPoll(schedule());
    view.unmount();
  });

  it("polls the latest failure and removes the next run", async () => {
    const nextRunAt = 1_788_888_600;
    mockWorkflowApi({
      getSchedules: [
        schedule({ next_run_at: nextRunAt, status: "scheduled" }),
        schedule({
          last_error: "Timer failed.",
          last_result: workflowResult(
            "timer-workflow",
            "Timer failed.",
            "failed",
          ),
          last_run_at: nextRunAt,
          next_run_at: null,
          status: "error",
        }),
      ],
    });
    render(<App />);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Timer Workflow" }),
    );
    expect(await screen.findByText("Running")).toBeVisible();

    expect(
      await screen.findByText("Needs attention", {}, { timeout: 4_000 }),
    ).toBeVisible();
    expect(screen.getByText("Timer failed.")).toBeVisible();
    expect(screen.queryByText(/Next run/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run" })).toBeVisible();
  });

  it("shows a new scheduler failure instead of hiding it behind the previous success", async () => {
    mockWorkflowApi({
      getSchedules: [
        schedule({
          last_error: "Schedule could not continue.",
          last_result: workflowResult("timer-workflow", "Previous result."),
          status: "error",
        }),
      ],
    });
    render(<App />);

    await openWorkflow("Timer Workflow");

    expect(await screen.findByText("Needs attention")).toBeVisible();
    expect(screen.getByText("Schedule could not continue.")).toBeVisible();
  });

  it("restores the run control after a start request loses connection", async () => {
    mockWorkflowApi({ startScheduleRejects: true });
    render(<App />);
    const user = await openWorkflow("Timer Workflow");
    await user.click(await screen.findByRole("button", { name: "Run" }));

    expect(await screen.findByRole("button", { name: "Run" })).toBeEnabled();
  });
});
