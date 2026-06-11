import { Plug, Plus, RefreshCw, Upload, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  dashedPanelClassName,
  dataRowClassName,
  dataRowLabelClassName,
  emptyStateClassName,
  fieldInputClassName,
  fieldLabelClassName,
  fieldTriggerClassName,
  formActionsClassName,
  mutedTextClassName,
  navigationLabelClassName,
  stableScrollbarClassName,
  subtleButtonClassName,
} from "@/components/flowent/styles";
import type { McpImportSource, McpServer } from "@/components/flowent/types";
import { cn } from "@/lib/utils";

export function McpView({
  activeServer,
  isCreatingServer,
  isImportOpen,
  importPreview,
  importSource,
  importingServerId,
  isPreviewing,
  onNewServer,
  onImport,
  onImportServer,
  onImportSourceChange,
  onReconnectServer,
  onRemoveServer,
  onSaveServer,
  onServerSelect,
  onUpdateServer,
  servers,
}: {
  activeServer: McpServer;
  isCreatingServer: boolean;
  isImportOpen: boolean;
  importPreview: McpServer[];
  importSource: McpImportSource;
  importingServerId: string;
  isPreviewing: boolean;
  onNewServer: () => void;
  onImport: () => void;
  onImportServer: (serverId: string) => void;
  onImportSourceChange: (source: McpImportSource) => void;
  onReconnectServer: () => void;
  onRemoveServer: () => void;
  onSaveServer: () => void;
  onServerSelect: (server: McpServer) => void;
  onUpdateServer: (updates: Partial<McpServer>) => void;
  servers: McpServer[];
}) {
  return (
    <section className="grid h-full min-h-0 bg-black" aria-label="MCP">
      <div className="grid h-full min-h-0 grid-cols-[260px_minmax(0,1fr)] max-[900px]:grid-cols-1 max-[900px]:grid-rows-[auto_minmax(0,1fr)]">
        <McpSidebar
          activeServer={activeServer}
          isCreatingServer={isCreatingServer}
          onImport={onImport}
          onNewServer={onNewServer}
          onServerSelect={onServerSelect}
          servers={servers}
        />
        <McpDetails
          activeServer={activeServer}
          isCreatingServer={isCreatingServer}
          isImportOpen={isImportOpen}
          importPreview={importPreview}
          importSource={importSource}
          importingServerId={importingServerId}
          isPreviewing={isPreviewing}
          onImportServer={onImportServer}
          onImportSourceChange={onImportSourceChange}
          onReconnectServer={onReconnectServer}
          onRemoveServer={onRemoveServer}
          onSaveServer={onSaveServer}
          onUpdateServer={onUpdateServer}
          servers={servers}
        />
      </div>
    </section>
  );
}

function McpSidebar({
  activeServer,
  isCreatingServer,
  onImport,
  onNewServer,
  onServerSelect,
  servers,
}: {
  activeServer: McpServer;
  isCreatingServer: boolean;
  onImport: () => void;
  onNewServer: () => void;
  onServerSelect: (server: McpServer) => void;
  servers: McpServer[];
}) {
  return (
    <aside
      className={cn(
        "flex min-h-0 min-w-0 flex-col overflow-auto border-r border-white/10 bg-black p-4 max-[900px]:max-h-64 max-[900px]:border-r-0 max-[900px]:border-b",
        stableScrollbarClassName,
      )}
      aria-label="MCP servers"
    >
      <Button
        aria-pressed={isCreatingServer}
        className="h-8 w-full border-dashed border-white/20 bg-input/30 text-base text-white shadow-none hover:bg-input/50"
        onClick={onNewServer}
        size="sm"
        type="button"
        variant="outline"
      >
        <Plus aria-hidden="true" />
        New
      </Button>
      <Button
        className="mt-2 h-8 w-full border-dashed border-white/20 bg-input/30 text-base text-white shadow-none hover:bg-input/50"
        onClick={onImport}
        size="sm"
        type="button"
        variant="outline"
      >
        <Upload aria-hidden="true" />
        Import
      </Button>
      <div className="mt-4 -mx-2.5 grid gap-0">
        {servers.length === 0 ? (
          <p className={emptyStateClassName}>No servers</p>
        ) : null}
        {servers.map((server) => {
          const isActive = !isCreatingServer && activeServer.id === server.id;

          return (
            <Button
              aria-label={server.name}
              aria-pressed={isActive}
              className={cn(
                "grid h-9 w-full cursor-pointer justify-start rounded-[10px] border border-transparent bg-transparent px-2.5 py-1.5 text-left text-white shadow-none transition-colors duration-100 hover:bg-[#171717]",
                navigationLabelClassName,
                isActive && "bg-[#2f2f2f]",
              )}
              key={server.id}
              onClick={() => onServerSelect(server)}
              size="sm"
              type="button"
              variant="ghost"
            >
              <span className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                  {server.name}
                </span>
                <McpStatusDot status={server.status} />
              </span>
            </Button>
          );
        })}
      </div>
    </aside>
  );
}

