import { useCallback, useEffect, useMemo, useState } from "react";

import {
  createEmptyMcpServer,
  mcpServerId,
  parseCommandLine,
} from "@/features/mcp/api/mcp-mappers";
import {
  importMcpServerRequest,
  previewMcpImportRequest,
  reconnectMcpServerRequest,
  removeMcpServerRequest,
  saveMcpServerRequest,
} from "@/features/mcp/api/mcp-requests";
import type {
  McpImportSource,
  McpServer,
} from "@/features/mcp/model/mcp-types";
import i18n from "@/i18n/i18n";

export const useMcpServers = ({
  refreshMcpServers,
  showError,
}: {
  refreshMcpServers: () => Promise<McpServer[] | null>;
  showError: (message: string) => void;
}) => {
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [mcpEditorId, setMcpEditorId] = useState("new");
  const [mcpDraft, setMcpDraft] = useState<McpServer>(() =>
    createEmptyMcpServer(),
  );
  const [isMcpImportOpen, setIsMcpImportOpen] = useState(false);
  const [mcpImportPreview, setMcpImportPreview] = useState<McpServer[]>([]);
  const [mcpImportSource, setMcpImportSource] =
    useState<McpImportSource>("claude_code");
  const [isPreviewingMcpImport, setIsPreviewingMcpImport] = useState(false);
  const [importingMcpServerId, setImportingMcpServerId] = useState("");

  const isCreatingMcpServer = mcpEditorId === "new";
  const hasStartingMcpServer = useMemo(
    () => mcpServers.some((server) => server.status === "starting"),
    [mcpServers],
  );

  const replaceMcpServers = useCallback((nextServers: McpServer[]) => {
    setMcpServers(nextServers);
    if (nextServers[0]) {
      setMcpEditorId(nextServers[0].id);
      setMcpDraft(nextServers[0]);
    }
  }, []);

  const loadMcpEditor = useCallback((server: McpServer) => {
    setIsMcpImportOpen(false);
    setMcpEditorId(server.id);
    setMcpDraft(server);
  }, []);

  const openNewMcpEditor = useCallback(() => {
    setIsMcpImportOpen(false);
    setMcpEditorId("new");
    setMcpDraft(createEmptyMcpServer());
  }, []);

  const updateMcpDraft = useCallback((updates: Partial<McpServer>) => {
    setMcpDraft((current) => ({ ...current, ...updates }));
  }, []);

  const previewMcpImport = useCallback(
    async (source = mcpImportSource) => {
      setIsPreviewingMcpImport(true);
      try {
        const servers = await previewMcpImportRequest(source);
        setMcpImportPreview(servers);
      } catch {
        setMcpImportPreview([]);
        showError(i18n.t("setup.mcp.errors.scan"));
      } finally {
        setIsPreviewingMcpImport(false);
      }
    },
    [mcpImportSource, showError],
  );

  const openMcpImport = useCallback(() => {
    setIsMcpImportOpen(true);
    setMcpImportPreview([]);
    setMcpImportSource("claude_code");
    void previewMcpImport("claude_code");
  }, [previewMcpImport]);

  const importMcpServer = useCallback(
    async (serverId: string) => {
      if (!mcpImportPreview.some((server) => server.id === serverId)) {
        showError(i18n.t("setup.mcp.errors.noServers"));
        return;
      }

      setImportingMcpServerId(serverId);
      try {
        const importedServers = await importMcpServerRequest({
          serverId,
          source: mcpImportSource,
        });
        setMcpServers(importedServers);
        const nextServer =
          importedServers.find((server) => server.id === serverId) ??
          importedServers[0];
        if (nextServer) {
          setIsMcpImportOpen(false);
          setMcpEditorId(nextServer.id);
          setMcpDraft(nextServer);
        }
      } catch {
        showError(i18n.t("setup.mcp.errors.import"));
      } finally {
        setImportingMcpServerId("");
      }
    },
    [mcpImportPreview, mcpImportSource, showError],
  );

  const updateMcpImportSource = useCallback(
    (source: McpImportSource) => {
      setMcpImportSource(source);
      setMcpImportPreview([]);
      void previewMcpImport(source);
    },
    [previewMcpImport],
  );

  const saveMcpServer = useCallback(async () => {
    const parsedCommand =
      mcpDraft.type === "command"
        ? parseCommandLine(mcpDraft.commandLine)
        : { args: [], command: "" };
    const nextServer: McpServer = {
      ...mcpDraft,
      args: parsedCommand.args,
      command: parsedCommand.command,
      id:
        isCreatingMcpServer || mcpDraft.id === "new"
          ? mcpServerId(mcpDraft.name)
          : mcpDraft.id,
      name: mcpDraft.name.trim() || i18n.t("setup.mcp.defaultName"),
      tools: isCreatingMcpServer ? [] : mcpDraft.tools,
      url: mcpDraft.type === "url" ? mcpDraft.url : "",
    };
    const savedServer = await saveMcpServerRequest(nextServer);

    if (savedServer) {
      setMcpServers((currentServers) => {
        if (isCreatingMcpServer) {
          return [...currentServers, savedServer];
        }
        return currentServers.map((server) =>
          server.id === savedServer.id ? savedServer : server,
        );
      });
      setMcpEditorId(savedServer.id);
      setMcpDraft(savedServer);
    }
  }, [isCreatingMcpServer, mcpDraft]);

  const reconnectMcpServer = useCallback(async () => {
    if (isCreatingMcpServer) {
      return;
    }
    const updatedServer = await reconnectMcpServerRequest(mcpDraft.id);

    if (updatedServer) {
      setMcpServers((currentServers) =>
        currentServers.map((server) =>
          server.id === updatedServer.id ? updatedServer : server,
        ),
      );
      setMcpDraft(updatedServer);
    }
  }, [isCreatingMcpServer, mcpDraft.id]);

  const removeMcpServer = useCallback(async () => {
    if (isCreatingMcpServer) {
      return;
    }
    const wasRemoved = await removeMcpServerRequest(mcpDraft.id);

    if (wasRemoved) {
      const remainingServers = mcpServers.filter(
        (server) => server.id !== mcpDraft.id,
      );
      setMcpServers(remainingServers);
      const nextServer = remainingServers[0];
      if (nextServer) {
        setMcpEditorId(nextServer.id);
        setMcpDraft(nextServer);
      } else {
        openNewMcpEditor();
      }
    }
  }, [isCreatingMcpServer, mcpDraft.id, mcpServers, openNewMcpEditor]);

  useEffect(() => {
    if (!hasStartingMcpServer) {
      return;
    }

    let isMounted = true;
    const refreshStartingMcpServers = async () => {
      try {
        const loadedMcpServers = await refreshMcpServers();
        if (!loadedMcpServers || !isMounted) {
          return;
        }
        setMcpServers(loadedMcpServers);
        setMcpDraft((currentDraft) => {
          const refreshedServer = loadedMcpServers.find(
            (server) => server.id === currentDraft.id,
          );
          if (!refreshedServer) {
            return currentDraft;
          }
          return {
            ...currentDraft,
            error: refreshedServer.error,
            status: refreshedServer.status,
            tools: refreshedServer.tools,
          };
        });
      } catch {
        return;
      }
    };

    void refreshStartingMcpServers();
    const intervalId = window.setInterval(() => {
      void refreshStartingMcpServers();
    }, 1000);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, [hasStartingMcpServer, refreshMcpServers]);

  return {
    importMcpServer,
    importingMcpServerId,
    isCreatingMcpServer,
    isMcpImportOpen,
    isPreviewingMcpImport,
    loadMcpEditor,
    mcpDraft,
    mcpImportPreview,
    mcpImportSource,
    mcpServers,
    openMcpImport,
    openNewMcpEditor,
    reconnectMcpServer,
    removeMcpServer,
    replaceMcpServers,
    saveMcpServer,
    updateMcpDraft,
    updateMcpImportSource,
  };
};
