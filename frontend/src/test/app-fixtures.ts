export type TestTool = {
  arguments?: Record<string, unknown> | null;
  id: string;
  name: string;
  output?: string;
  result?: Record<string, unknown> | null;
  status?: "failed" | "running" | "success" | "waiting";
  title: string;
};

export type TestTelegramSession = {
  chat_id: string;
  display_name: string;
  recent_message: string;
  status: "approved" | "pending";
  updated_at: number;
  user_id: string;
  username: string;
};

export type TestTelegramBot = {
  bot_token: string;
  enabled: boolean;
  error: string;
  sessions: TestTelegramSession[];
  status: "disabled" | "error" | "running" | "starting";
};

export type TestMcpTool = {
  description?: string;
  input_schema?: Record<string, unknown>;
  name: string;
};

export type TestMcpServer = {
  args: string[];
  command: string;
  config?: Record<string, unknown>;
  enabled: boolean;
  error: string;
  id: string;
  name: string;
  status: "disabled" | "error" | "ready" | "starting";
  tools: TestMcpTool[];
  type: "command" | "url";
  url: string;
};

export type TestMcpImportPreview = {
  servers: TestMcpServer[];
};

export type TestSkill = {
  description: string;
  enabled: boolean;
  error: string;
  id: string;
  name: string;
  path: string;
  scope: "project" | "user";
  slug: string;
};

export type TestWritablePath = {
  created_at: number;
  path: string;
};

export type TestWorkflowNode = {
  data: Record<string, unknown>;
  description: string;
  id: string;
  name: string;
  position: {
    x: number;
    y: number;
  };
  type: "agent" | "code" | "input" | "merge" | "output" | "timer";
};

export type TestWorkflowEdge = {
  id: string;
  label: string;
  source: string;
  source_handle: string;
  target: string;
  target_handle: string;
};

export type TestWorkflow = {
  created_at: number;
  definition: {
    edges: TestWorkflowEdge[];
    nodes: TestWorkflowNode[];
    version: number;
  };
  id: string;
  name: string;
  updated_at: number;
};

export type TestWorkflowRunResult = {
  node_results: Array<{
    error: string;
    id: string;
    output: string;
    status: "failed" | "pending" | "running" | "success";
  }>;
  outputs: Record<string, string>;
  status: "failed" | "success";
  workflow_id: string;
};

export const workflowUuid = "00000000-0000-4000-8000-000000000000";

export type TestProvider = {
  api_key: string;
  base_url: string;
  id: string;
  models: string[];
  name: string;
  type: "anthropic" | "gemini" | "openai" | "openai_responses";
};

export type TestContextUsage = {
  cached_input_tokens: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
  total_tokens: number;
};

export type TestContextUsageInfo = {
  last_token_usage: TestContextUsage;
  model_context_window?: number | null;
  total_token_usage: TestContextUsage;
};

export const contextUsage = (totalTokens: number): TestContextUsage => ({
  cached_input_tokens: 0,
  input_tokens: 0,
  output_tokens: 0,
  reasoning_output_tokens: 0,
  total_tokens: totalTokens,
});

export const contextUsageInfo = (
  totalTokens: number,
  modelContextWindow = 120_000,
): TestContextUsageInfo => ({
  last_token_usage: contextUsage(totalTokens),
  model_context_window: modelContextWindow,
  total_token_usage: contextUsage(totalTokens),
});

export const emptyTelegramBotState = (): TestTelegramBot => ({
  bot_token: "",
  enabled: false,
  error: "",
  sessions: [],
  status: "disabled",
});

export const selectedProviderState = () => ({
  mcp_servers: [],
  messages: [],
  providers: [
    {
      api_key: "sk-local",
      base_url: "",
      id: "provider-openai",
      models: ["gpt-5.1"],
      name: "OpenAI",
      type: "openai",
    },
  ],
  settings: {
    reasoning_effort: "default",
    selected_model: "gpt-5.1",
    selected_provider_id: "provider-openai",
  },
  skills: [],
  telegram_bot: emptyTelegramBotState(),
});

export const savedWorkflow = (
  updates: Partial<TestWorkflow> = {},
): TestWorkflow => ({
  created_at: 1710000020,
  definition: {
    edges: [
      {
        id: "edge-input-output",
        label: "",
        source: "input",
        source_handle: "out",
        target: "output",
        target_handle: "in",
      },
    ],
    nodes: [
      {
        data: { default_value: "launch checklist", input_type: "text" },
        description: "",
        id: "input",
        name: "Input",
        position: { x: 0, y: 0 },
        type: "input",
      },
      {
        data: { output_key: "final_result", transform: "" },
        description: "",
        id: "output",
        name: "Output",
        position: { x: 260, y: 0 },
        type: "output",
      },
    ],
    version: 1,
  },
  id: "workflow-1",
  name: "Launch Workflow",
  updated_at: 1710000030,
  ...updates,
});

export const commandMcpServer = (
  updates: Partial<TestMcpServer> = {},
): TestMcpServer => ({
  args: ["-y", "@modelcontextprotocol/server-filesystem", "/project"],
  command: "npx",
  config: {},
  enabled: true,
  error: "",
  id: "mcp-files",
  name: "Files",
  status: "ready",
  tools: [
    {
      description: "Read a file",
      input_schema: { type: "object" },
      name: "read_file",
    },
  ],
  type: "command",
  url: "",
  ...updates,
});

export const codexMcpImportPreview = (): TestMcpImportPreview => {
  const server = commandMcpServer({
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/project"],
    config: {
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/project"],
      command: "npx",
    },
    id: "mcp-docs",
    name: "docs",
    status: "disabled",
    tools: [],
  });
  return {
    servers: [server],
  };
};

export const codexMultiMcpImportPreview = (): TestMcpImportPreview => ({
  servers: [
    ...codexMcpImportPreview().servers,
    commandMcpServer({
      args: ["-y", "@modelcontextprotocol/server-memory"],
      config: {
        args: ["-y", "@modelcontextprotocol/server-memory"],
        command: "npx",
      },
      id: "mcp-memory",
      name: "memory",
      status: "disabled",
      tools: [],
    }),
  ],
});

export const claudeCodeMcpImportPreview = (): TestMcpImportPreview => {
  const server = commandMcpServer({
    args: [],
    command: "",
    config: {
      headers: { "X-Team": "${TEAM_ID:-local}" },
      type: "http",
      url: "https://linear.example.com/mcp",
    },
    id: "mcp-linear",
    name: "Linear",
    status: "disabled",
    tools: [],
    type: "url",
    url: "https://linear.example.com/mcp",
  });
  return {
    servers: [server],
  };
};

export const mixedMcpImportPreview = (): Partial<
  Record<"claude_code" | "codex", TestMcpImportPreview>
> => ({
  claude_code: claudeCodeMcpImportPreview(),
  codex: codexMcpImportPreview(),
});

export const projectSkill = (updates: Partial<TestSkill> = {}): TestSkill => ({
  description: "Review project changes.",
  enabled: true,
  error: "",
  id: "skill-project-review",
  name: "Project Review",
  path: "/workspace/.flowent/skills/review/SKILL.md",
  scope: "project",
  slug: "project-review",
  ...updates,
});