function McpDetails({
  activeServer,
  isCreatingServer,
  isImportOpen,
  importPreview,
  importSource,
  importingServerId,
  isPreviewing,
  onImportServer,
  onImportSourceChange,
  onReconnectServer,
  onRemoveServer,
  onSaveServer,
  onUpdateServer,
  servers,
}: {
  activeServer: McpServer;
  isCreatingServer: boolean;
  isImportOpen: boolean;
  importPreview: McpServer[];
  importSource: McpImportSource;
  importingServerId: string;
  isPreviewing: boolean;
  onImportServer: (serverId: string) => void;
  onImportSourceChange: (source: McpImportSource) => void;
  onReconnectServer: () => void;
  onRemoveServer: () => void;
  onSaveServer: () => void;
  onUpdateServer: (updates: Partial<McpServer>) => void;
  servers: McpServer[];
}) {
  if (isImportOpen) {
    return (
      <section
        className={cn(
          "grid min-h-0 w-full content-start gap-7 overflow-auto px-12 py-8 max-[900px]:px-5 max-[900px]:py-5",
          stableScrollbarClassName,
        )}
        aria-label="MCP import"
      >
        <McpImportPanel
          importPreview={importPreview}
          importSource={importSource}
          importingServerId={importingServerId}
          isPreviewing={isPreviewing}
          servers={servers}
          onImportServer={onImportServer}
          onImportSourceChange={onImportSourceChange}
        />
      </section>
    );
  }

  return (
    <form
      className={cn(
        "grid min-h-0 w-full content-start gap-7 overflow-auto px-12 py-8 max-[900px]:px-5 max-[900px]:py-5",
        stableScrollbarClassName,
      )}
      aria-label="MCP server"
      onSubmit={(event) => {
        event.preventDefault();
        onSaveServer();
      }}
    >
      <section className="grid gap-3">
        <h3 className="text-base font-semibold text-white">Details</h3>
        <div className={dashedPanelClassName}>
          <McpFields
            activeServer={activeServer}
            onUpdateServer={onUpdateServer}
          />
        </div>
      </section>

      <section className="grid gap-3">
        <h3 className="text-base font-semibold text-white">Tools</h3>
        <McpTools server={activeServer} />
      </section>

      {activeServer.error ? (
        <p className="m-0 text-xs leading-[1.4] text-destructive">
          {activeServer.error}
        </p>
      ) : null}

      <div className={cn(formActionsClassName, "mt-0")}>
        {!isCreatingServer ? (
          <>
            <Button
              className={subtleButtonClassName}
              onClick={onReconnectServer}
              type="button"
              variant="outline"
            >
              <RefreshCw aria-hidden="true" />
              Reconnect
            </Button>
            <Button
              className={subtleButtonClassName}
              onClick={onRemoveServer}
              type="button"
              variant="outline"
            >
              <Trash2 aria-hidden="true" />
              Remove
            </Button>
          </>
        ) : null}
        <Button type="submit">Save</Button>
      </div>
    </form>
  );
}

