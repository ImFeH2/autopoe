import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";
import type { AccessState } from "@/types";
import { SIDEBAR_RAIL_WIDTH } from "@/lib/sidebarLayout";

const accessStateRef: { value: AccessState } = vi.hoisted(() => ({
  value: {
    authenticated: false,
    configured: true,
    bootstrap_generated: false,
    requires_restart: false,
  } as AccessState,
}));

vi.mock("@/context/AccessContext", () => ({
  AccessProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/context/AgentContext", async () => {
  const actual = await vi.importActual<typeof import("@/context/AgentContext")>(
    "@/context/AgentContext",
  );
  return {
    ...actual,
    AgentProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
    useAgentConnectionRuntime: () => ({ connected: true }),
    useAgentUI: () => ({
      currentPage: "assistant",
      navigateToPage: vi.fn(),
    }),
  };
});

vi.mock("@/pages/AssistantPage", () => ({
  AssistantPage: () => <div>Assistant page</div>,
}));

vi.mock("@/components/SidebarActivityTicker", () => ({
  SidebarActivityTicker: () => null,
}));

vi.mock("@/context/useAccess", () => ({
  useAccess: () => ({
    loading: false,
    state: accessStateRef.value,
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
    requireReauth: vi.fn(),
  }),
}));

describe("App access gate", () => {
  beforeEach(() => {
    accessStateRef.value = {
      authenticated: false,
      configured: true,
      bootstrap_generated: false,
      requires_restart: false,
    };
  });

  afterEach(() => {
    cleanup();
  });

  it("tells the user to read the current access code from the startup log", () => {
    render(<App />);

    expect(
      screen.getByLabelText(/Startup Log Access Code/i),
    ).toBeInTheDocument();
  });

  it("keeps the same startup-log guidance when the code was generated during startup", () => {
    accessStateRef.value = {
      authenticated: false,
      configured: true,
      bootstrap_generated: true,
      requires_restart: false,
    };

    render(<App />);

    expect(
      screen.getByLabelText(/Startup Log Access Code/i),
    ).toBeInTheDocument();
  });

  it("asks for a restart after the access configuration was reset locally", () => {
    accessStateRef.value = {
      authenticated: false,
      configured: false,
      bootstrap_generated: false,
      requires_restart: true,
    };

    render(<App />);

    expect(
      screen.getByText(
        /Access was reset locally\. Restart Flowent to generate a new access code\./i,
      ),
    ).toBeInTheDocument();
  });

  it("keeps the main content beside the icon navigation after desktop compression", async () => {
    accessStateRef.value = {
      authenticated: true,
      configured: true,
      bootstrap_generated: false,
      requires_restart: false,
    };

    render(<App />);

    const main = screen.getByRole("main");
    expect(main).toHaveStyle({ marginLeft: "232px" });

    fireEvent.mouseDown(screen.getByLabelText("Show icon navigation"), {
      clientX: 232,
      clientY: 20,
    });
    fireEvent.click(screen.getByLabelText("Show icon navigation"), {
      clientX: 232,
      clientY: 20,
    });

    expect(main).toHaveStyle({ marginLeft: `${SIDEBAR_RAIL_WIDTH}px` });
    expect(
      await screen.findByRole("button", { name: "Assistant" }),
    ).toHaveClass("size-11");
  });
});
