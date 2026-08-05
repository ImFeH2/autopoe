import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AgentsPage } from "@/components/AgentsPage";
import { ChatMessages } from "@/components/ChatMessages";
import { CommandApproval } from "@/components/CommandApproval";
import { ProjectEmptyState } from "@/components/ProjectEmptyState";
import { SidebarProvider } from "@/components/ui/sidebar";

const agent = {
  id: "leader",
  kind: "leader" as const,
  name: "Leader",
  role: "Leader",
  status: "idle" as const,
  model: "test",
  home: "/data/projects/default/agents/leader/home",
};

describe("ChatMessages", () => {
  it("renders the empty chat", () => {
    const markup = renderToStaticMarkup(
      <ChatMessages
        agent={agent}
        connection="ready"
        error={null}
        messages={[]}
        onInspect={() => undefined}
      />,
    );

    expect(markup).toContain("Leader");
    expect(markup).toContain("Ready");
  });

  it("renders streamed agent content", () => {
    const markup = renderToStaticMarkup(
      <ChatMessages
        agent={agent}
        connection="ready"
        error={null}
        messages={[
          {
            id: "turn-1-agent",
            chat_id: "general",
            turn_id: "turn-1",
            author: "leader",
            content: "Flowent",
            status: "streaming",
          },
        ]}
        onInspect={() => undefined}
      />,
    );

    expect(markup).toContain("Leader");
    expect(markup).toContain("Flowent");
  });

  it("renders an unconfigured agent", () => {
    const markup = renderToStaticMarkup(
      <ChatMessages
        agent={{ ...agent, model: null }}
        connection="ready"
        error={null}
        messages={[]}
        onInspect={() => undefined}
      />,
    );

    expect(markup).toContain("No model");
  });
});

describe("CommandApproval", () => {
  it("renders the command and actions", () => {
    const markup = renderToStaticMarkup(
      <CommandApproval
        approval={{
          id: "desktop-1",
          turn_id: "turn-1",
          agent_id: "leader",
          tool_call_id: "command-1",
          tool: "run_command",
          input: {
            space: "workspace",
            command: "pnpm test",
          },
        }}
        onRespond={() => undefined}
        responding={false}
      />,
    );

    expect(markup).toContain("Run command");
    expect(markup).toContain("pnpm test");
    expect(markup).toContain("Deny");
    expect(markup).toContain(">Run<");
  });
});

describe("AgentsPage", () => {
  it("renders the project agent directory", () => {
    const markup = renderToStaticMarkup(
      <SidebarProvider>
        <AgentsPage
          agents={[
            agent,
            {
              ...agent,
              id: "worker-1",
              kind: "worker",
              name: "Backend Engineer",
              role: "Backend",
            },
          ]}
          onNavigate={() => undefined}
          project={{
            id: "project-1",
            name: "Flowent",
            workspace: "/projects/flowent",
          }}
        />
      </SidebarProvider>,
    );

    expect(markup).toContain("Agents");
    expect(markup).toContain("Backend Engineer");
    expect(markup).toContain("New worker");
  });
});

describe("ProjectEmptyState", () => {
  it("renders the project action", () => {
    const markup = renderToStaticMarkup(
      <ProjectEmptyState
        connection="ready"
        error={null}
        onOpen={() => undefined}
        opening={false}
      />,
    );

    expect(markup).toContain("Open a project");
    expect(markup).toContain(">Open<");
  });

  it("renders a runtime error", () => {
    const markup = renderToStaticMarkup(
      <ProjectEmptyState
        connection="error"
        error="Sidecar unavailable"
        onOpen={() => undefined}
        opening={false}
      />,
    );

    expect(markup).toContain("Runtime unavailable");
    expect(markup).toContain("Sidecar unavailable");
  });
});