function McpImportPanel({
  importPreview,
  importSource,
  importingServerId,
  isPreviewing,
  servers,
  onImportServer,
  onImportSourceChange,
}: {
  importPreview: McpServer[];
  importSource: McpImportSource;
  importingServerId: string;
  isPreviewing: boolean;
  servers: McpServer[];
  onImportServer: (serverId: string) => void;
  onImportSourceChange: (source: McpImportSource) => void;
}) {
  const existingServerIds = new Set(servers.map((server) => server.id));

  return (
    <section className="grid gap-7">
      <section className="grid gap-3">
        <div className="grid grid-cols-[repeat(2,minmax(0,160px))] gap-2 max-[640px]:grid-cols-1">
          <Button
            aria-pressed={importSource === "claude_code"}
            className={cn(
              subtleButtonClassName,
              importSource === "claude_code" && "bg-input/50",
            )}
            disabled={isPreviewing || importingServerId !== ""}
            onClick={() => onImportSourceChange("claude_code")}
            type="button"
            variant="outline"
          >
            Claude Code
          </Button>
          <Button
            aria-pressed={importSource === "codex"}
            className={cn(
              subtleButtonClassName,
              importSource === "codex" && "bg-input/50",
            )}
            disabled={isPreviewing || importingServerId !== ""}
            onClick={() => onImportSourceChange("codex")}
            type="button"
            variant="outline"
          >
            Codex
          </Button>
        </div>
      </section>

      <section className="grid gap-3">
        <h3 className="text-base font-semibold text-white">Servers</h3>
        {importPreview.length > 0 ? (
          <div className={dashedPanelClassName}>
            {importPreview.map((server) => {
              const isImportingServer = importingServerId === server.id;

              return (
                <div
                  aria-label={server.name}
                  className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-3 border-b border-white/10 px-3 py-2 last:border-b-0 max-[640px]:grid-cols-[minmax(0,1fr)_auto]"
                  key={server.id}
                  role="listitem"
                >
                  <div className="grid min-w-0 gap-1">
                    <div className="flex items-center gap-2">
                      <span className="text-base text-white">
                        {server.name}
                      </span>
                      {existingServerIds.has(server.id) ? (
                        <span className="rounded-md border border-white/10 bg-input/30 px-2 py-0.5 text-xs text-white">
                          Existing
                        </span>
                      ) : null}
                    </div>
                    <p
                      className={cn(
                        "m-0 break-all text-xs",
                        mutedTextClassName,
                      )}
                    >
                      {server.type === "url"
                        ? server.url
                        : [server.command, ...server.args]
                            .filter(Boolean)
                            .join(" ")}
                    </p>
                  </div>
                  <span className={cn("text-xs", mutedTextClassName)}>
                    {server.type === "url" ? "URL" : "Command"}
                  </span>
                  <Button
                    className={subtleButtonClassName}
                    disabled={importingServerId !== ""}
                    onClick={() => onImportServer(server.id)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {isImportingServer ? "Importing" : "Import"}
                  </Button>
                </div>
              );
            })}
          </div>
        ) : (
          <p className={emptyStateClassName}>
            {isPreviewing ? "Scanning" : "No servers"}
          </p>
        )}
      </section>
    </section>
  );
}

function McpFields({
  activeServer,
  onUpdateServer,
}: {
  activeServer: McpServer;
  onUpdateServer: (updates: Partial<McpServer>) => void;
}) {
  return (
    <>
      <div className={dataRowClassName}>
        <Label
          className={cn(fieldLabelClassName, dataRowLabelClassName)}
          htmlFor="mcp-name"
        >
          Name
        </Label>
        <Input
          className={fieldInputClassName}
          id="mcp-name"
          onChange={(event) => onUpdateServer({ name: event.target.value })}
          value={activeServer.name}
        />
      </div>
      <div className={dataRowClassName}>
        <Label
          className={cn(fieldLabelClassName, dataRowLabelClassName)}
          htmlFor="mcp-type"
        >
          Type
        </Label>
        <Select
          value={activeServer.type}
          onValueChange={(value) =>
            onUpdateServer({ type: value as McpServer["type"] })
          }
        >
          <SelectTrigger
            className={fieldTriggerClassName}
            id="mcp-type"
            aria-label="Type"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="command">Command</SelectItem>
            <SelectItem value="url">URL</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {activeServer.type === "command" ? (
        <div className={dataRowClassName}>
          <Label
            className={cn(fieldLabelClassName, dataRowLabelClassName)}
            htmlFor="mcp-command-line"
          >
            Command line
          </Label>
          <Input
            className={fieldInputClassName}
            id="mcp-command-line"
            onChange={(event) =>
              onUpdateServer({ commandLine: event.target.value })
            }
            value={activeServer.commandLine}
          />
        </div>
      ) : (
        <div className={dataRowClassName}>
          <Label
            className={cn(fieldLabelClassName, dataRowLabelClassName)}
            htmlFor="mcp-url"
          >
            URL
          </Label>
          <Input
            className={fieldInputClassName}
            id="mcp-url"
            onChange={(event) => onUpdateServer({ url: event.target.value })}
            value={activeServer.url}
          />
        </div>
      )}
      <div className={dataRowClassName}>
        <Label
          className={cn(fieldLabelClassName, dataRowLabelClassName)}
          htmlFor="mcp-enabled"
        >
          Enabled
        </Label>
        <Select
          value={activeServer.enabled ? "true" : "false"}
          onValueChange={(value) =>
            onUpdateServer({ enabled: value === "true" })
          }
        >
          <SelectTrigger
            className={fieldTriggerClassName}
            id="mcp-enabled"
            aria-label="Enabled"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true">On</SelectItem>
            <SelectItem value="false">Off</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className={dataRowClassName}>
        <Label
          className={cn(fieldLabelClassName, dataRowLabelClassName)}
          htmlFor="mcp-status"
        >
          Status
        </Label>
        <div
          className="flex min-w-0 flex-wrap items-center gap-2"
          id="mcp-status"
        >
          <McpStatusBadge status={activeServer.status} />
          {activeServer.status === "ready" ? (
            <span className={cn("text-xs leading-5", mutedTextClassName)}>
              {activeServer.tools.length}{" "}
              {activeServer.tools.length === 1 ? "tool" : "tools"}
            </span>
          ) : null}
        </div>
      </div>
    </>
  );
}

function McpTools({ server }: { server: McpServer }) {
  if (server.tools.length === 0) {
    return <p className={emptyStateClassName}>No tools</p>;
  }

  return (
    <div className={dashedPanelClassName}>
      {server.tools.map((tool) => (
        <div
          className="grid min-h-10 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-white/10 px-3 py-2 text-base leading-5 text-white last:border-b-0 max-[640px]:grid-cols-1"
          key={tool.name}
        >
          <div className="flex min-w-0 items-center gap-2">
            <Plug
              className="size-4 shrink-0 text-[#9b9b9b]"
              aria-hidden="true"
            />
            <span className="truncate">{tool.name}</span>
          </div>
          {tool.description ? (
            <span
              className={cn(
                "min-w-0 truncate text-xs leading-5",
                mutedTextClassName,
              )}
            >
              {tool.description}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function mcpStatusLabel(status: McpServer["status"]): string {
  if (status === "ready") {
    return "Ready";
  }
  if (status === "starting") {
    return "Starting";
  }
  if (status === "error") {
    return "Error";
  }
  return "Disabled";
}

function McpStatusBadge({ status }: { status: McpServer["status"] }) {
  const tone = mcpStatusTone(status);

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-md border bg-black",
        "px-2 py-1 text-xs",
        tone.className,
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          status === "starting" && "animate-pulse",
          tone.dotClassName,
        )}
        aria-hidden="true"
      />
      <span className="leading-none">{mcpStatusLabel(status)}</span>
    </span>
  );
}

function McpStatusDot({ status }: { status: McpServer["status"] }) {
  const tone = mcpStatusTone(status);

  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-2 rounded-full",
        status === "starting" && "animate-pulse",
        tone.dotClassName,
      )}
    />
  );
}

function mcpStatusTone(status: McpServer["status"]) {
  if (status === "ready") {
    return {
      className: "border-emerald-400/20 text-emerald-200",
      dotClassName: "bg-emerald-300",
    };
  }
  if (status === "starting") {
    return {
      className: "border-sky-400/20 text-sky-200",
      dotClassName: "bg-sky-300",
    };
  }
  if (status === "error") {
    return {
      className: "border-red-400/25 text-red-200",
      dotClassName: "bg-red-300",
    };
  }
  return {
    className: "border-white/10 text-white/55",
    dotClassName: "bg-white/35",
  };
}
