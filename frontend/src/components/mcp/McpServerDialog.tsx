import type { MCPServerConfig } from "@/types";
import { FormSwitch } from "@/components/form/FormControls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  WorkspaceCommandDialog,
  WorkspaceDialogField,
} from "@/components/WorkspaceCommandDialog";

const mcpOutlineButtonClass =
  "border-border/70 bg-background/45 hover:border-ring/35 hover:bg-accent/65";

function parseStringList(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function formatStringList(values: string[]) {
  return values.join("\n");
}

function parseKeyValueMap(value: string) {
  const output: Record<string, string> = {};
  for (const line of value.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex < 0) {
      continue;
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    const mappedValue = trimmed.slice(separatorIndex + 1).trim();
    if (key) {
      output[key] = mappedValue;
    }
  }
  return output;
}

function formatKeyValueMap(values: Record<string, string>) {
  return Object.entries(values)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}

function MountToggle({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (nextValue: boolean) => void;
}) {
  return (
    <label
      className={`flex items-center justify-between gap-4 rounded-xl border border-border bg-card/20 px-4 py-3 text-sm${
        disabled ? " opacity-50" : ""
      }`}
    >
      <span className="text-foreground/85">{label}</span>
      <FormSwitch
        checked={checked}
        disabled={disabled}
        label={label}
        onCheckedChange={onChange}
      />
    </label>
  );
}

interface McpServerDialogProps {
  draft: MCPServerConfig;
  onChange: (draft: MCPServerConfig) => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: () => void;
  open: boolean;
  pending: boolean;
  title: string;
}

export function McpServerDialog({
  draft,
  onChange,
  onOpenChange,
  onSubmit,
  open,
  pending,
  title,
}: McpServerDialogProps) {
  return (
    <WorkspaceCommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      footer={
        <div className="flex w-full items-center justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            className={mcpOutlineButtonClass}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" disabled={pending} onClick={onSubmit}>
            {pending ? "Saving..." : "Save Server"}
          </Button>
        </div>
      }
      className="max-w-3xl"
    >
      <div className="grid gap-4 md:grid-cols-2">
        <WorkspaceDialogField label="Name">
          <Input
            value={draft.name}
            onChange={(event) =>
              onChange({ ...draft, name: event.target.value })
            }
            placeholder="filesystem"
          />
        </WorkspaceDialogField>
        <WorkspaceDialogField label="Transport">
          <Select
            value={draft.transport}
            onValueChange={(value) =>
              onChange({
                ...draft,
                transport: value as MCPServerConfig["transport"],
              })
            }
          >
            <SelectTrigger className="h-8 w-full rounded-md bg-background/50 text-sm text-foreground">
              <SelectValue placeholder="Select transport" />
            </SelectTrigger>
            <SelectContent className="rounded-xl bg-popover text-popover-foreground">
              <SelectItem value="stdio">stdio</SelectItem>
              <SelectItem value="streamable_http">streamable_http</SelectItem>
            </SelectContent>
          </Select>
        </WorkspaceDialogField>
      </div>

      <WorkspaceDialogField label="Launcher Command" hint="optional">
        <Input
          value={draft.launcher}
          onChange={(event) =>
            onChange({ ...draft, launcher: event.target.value })
          }
          placeholder={
            draft.transport === "streamable_http"
              ? "https://mcp.example.com"
              : "npx @playwright/mcp@latest"
          }
        />
      </WorkspaceDialogField>

      <div className="grid gap-4 md:grid-cols-2">
        <MountToggle
          checked={draft.enabled}
          label="Enabled"
          onChange={(enabled) => onChange({ ...draft, enabled })}
        />
        <MountToggle
          checked={draft.required}
          label="Required"
          onChange={(required) => onChange({ ...draft, required })}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <WorkspaceDialogField label="Startup Timeout" hint="seconds">
          <Input
            type="number"
            value={String(draft.startup_timeout_sec)}
            onChange={(event) =>
              onChange({
                ...draft,
                startup_timeout_sec: Number(event.target.value) || 10,
              })
            }
          />
        </WorkspaceDialogField>
        <WorkspaceDialogField label="Tool Timeout" hint="seconds">
          <Input
            type="number"
            value={String(draft.tool_timeout_sec)}
            onChange={(event) =>
              onChange({
                ...draft,
                tool_timeout_sec: Number(event.target.value) || 30,
              })
            }
          />
        </WorkspaceDialogField>
      </div>

      {draft.transport === "stdio" ? (
        <>
          <WorkspaceDialogField label="Command">
            <Input
              value={draft.command}
              onChange={(event) =>
                onChange({ ...draft, command: event.target.value })
              }
              placeholder="npx"
            />
          </WorkspaceDialogField>
          <div className="grid gap-4 md:grid-cols-2">
            <WorkspaceDialogField label="Args" hint="one per line">
              <Textarea
                rows={5}
                value={formatStringList(draft.args)}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    args: parseStringList(event.target.value),
                  })
                }
              />
            </WorkspaceDialogField>
            <WorkspaceDialogField
              label="Env Vars"
              hint="one env var name per line"
            >
              <Textarea
                rows={5}
                value={formatStringList(draft.env_vars)}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    env_vars: parseStringList(event.target.value),
                  })
                }
              />
            </WorkspaceDialogField>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <WorkspaceDialogField label="Env" hint="KEY: value">
              <Textarea
                rows={5}
                value={formatKeyValueMap(draft.env)}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    env: parseKeyValueMap(event.target.value),
                  })
                }
              />
            </WorkspaceDialogField>
            <WorkspaceDialogField label="Cwd">
              <Input
                value={draft.cwd}
                onChange={(event) =>
                  onChange({ ...draft, cwd: event.target.value })
                }
                placeholder="/workspace/tools"
              />
            </WorkspaceDialogField>
          </div>
        </>
      ) : (
        <>
          <WorkspaceDialogField label="URL">
            <Input
              value={draft.url}
              onChange={(event) =>
                onChange({ ...draft, url: event.target.value })
              }
              placeholder="https://mcp.example.com"
            />
          </WorkspaceDialogField>
          <div className="grid gap-4 md:grid-cols-2">
            <WorkspaceDialogField label="Bearer Token Env Var">
              <Input
                value={draft.bearer_token_env_var}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    bearer_token_env_var: event.target.value,
                  })
                }
                placeholder="MCP_TOKEN"
              />
            </WorkspaceDialogField>
            <WorkspaceDialogField label="OAuth Resource">
              <Input
                value={draft.oauth_resource}
                onChange={(event) =>
                  onChange({ ...draft, oauth_resource: event.target.value })
                }
                placeholder="https://mcp.example.com"
              />
            </WorkspaceDialogField>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <WorkspaceDialogField label="HTTP Headers" hint="Header: value">
              <Textarea
                rows={5}
                value={formatKeyValueMap(draft.http_headers)}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    http_headers: parseKeyValueMap(event.target.value),
                  })
                }
              />
            </WorkspaceDialogField>
            <WorkspaceDialogField
              label="Env HTTP Headers"
              hint="one env var name per line"
            >
              <Textarea
                rows={5}
                value={formatStringList(draft.env_http_headers)}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    env_http_headers: parseStringList(event.target.value),
                  })
                }
              />
            </WorkspaceDialogField>
          </div>
          <WorkspaceDialogField label="Scopes" hint="one scope per line">
            <Textarea
              rows={4}
              value={formatStringList(draft.scopes)}
              onChange={(event) =>
                onChange({
                  ...draft,
                  scopes: parseStringList(event.target.value),
                })
              }
            />
          </WorkspaceDialogField>
        </>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <WorkspaceDialogField
          label="Enabled Tools"
          hint="one raw tool name per line"
        >
          <Textarea
            rows={4}
            value={formatStringList(draft.enabled_tools)}
            onChange={(event) =>
              onChange({
                ...draft,
                enabled_tools: parseStringList(event.target.value),
              })
            }
          />
        </WorkspaceDialogField>
        <WorkspaceDialogField
          label="Disabled Tools"
          hint="one raw tool name per line"
        >
          <Textarea
            rows={4}
            value={formatStringList(draft.disabled_tools)}
            onChange={(event) =>
              onChange({
                ...draft,
                disabled_tools: parseStringList(event.target.value),
              })
            }
          />
        </WorkspaceDialogField>
      </div>
    </WorkspaceCommandDialog>
  );
}
