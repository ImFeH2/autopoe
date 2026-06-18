import { useState } from "react";
import {
  Check,
  ChevronRight,
  Circle,
  Search,
  Terminal,
  TriangleAlert,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ToolItem } from "@/components/flowent/types";
import { cn } from "@/lib/utils";

export function ToolProcessItem({ tool }: { tool: ToolItem }) {
  const [isOpen, setIsOpen] = useState(false);
  const statusLabel =
    tool.status === "waiting"
      ? "Waiting"
      : tool.status === "running"
        ? "Running"
        : tool.status === "success"
          ? "Done"
          : "Failed";

  return (
    <div className="max-w-full text-base leading-5 text-white">
      <Button
        aria-expanded={isOpen}
        className="h-8 w-full justify-start gap-2 rounded-lg border-0 bg-transparent px-2 text-base text-white shadow-none hover:bg-transparent hover:text-white aria-expanded:bg-transparent aria-expanded:text-white active:not-aria-[haspopup]:translate-y-0"
        onClick={() => setIsOpen((current) => !current)}
        type="button"
        variant="ghost"
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "size-3.5 shrink-0 text-white/55 transition-transform",
            isOpen ? "rotate-90" : "",
          )}
        />
        <ToolProcessIcon tool={tool} />
        <span className="min-w-0 flex-1 truncate text-left">{tool.title}</span>
        <span className="shrink-0 text-xs text-white/55">{statusLabel}</span>
      </Button>
      {isOpen ? <ToolProcessDetails tool={tool} /> : null}
    </div>
  );
}

function ToolProcessDetails({ tool }: { tool: ToolItem }) {
  const approval = toolApprovalData(tool.result);
  const hasArguments = hasToolObjectPayload(tool.arguments);
  const resultDetails = toolResultDetails(tool);
  const hasResult =
    resultDetails.payloads.length > 0 || resultDetails.exitCode !== undefined;

  if (!hasArguments && !hasResult) {
    return null;
  }

  return (
    <div className="flex min-w-0 flex-col gap-2 py-1">
      {hasArguments ? (
        <ToolProcessPayload
          label="ARGS"
          value={formatToolValue(tool.arguments)}
        />
      ) : null}
      {resultDetails.payloads.map((payload) => (
        <ToolProcessPayload
          key={payload.label}
          label={payload.label}
          value={payload.value}
        />
      ))}
      {resultDetails.exitCode !== undefined ? (
        <ToolProcessExitStatus exitCode={resultDetails.exitCode} />
      ) : null}
      {approval ? <ToolProcessApproval approval={approval} /> : null}
    </div>
  );
}

type ToolProcessPayloadData = {
  label: string;
  value: string;
};

type ToolResultDetails = {
  exitCode?: string;
  payloads: ToolProcessPayloadData[];
};

type ToolApprovalData = {
  action?: string;
  decision?: string;
  reason?: string;
  toolResult?: string;
  toolName?: string;
  writePaths?: string[];
};

