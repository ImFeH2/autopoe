import { vi } from "vitest";

import { emptyTelegramBotState, type TestWorkflow } from "@/test/app-fixtures";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });

const requestUrl = (input: RequestInfo | URL) => {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
};

export const mockNarrowSidebarViewport = () => {
  const originalMatchMedia = window.matchMedia;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      addEventListener: vi.fn(),
      addListener: vi.fn(),
      dispatchEvent: vi.fn(),
      matches: query.includes("max-width: 900px"),
      media: query,
      onchange: null,
      removeEventListener: vi.fn(),
      removeListener: vi.fn(),
    })),
    writable: true,
  });

  return () => {
    if (originalMatchMedia) {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: originalMatchMedia,
        writable: true,
      });
      return;
    }
    delete (window as Partial<Window>).matchMedia;
  };
};

export const mockAppShellRequests = (
  initialState: Record<string, unknown> = {},
) => {
  const state: Record<string, unknown> = {
    mcp_servers: [],
    messages: [],
    providers: [],
    settings: {
      selected_model: "",
      selected_provider_id: "",
    },
    skills: [],
    telegram_bot: emptyTelegramBotState(),
    workflows: [],
    ...initialState,
  };

  const fetchSpy = vi
    .spyOn(window, "fetch")
    .mockImplementation(async (input, init) => {
      const url = requestUrl(input);

      if (url === "/api/state") {
        return jsonResponse(state);
      }

      if (url === "/api/about") {
        return jsonResponse({ version: "test" });
      }

      if (url === "/api/workflows" && init?.method === "PUT") {
        const request = JSON.parse(String(init.body)) as {
          base_revision: number | null;
          workflow: Pick<TestWorkflow, "id" | "name" | "presentation" | "spec">;
        };
        const workflow: TestWorkflow = {
          ...request.workflow,
          active_revision: (request.base_revision ?? 0) + 1,
          created_at: 1710000020,
          revision: (request.base_revision ?? 0) + 1,
          updated_at: 1710000030,
        };
        state.workflows = [
          workflow,
          ...((state.workflows as TestWorkflow[] | undefined) ?? []).filter(
            (item) => item.id !== workflow.id,
          ),
        ];
        return jsonResponse(workflow);
      }

      if (
        url.startsWith("/api/workflows/") &&
        url.endsWith("/schedule") &&
        init?.method !== "POST"
      ) {
        const workflowId = url
          .replace("/api/workflows/", "")
          .replace("/schedule", "");
        return jsonResponse({
          last_error: "",
          last_result: null,
          last_run_at: null,
          next_run_at: null,
          status: "stopped",
          timezone: "UTC",
          workflow_id: workflowId,
        });
      }

      if (url.startsWith("/api/workflows/") && init?.method === "DELETE") {
        const workflowId = url.replace("/api/workflows/", "");
        state.workflows = (state.workflows as TestWorkflow[]).filter(
          (workflow) => workflow.id !== workflowId,
        );
        return jsonResponse({ ok: true });
      }

      return jsonResponse({ detail: "Not found" }, 404);
    });

  return { fetchSpy, getState: () => state };
};
