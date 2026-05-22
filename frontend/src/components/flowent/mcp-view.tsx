import { Plug, Plus, RefreshCw, Trash2 } from "lucide-react";

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
import type { McpServer } from "@/components/flowent/types";
import { cn } from "@/lib/utils";

export function McpView({
  activeServer,
  isCreatingServer,
  onNewServer,
  onReconnectServer,
  onRemoveServer,
  onSaveServer,
  onServerSelect,
  onUpdateServer,
  servers,
}: {
  activeServer: McpServer;
  isCreatingServer: boolean;
  onNewServer: () => void;
  onReconnectServer: () => void;
  onRemoveServer: () => void;
  onSaveServer: () => void;
  onServerSelect: (server: McpServer) => void;
  onUpdateServer: (updates: Partial<McpServer>) => void;
  servers: McpServer[];
}) {
  return (
    <section
      className="grid h-full min-h-0 bg-black max-[900px]:h-auto max-[900px]:min-h-[calc(100vh-126px)]"
      aria-label="MCP"
    >
      <div className="grid h-full min-h-0 grid-cols-[260px_minmax(0,1fr)] max-[900px]:h-auto max-[900px]:grid-cols-1">
        <McpSidebar
          activeServer={activeServer}
          isCreatingServer={isCreatingServer}
          onNewServer={onNewServer}
          onServerSelect={onServerSelect}
          servers={servers}
        />
        <McpDetails
          activeServer={activeServer}
          isCreatingServer={isCreatingServer}
          onReconnectServer={onReconnectServer}
          onRemoveServer={onRemoveServer}
          onSaveServer={onSaveServer}
          onUpdateServer={onUpdateServer}
        />
      </div>
    </section>
  );
}

function McpSidebar({
  activeServer,
  isCreatingServer,
  onNewServer,
  onServerSelect,
  servers,
}: {
  activeServer: McpServer;
  isCreatingServer: boolean;
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
        className="h-8 w-full border-dashed border-white/20 bg-input/30 text-xs text-white shadow-none hover:bg-input/50"
        onClick={onNewServer}
        size="sm"
        type="button"
        variant="outline"
      >
        <Plus aria-hidden="true" />
        New
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
              <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                {server.name}
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
  onReconnectServer,
  onRemoveServer,
  onSaveServer,
  onUpdateServer,
}: {
  activeServer: McpServer;
  isCreatingServer: boolean;
  onReconnectServer: () => void;
  onRemoveServer: () => void;
  onSaveServer: () => void;
  onUpdateServer: (updates: Partial<McpServer>) => void;
}) {
  return (
    <form
      className={cn(
        "grid min-h-0 w-full content-start gap-7 overflow-auto px-12 py-8 max-[900px]:overflow-visible max-[900px]:px-5 max-[900px]:py-5",
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
          className={cn("text-[13px] leading-5 text-white", mutedTextClassName)}
          id="mcp-status"
        >
          {mcpStatusLabel(activeServer.status)}
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
          className="grid min-h-10 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-white/10 px-3 py-2 text-[13px] leading-5 text-white last:border-b-0 max-[640px]:grid-cols-1"
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