function ToolProcessApproval({ approval }: { approval: ToolApprovalData }) {
  const decision = approval.decision === "denied" ? "Denied" : "Approved";
  const firstFailureOutput = approval.toolResult?.trim()
    ? approval.toolResult
    : null;

  return (
    <div className="min-w-0">
      <div className="mb-1 text-[11px] font-medium leading-4 text-white/45">
        REVIEW
      </div>
      <div className="grid gap-1 rounded-md border border-white/10 bg-black px-2.5 py-2 text-xs leading-5 text-white/70">
        <div className="font-medium text-white">{decision}</div>
        {approval.reason ? (
          <div className="break-words text-white/60">{approval.reason}</div>
        ) : null}
        {firstFailureOutput ? (
          <div className="mt-1.5 border-t border-white/5 pt-1.5">
            <div className="mb-0.5 text-[10px] font-medium leading-4 text-white/40">
              FAILURE
            </div>
            <div className="whitespace-pre-wrap break-words font-mono text-[11px] leading-4 text-white/50">
              {firstFailureOutput}
            </div>
          </div>
        ) : null}
        {approval.writePaths?.length ? (
          <div className="grid gap-0.5 font-mono text-[11px] leading-4 text-white/50">
            {approval.writePaths.map((path) => (
              <span className="break-words" key={path}>
                {path}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ToolProcessPayload({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[11px] font-medium leading-4 text-white/45">
        {label}
      </div>
      <pre className="max-h-64 overflow-auto rounded-md bg-input/20 px-2.5 py-2 font-mono text-xs leading-5 text-white/70">
        <code className="whitespace-pre-wrap break-words">{value}</code>
      </pre>
    </div>
  );
}

function ToolProcessExitStatus({ exitCode }: { exitCode: string }) {
  const isSuccess = exitCode === "0";
  return (
    <div className="flex items-center gap-1.5 text-[11px] font-medium leading-4 text-white/45">
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 rounded-full",
          isSuccess ? "bg-[#7ddf89]" : "bg-[#ff7474]",
        )}
      />
      <span>Exit {exitCode}</span>
    </div>
  );
}

function formatToolValue(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value, null, 2);
}

function toolResultDetails(tool: ToolItem): ToolResultDetails {
  const result = tool.result;
  if (!hasToolObjectPayload(result)) {
    return { payloads: [] };
  }
  const visibleResult = Object.fromEntries(
    Object.entries(result).filter(([key]) => key !== "approval"),
  );
  if (typeof visibleResult.text === "string") {
    return { payloads: [{ label: "RESULT", value: visibleResult.text }] };
  }
  if (visibleResult.type === "command") {
    return commandToolResultDetails(visibleResult);
  }
  if (typeof visibleResult.output === "string") {
    return { payloads: [{ label: "RESULT", value: visibleResult.output }] };
  }
  return {
    payloads: [{ label: "RESULT", value: formatToolValue(visibleResult) }],
  };
}

function commandToolResultDetails(
  result: Record<string, unknown>,
): ToolResultDetails {
  const outputChunks = commandOutputChunks(result.output_chunks);
  if (outputChunks.length > 0) {
    return commandOutputDetails({
      exitCode: result.exit_code,
      stderr: commandOutputText(outputChunks, "stderr"),
      stdout: commandOutputText(outputChunks, "stdout"),
    });
  }
  const stdout = typeof result.stdout === "string" ? result.stdout.trim() : "";
  const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
  const output = typeof result.output === "string" ? result.output.trim() : "";
  if (stdout || stderr || result.exit_code !== undefined) {
    return commandOutputDetails({
      exitCode: result.exit_code,
      stderr,
      stdout,
    });
  }
  if (output) {
    return { payloads: [{ label: "RESULT", value: output }] };
  }
  return { payloads: [{ label: "RESULT", value: formatToolValue(result) }] };
}

function commandOutputDetails({
  exitCode,
  stderr,
  stdout,
}: {
  exitCode: unknown;
  stderr: string;
  stdout: string;
}): ToolResultDetails {
  return {
    exitCode: exitCode !== undefined ? String(exitCode) : undefined,
    payloads: [
      ...(stdout.trim() ? [{ label: "STDOUT", value: stdout }] : []),
      ...(stderr.trim() ? [{ label: "STDERR", value: stderr }] : []),
    ],
  };
}

type CommandOutputChunk = {
  content: string;
  stream: "stderr" | "stdout";
};

function commandOutputChunks(value: unknown): CommandOutputChunk[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (
      !item ||
      typeof item !== "object" ||
      !("content" in item) ||
      !("stream" in item) ||
      typeof item.content !== "string" ||
      (item.stream !== "stdout" && item.stream !== "stderr")
    ) {
      return [];
    }
    return [{ content: item.content, stream: item.stream }];
  });
}

function commandOutputText(
  chunks: CommandOutputChunk[],
  stream: "stderr" | "stdout",
) {
  return chunks
    .filter((chunk) => chunk.stream === stream)
    .map((chunk) => chunk.content)
    .join("")
    .trimEnd();
}

function hasToolObjectPayload(
  value: Record<string, unknown> | null | undefined,
): value is Record<string, unknown> {
  return value != null && Object.keys(value).length > 0;
}

function toolApprovalData(
  data: Record<string, unknown> | null | undefined,
): ToolApprovalData | null {
  const approval = data?.approval;
  if (!approval || typeof approval !== "object" || Array.isArray(approval)) {
    return null;
  }
  const value = approval as Record<string, unknown>;
  return {
    action: typeof value.action === "string" ? value.action : undefined,
    decision: typeof value.decision === "string" ? value.decision : undefined,
    reason: typeof value.reason === "string" ? value.reason : undefined,
    toolResult:
      typeof value.tool_result === "string" ? value.tool_result : undefined,
    toolName: typeof value.tool_name === "string" ? value.tool_name : undefined,
    writePaths: Array.isArray(value.write_paths)
      ? value.write_paths.filter(
          (path): path is string => typeof path === "string",
        )
      : undefined,
  };
}

function ToolProcessIcon({ tool }: { tool: ToolItem }) {
  const className = cn(
    "size-3.5 shrink-0",
    tool.status === "failed" ? "text-red-300" : "text-white/80",
    tool.status === "running" ? "animate-pulse" : "",
    tool.status === "waiting" ? "text-amber-300" : "",
  );

  if (tool.status === "success") {
    return <Check aria-hidden="true" className={className} />;
  }
  if (tool.status === "failed") {
    return <X aria-hidden="true" className={className} />;
  }
  if (tool.status === "waiting") {
    return <TriangleAlert aria-hidden="true" className={className} />;
  }
  if (tool.name === "web_search" || tool.name === "grep_files") {
    return <Search aria-hidden="true" className={className} />;
  }
  if (tool.name === "shell_command") {
    return <Terminal aria-hidden="true" className={className} />;
  }
  return <Circle aria-hidden="true" className={className} />;
}
