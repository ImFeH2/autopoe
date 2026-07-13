import { vi } from "vitest";

import {
  commandMcpServer,
  selectedProviderState,
  type TestMcpImportPreview,
  type TestMcpServer,
} from "@/test/app-fixtures";

type McpImportSource = "claude_code" | "codex";

type McpAppHarnessOptions = {
  importPreview?: Partial<Record<McpImportSource, TestMcpImportPreview>>;
  initialServers?: TestMcpServer[];
  workspaceResponse?: () => Response;
};

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

export const mockMcpAppRequests = ({
  importPreview = {},
  initialServers = [],
  workspaceResponse,
}: McpAppHarnessOptions = {}) => {
  let servers = [...initialServers];

  return vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
    const url = requestUrl(input);

    if (url === "/api/state") {
      return jsonResponse({
        ...selectedProviderState(),
        mcp_servers: servers,
      });
    }

    if (url === "/api/about") {
      return jsonResponse({ version: "test" });
    }

    if (url === "/api/mcp/servers" && init?.method === "PUT") {
      const request = JSON.parse(String(init.body)) as TestMcpServer;
      const savedServer: TestMcpServer = {
        ...request,
        status: request.enabled ? "ready" : "disabled",
        tools: request.enabled ? commandMcpServer().tools : [],
      };
      servers = [
        ...servers.filter((server) => server.id !== savedServer.id),
        savedServer,
      ];
      return jsonResponse(savedServer);
    }

    if (url === "/api/mcp/import/preview" && init?.method === "POST") {
      const request = JSON.parse(String(init.body)) as {
        source: McpImportSource;
      };
      return jsonResponse(importPreview[request.source] ?? { servers: [] });
    }

    if (url === "/api/mcp/import" && init?.method === "POST") {
      const request = JSON.parse(String(init.body)) as {
        server_id: string;
        source: McpImportSource;
      };
      servers = (importPreview[request.source]?.servers ?? [])
        .filter((server) => server.id === request.server_id)
        .map((server) => ({
          ...server,
          status: server.enabled ? "ready" : "disabled",
        }));
      return jsonResponse(servers);
    }

    if (
      url.startsWith("/api/mcp/servers/") &&
      url.endsWith("/reconnect") &&
      init?.method === "POST"
    ) {
      const serverId = url
        .replace("/api/mcp/servers/", "")
        .replace("/reconnect", "");
      const currentServer =
        servers.find((server) => server.id === serverId) ?? commandMcpServer();
      const reconnectedServer: TestMcpServer = {
        ...currentServer,
        status: "ready",
        tools: [
          ...commandMcpServer().tools,
          {
            description: "Write a file",
            input_schema: { type: "object" },
            name: "write_file",
          },
        ],
      };
      servers = servers.map((server) =>
        server.id === reconnectedServer.id ? reconnectedServer : server,
      );
      return jsonResponse(reconnectedServer);
    }

    if (url.startsWith("/api/mcp/servers/") && init?.method === "DELETE") {
      const serverId = url.replace("/api/mcp/servers/", "");
      servers = servers.filter((server) => server.id !== serverId);
      return jsonResponse({ ok: true });
    }

    if (url === "/api/workspace/respond" && init?.method === "POST") {
      return (
        workspaceResponse?.() ?? jsonResponse({ detail: "Not found" }, 404)
      );
    }

    if (url === "/api/workspace/messages" && init?.method === "PUT") {
      return new Response(init.body, {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }

    return jsonResponse({ detail: "Not found" }, 404);
  });
};
