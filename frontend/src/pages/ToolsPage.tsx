import { useMemo, useState } from "react";
import useSWR from "swr";
import { AnimatePresence, motion } from "motion/react";
import {
  Clock,
  FileCode,
  FilePen,
  FileText,
  FolderPlus,
  GitBranch,
  Globe,
  LayoutDashboard,
  Link,
  ListTodo,
  Network,
  Plug,
  Search,
  Send,
  Settings,
  Shield,
  Terminal,
  UserCog,
  Users,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { fetchTools, type ToolInfo } from "@/lib/api";
import { PageScaffold, PageTitleBar } from "@/components/layout/PageScaffold";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CodeBlock,
  IconTile,
  PanelCard,
  PageState,
  StatusChip,
} from "@/components/ui/surface";
import { useOptionalAgentUI } from "@/context/AgentContext";
import { cn } from "@/lib/utils";

const TOOL_ICONS: Record<string, LucideIcon> = {
  send: Send,
  idle: Clock,
  sleep: Clock,
  todo: ListTodo,
  contacts: Network,
  list_tools: Wrench,
  list_roles: Users,
  list_workflows: LayoutDashboard,
  exec: Terminal,
  read: FileText,
  edit: FilePen,
  fetch: Globe,
  create_workflow: FolderPlus,
  create_agent: GitBranch,
  connect: Link,
  set_permissions: Shield,
  manage_providers: Plug,
  manage_roles: UserCog,
  manage_settings: Settings,
  manage_prompts: FileCode,
};

function shortToolDescription(description: string): string {
  const trimmed = description.trim();
  if (trimmed.length <= 96) {
    return trimmed;
  }
  return `${trimmed.slice(0, 93).trimEnd()}...`;
}

function ToolCard({
  expanded,
  onToggle,
  tool,
}: {
  expanded: boolean;
  onToggle: () => void;
  tool: ToolInfo;
}) {
  const Icon = TOOL_ICONS[tool.name] ?? Wrench;

  return (
    <PanelCard
      as="div"
      padding="md"
      onClick={onToggle}
      className={cn(
        "group cursor-pointer transition-colors duration-300 hover:border-ring/25 hover:bg-accent/20 hover:shadow-sm",
        expanded && "border-border bg-accent/20 shadow-sm",
      )}
    >
      <IconTile
        icon={Icon}
        size="sm"
        className="mb-4 transition-colors group-hover:bg-accent/40"
      />

      <code className="block text-[13px] font-mono font-medium text-foreground">
        {tool.name}
      </code>
      <p className="mt-2 text-[10px] text-muted-foreground/75">
        {tool.source === "mcp"
          ? `MCP · ${tool.server_name ?? "unknown"}`
          : "Builtin"}
      </p>
      <p className="mt-2 line-clamp-1 text-[12px] leading-relaxed text-muted-foreground">
        {shortToolDescription(tool.description)}
      </p>

      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mt-4 border-t border-border pt-4">
              {tool.source === "mcp" ? (
                <div className="mb-4 space-y-2 text-[11px] text-muted-foreground">
                  <div>
                    Raw Tool Name{" "}
                    <code className="font-mono text-foreground/82">
                      {tool.tool_name ?? "unknown"}
                    </code>
                  </div>
                  <div>
                    Fully Qualified ID{" "}
                    <code className="font-mono text-foreground/82">
                      {tool.fully_qualified_id ?? tool.name}
                    </code>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {tool.read_only_hint ? (
                      <StatusChip tone="primary">readOnly</StatusChip>
                    ) : null}
                    {tool.destructive_hint ? (
                      <StatusChip tone="danger">destructive</StatusChip>
                    ) : null}
                    {tool.open_world_hint ? (
                      <StatusChip tone="idle">openWorld</StatusChip>
                    ) : null}
                  </div>
                </div>
              ) : null}
              <p className="mb-2 text-[10px] font-medium text-muted-foreground/75">
                Parameters
              </p>
              <CodeBlock className="max-h-48 p-3.5 text-foreground/70">
                {JSON.stringify(tool.parameters ?? {}, null, 2)}
              </CodeBlock>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </PanelCard>
  );
}

export function ToolsPage() {
  const { data: tools = [], isLoading: loading } = useSWR("tools", fetchTools);
  const agentUI = useOptionalAgentUI();

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const filteredTools = useMemo(() => {
    if (!normalizedQuery) {
      return tools;
    }
    return tools.filter((tool) =>
      [tool.name, tool.description, tool.server_name ?? "", tool.source ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [normalizedQuery, tools]);

  const toggle = (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  return (
    <PageScaffold>
      <div className="flex h-full flex-col px-8 pt-6">
        <PageTitleBar title="Tools" />
        <div className="mb-6 mt-6 flex items-center justify-between gap-4">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search tools"
              className="h-9 rounded-full bg-background/45 pl-9 pr-9 text-[13px]"
            />
            {query ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full text-muted-foreground hover:bg-accent/35 hover:text-foreground"
                onClick={() => setQuery("")}
              >
                <X className="size-3.5" />
              </Button>
            ) : null}
          </div>
          <StatusChip tone="neutral" className="h-5 text-[11px]">
            {filteredTools.length} tools
          </StatusChip>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-2 scrollbar-none">
          {loading ? (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
              {[...Array(6)].map((_, i) => (
                <PanelCard
                  as="div"
                  key={i}
                  className="h-36 animate-pulse bg-accent/20"
                />
              ))}
            </div>
          ) : tools.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex h-full flex-col items-center justify-center text-center"
            >
              <PageState
                icon={Wrench}
                title="No tools available"
                action={
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => agentUI?.setCurrentPage("mcp")}
                  >
                    Open MCP
                  </Button>
                }
                className="border-transparent bg-transparent"
              />
            </motion.div>
          ) : filteredTools.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex h-full flex-col items-center justify-center text-center"
            >
              <PageState
                icon={Search}
                title="No tools found"
                action={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setQuery("")}
                  >
                    <X className="size-4" />
                    Clear Search
                  </Button>
                }
                className="border-transparent bg-transparent"
              />
            </motion.div>
          ) : (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 pb-8">
              {filteredTools.map((tool, i) => (
                <motion.div
                  key={tool.name}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                >
                  <ToolCard
                    tool={tool}
                    expanded={expanded.has(tool.name)}
                    onToggle={() => toggle(tool.name)}
                  />
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </div>
    </PageScaffold>
  );
}
