import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "@/App";
import {
  claudeCodeMcpImportPreview,
  codexMcpImportPreview,
  codexMultiMcpImportPreview,
  commandMcpServer,
  mixedMcpImportPreview,
  selectedProviderState,
  type TestMcpServer,
} from "@/test/app-fixtures";
import { mockMcpAppRequests } from "@/test/mcp-app-harness";
import { assistantToolStreamResponse } from "@/test/workspace-stream-fixtures";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });

const expectDocumentText = async (text: string) => {
  await waitFor(() => {
    expect(document.body).toHaveTextContent(text);
  });
};

describe("MCP management", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, "", "/");
    window.localStorage.clear();
  });

  it("opens MCP with an empty server list", async () => {
    const user = userEvent.setup();
    mockMcpAppRequests();
    render(<App />);

    await user.click(screen.getByRole("tab", { name: "MCP" }));

    expect(
      screen.getByRole("complementary", { name: "MCP servers" }),
    ).toBeInTheDocument();
    expect(screen.getByText("No servers")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New" })).toBeInTheDocument();
    expect(
      screen.getByRole("form", { name: "MCP server" }),
    ).toBeInTheDocument();
  });

  it("saves a command MCP server from a pasted command", async () => {
    const user = userEvent.setup();
    mockMcpAppRequests();
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "MCP" }));
    await user.type(screen.getByLabelText("Name"), "Files");
    await user.type(
      screen.getByLabelText("Command line"),
      "npx -y @modelcontextprotocol/server-filesystem /project",
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    const saveCall = vi
      .mocked(window.fetch)
      .mock.calls.find(
        ([input, init]) =>
          input === "/api/mcp/servers" && init?.method === "PUT",
      );
    expect(saveCall).toBeDefined();
    expect(JSON.parse(String(saveCall?.[1]?.body))).toMatchObject({
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/project"],
      command: "npx",
      enabled: true,
      name: "Files",
      type: "command",
    });
    await expectDocumentText("read_file");
  });

  it("adds a newly saved MCP server immediately while it connects", async () => {
    const user = userEvent.setup();
    let stateRequestCount = 0;
    vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      if (input === "/api/state") {
        stateRequestCount += 1;
        return jsonResponse({
          ...selectedProviderState(),
          mcp_servers:
            stateRequestCount > 1
              ? [
                  commandMcpServer({
                    status: stateRequestCount > 2 ? "ready" : "starting",
                    tools:
                      stateRequestCount > 2 ? commandMcpServer().tools : [],
                  }),
                ]
              : [],
        });
      }
      if (input === "/api/about") {
        return jsonResponse({ version: "test" });
      }
      if (input === "/api/mcp/servers" && init?.method === "PUT") {
        const request = JSON.parse(String(init.body)) as TestMcpServer;
        return jsonResponse({ ...request, status: "starting", tools: [] });
      }
      return jsonResponse({ detail: "Not found" }, 404);
    });

    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "MCP" }));
    await user.type(screen.getByLabelText("Name"), "Files");
    await user.type(
      screen.getByLabelText("Command line"),
      "npx -y @modelcontextprotocol/server-filesystem /project",
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByRole("button", { name: "Files" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Starting")).toBeInTheDocument();

    await expectDocumentText("read_file");
    expect(screen.getByText("Ready")).toBeInTheDocument();
  });

  it("saves a URL MCP server", async () => {
    const user = userEvent.setup();
    mockMcpAppRequests();
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "MCP" }));
    await user.type(screen.getByLabelText("Name"), "Docs");
    await user.click(screen.getByRole("combobox", { name: "Type" }));
    await user.click(screen.getByRole("option", { name: "URL" }));
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Type" })).toHaveTextContent(
        "URL",
      );
    });
    await user.type(screen.getByLabelText("URL"), "https://example.com/mcp");
    await user.click(screen.getByRole("button", { name: "Save" }));

    const saveCall = vi
      .mocked(window.fetch)
      .mock.calls.find(
        ([input, init]) =>
          input === "/api/mcp/servers" && init?.method === "PUT",
      );
    expect(saveCall).toBeDefined();
    expect(JSON.parse(String(saveCall?.[1]?.body))).toMatchObject({
      args: [],
      command: "",
      name: "Docs",
      type: "url",
      url: "https://example.com/mcp",
    });
  });

  it("shows the selected MCP server type", async () => {
    const user = userEvent.setup();
    mockMcpAppRequests();
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "MCP" }));
    await user.click(screen.getByRole("combobox", { name: "Type" }));
    await user.click(screen.getByRole("option", { name: "URL" }));

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Type" })).toHaveTextContent(
        "URL",
      );
    });
  });

  it("loads persisted MCP servers when the app starts", async () => {
    const user = userEvent.setup();
    mockMcpAppRequests({ initialServers: [commandMcpServer()] });

    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "MCP" }));

    expect(screen.getByRole("button", { name: "Files" })).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByText("read_file")).toBeInTheDocument();
  });

  it("does not show disabled MCP tools as ready", async () => {
    const user = userEvent.setup();
    mockMcpAppRequests({
      initialServers: [
        commandMcpServer({
          enabled: false,
          status: "disabled",
          tools: [],
        }),
      ],
    });

    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "MCP" }));

    expect(screen.getByText("Disabled")).toBeInTheDocument();
    expect(screen.getByText("No tools")).toBeInTheDocument();
  });

  it("reconnects the selected MCP server and refreshes its tools", async () => {
    const user = userEvent.setup();
    mockMcpAppRequests({ initialServers: [commandMcpServer()] });

    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "MCP" }));
    await user.click(screen.getByRole("button", { name: "Reconnect" }));

    expect(window.fetch).toHaveBeenCalledWith(
      "/api/mcp/servers/mcp-files/reconnect",
      expect.objectContaining({ method: "POST" }),
    );
    await expectDocumentText("write_file");
  });

  it("removes the selected MCP server", async () => {
    const user = userEvent.setup();
    mockMcpAppRequests({ initialServers: [commandMcpServer()] });

    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "MCP" }));
    await user.click(screen.getByRole("button", { name: "Remove" }));

    expect(window.fetch).toHaveBeenCalledWith(
      "/api/mcp/servers/mcp-files",
      expect.objectContaining({ method: "DELETE" }),
    );
    await waitFor(() => {
      expect(screen.getByText("No servers")).toBeInTheDocument();
    });
  });

  it("scans Codex MCP servers after choosing Codex", async () => {
    const user = userEvent.setup();
    mockMcpAppRequests({ importPreview: mixedMcpImportPreview() });

    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "MCP" }));
    await user.click(screen.getByRole("button", { name: "Import" }));
    await user.click(screen.getByRole("button", { name: "Codex" }));

    expect(window.fetch).toHaveBeenCalledWith(
      "/api/mcp/import/preview",
      expect.objectContaining({
        body: JSON.stringify({ source: "codex" }),
        method: "POST",
      }),
    );
    expect(await screen.findByText("docs")).toBeInTheDocument();
    expect(screen.getByText(/@modelcontextprotocol/)).toBeInTheDocument();
  });

  it("shows an Import button for each scanned MCP server", async () => {
    const user = userEvent.setup();
    mockMcpAppRequests({
      importPreview: { codex: codexMultiMcpImportPreview() },
    });

    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "MCP" }));
    await user.click(screen.getByRole("button", { name: "Import" }));
    await user.click(screen.getByRole("button", { name: "Codex" }));

    const importRegion = screen.getByRole("region", { name: "MCP import" });
    const docsRow = await within(importRegion).findByRole("listitem", {
      name: "docs",
    });
    const memoryRow = within(importRegion).getByRole("listitem", {
      name: "memory",
    });

    expect(
      within(docsRow).getByRole("button", { name: "Import" }),
    ).toBeInTheDocument();
    expect(
      within(memoryRow).getByRole("button", { name: "Import" }),
    ).toBeInTheDocument();
  });

  it("imports Claude Code MCP servers and opens the imported server", async () => {
    const user = userEvent.setup();
    mockMcpAppRequests({
      importPreview: { claude_code: claudeCodeMcpImportPreview() },
    });

    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "MCP" }));
    await user.click(screen.getByRole("button", { name: "Import" }));
    const importRegion = screen.getByRole("region", { name: "MCP import" });
    const linearRow = await within(importRegion).findByRole("listitem", {
      name: "Linear",
    });
    await user.click(within(linearRow).getByRole("button", { name: "Import" }));

    expect(window.fetch).toHaveBeenCalledWith(
      "/api/mcp/import",
      expect.objectContaining({
        body: JSON.stringify({
          server_id: "mcp-linear",
          source: "claude_code",
        }),
        method: "POST",
      }),
    );
    expect(
      await screen.findByRole("button", { name: "Linear" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("URL")).toHaveValue(
      "https://linear.example.com/mcp",
    );
  });

  it("imports one MCP server from its row", async () => {
    const user = userEvent.setup();
    mockMcpAppRequests({
      importPreview: { codex: codexMultiMcpImportPreview() },
    });

    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "MCP" }));
    await user.click(screen.getByRole("button", { name: "Import" }));
    await user.click(screen.getByRole("button", { name: "Codex" }));
    expect(await screen.findByText("memory")).toBeInTheDocument();

    const importRegion = screen.getByRole("region", { name: "MCP import" });
    const memoryRow = within(importRegion).getByRole("listitem", {
      name: "memory",
    });
    await user.click(within(memoryRow).getByRole("button", { name: "Import" }));

    expect(window.fetch).toHaveBeenCalledWith(
      "/api/mcp/import",
      expect.objectContaining({
        body: JSON.stringify({
          server_id: "mcp-memory",
          source: "codex",
        }),
        method: "POST",
      }),
    );
    expect(
      await screen.findByRole("button", { name: "memory" }),
    ).toBeInTheDocument();
  });

  it("shows loading only on the MCP server row being imported", async () => {
    const user = userEvent.setup();
    let resolveImport: (response: Response) => void = () => {};
    mockMcpAppRequests({
      importPreview: { codex: codexMultiMcpImportPreview() },
    });
    const mockFetch = vi.mocked(window.fetch);
    const baseFetch = mockFetch.getMockImplementation();
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/mcp/import" && init?.method === "POST") {
        return await new Promise<Response>((resolve) => {
          resolveImport = resolve;
        });
      }
      return baseFetch?.(input, init) ?? new Response(null, { status: 404 });
    });

    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "MCP" }));
    await user.click(screen.getByRole("button", { name: "Import" }));
    await user.click(screen.getByRole("button", { name: "Codex" }));

    const importRegion = screen.getByRole("region", { name: "MCP import" });
    const docsRow = await within(importRegion).findByRole("listitem", {
      name: "docs",
    });
    const memoryRow = within(importRegion).getByRole("listitem", {
      name: "memory",
    });
    await user.click(within(docsRow).getByRole("button", { name: "Import" }));

    expect(
      within(docsRow).getByRole("button", { name: "Importing" }),
    ).toBeDisabled();
    expect(
      within(memoryRow).getByRole("button", { name: "Import" }),
    ).toBeDisabled();

    resolveImport(jsonResponse(codexMcpImportPreview().servers));
  });

  it("shows an empty MCP import scan", async () => {
    const user = userEvent.setup();
    mockMcpAppRequests({
      importPreview: { claude_code: { servers: [] } },
    });

    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "MCP" }));
    await user.click(screen.getByRole("button", { name: "Import" }));

    const importRegion = screen.getByRole("region", { name: "MCP import" });
    expect(
      await within(importRegion).findByText("No servers"),
    ).toBeInTheDocument();
    expect(
      within(importRegion).queryByRole("button", { name: "Import" }),
    ).not.toBeInTheDocument();
  });

  it("shows successful MCP tool details after the tool row is opened", async () => {
    const user = userEvent.setup();
    mockMcpAppRequests({
      workspaceResponse: () =>
        assistantToolStreamResponse(
          {
            arguments: { path: "README.md" },
            result: {
              output: "MCP file content",
              raw_result: {
                content: [{ text: "MCP file content", type: "text" }],
                isError: false,
              },
              server: "Files",
              tool: "read_file",
              type: "mcp",
            },
            id: "tool-1",
            name: "mcp__mcp-files__read_file",
            output: "MCP file content",
            title: "Calling Files.read_file",
          },
          "Used MCP.",
        ),
    });
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "Read with MCP");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    const toolDetails = await screen.findByRole("button", {
      name: /Calling Files\.read_file/,
    });
    await user.click(toolDetails);

    const resultBlock = screen.getByText("RESULT").parentElement;
    expect(resultBlock).toHaveTextContent("MCP file content");
    await expectDocumentText("Used MCP.");
  });

  it("shows failed MCP tool details when a server call fails", async () => {
    const user = userEvent.setup();
    mockMcpAppRequests({
      workspaceResponse: () =>
        assistantToolStreamResponse(
          {
            arguments: { path: "secret.txt" },
            result: {
              output: "Permission denied",
              raw_result: {
                content: [{ text: "Permission denied", type: "text" }],
                isError: true,
              },
              server: "Files",
              tool: "read_file",
              type: "mcp",
            },
            id: "tool-1",
            name: "mcp__mcp-files__read_file",
            output: "Permission denied",
            status: "failed",
            title: "Calling Files.read_file",
          },
          "Could not use MCP.",
        ),
    });
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "Read with MCP");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    const toolDetails = await screen.findByRole("button", {
      name: /Calling Files\.read_file/,
    });
    expect(await screen.findByText("Failed")).toBeInTheDocument();
    expect(toolDetails).toHaveAttribute("aria-expanded", "false");
    expect(document.body).not.toHaveTextContent("RESULT");
    expect(document.body).not.toHaveTextContent("Permission denied");

    await user.click(toolDetails);

    const resultBlock = screen.getByText("RESULT").parentElement;
    expect(resultBlock).toHaveTextContent("Permission denied");
    await expectDocumentText("Could not use MCP.");
  });
});
