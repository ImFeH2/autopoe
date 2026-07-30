import type {
  AgentConfiguration,
  WorkflowDefinition,
  WorkflowNode,
} from "@/types/workflow";
import { inheritedModelConfiguration } from "@/lib/models";

export function createAgent(
  id: string,
  name: string,
  instructions: string,
  tools: string[] = [],
): AgentConfiguration {
  return {
    id,
    name,
    instructions,
    model: { ...inheritedModelConfiguration },
    limits: {
      request_limit: 24,
      tool_calls_limit: 48,
      timeout_seconds: 300,
    },
    retries: 2,
    tools,
  };
}

const qualityNodes: WorkflowNode[] = [
  {
    id: "review",
    type: "agent",
    name: "Code review",
    depends_on: [],
    position: { x: 40, y: 100 },
    agent: createAgent(
      "reviewer",
      "Reviewer",
      "Review correctness, security, and maintainability. Return only the requested JSON.",
      ["read_file", "list_files", "search_text", "git_diff"],
    ),
    prompt:
      "Review iteration {{ iteration }} in {{ workspace.path }}. Respond with JSON containing approved, findings, and summary.",
    output_mode: "json",
    max_attempts: 2,
  },
  {
    id: "test",
    type: "agent",
    name: "Tests",
    depends_on: [],
    position: { x: 40, y: 340 },
    agent: createAgent(
      "tester",
      "Tester",
      "Run focused verification and return only the requested JSON.",
      ["read_file", "search_text", "run_command", "git_status"],
    ),
    prompt:
      "Test iteration {{ iteration }} in {{ workspace.path }}. Respond with JSON containing approved, findings, and summary.",
    output_mode: "json",
    max_attempts: 2,
  },
  {
    id: "repair",
    type: "agent",
    name: "Repair",
    depends_on: ["review", "test"],
    position: { x: 330, y: 220 },
    agent: createAgent(
      "repairer",
      "Repairer",
      "Resolve review and test findings with minimal, verified changes.",
      [
        "read_file",
        "list_files",
        "search_text",
        "write_file",
        "replace_text",
        "run_command",
        "git_diff",
      ],
    ),
    prompt:
      "Resolve these findings: review={{ outputs.review }}, tests={{ outputs.test }}.",
    output_mode: "text",
    max_attempts: 2,
  },
  {
    id: "verify",
    type: "agent",
    name: "Verification",
    depends_on: ["repair"],
    position: { x: 620, y: 220 },
    agent: createAgent(
      "verifier",
      "Verifier",
      "Verify the repaired workspace independently. Return only the requested JSON.",
      [
        "read_file",
        "search_text",
        "run_command",
        "git_status",
        "git_diff",
      ],
    ),
    prompt:
      "Verify iteration {{ iteration }} after {{ outputs.repair }}. Respond with JSON containing approved, findings, and summary.",
    output_mode: "json",
    max_attempts: 2,
  },
];

export const defaultWorkflow: WorkflowDefinition = {
  id: "software-delivery",
  name: "Software delivery",
  description: "",
  max_parallelism: 3,
  nodes: [
    {
      id: "requirements",
      type: "agent",
      name: "Requirements",
      depends_on: [],
      position: { x: 40, y: 220 },
      agent: createAgent(
        "analyst",
        "Analyst",
        "Turn the request into testable requirements, constraints, and component boundaries.",
        ["read_file", "list_files", "search_text"],
      ),
      prompt: "Analyze {{ input.request }} in {{ workspace.path }}.",
      output_mode: "text",
      max_attempts: 2,
    },
    {
      id: "frontend",
      type: "agent",
      name: "Frontend",
      depends_on: ["requirements"],
      position: { x: 296, y: 92 },
      agent: createAgent(
        "frontend-engineer",
        "Frontend engineer",
        "Implement the frontend portion and preserve the existing design system.",
        [
          "read_file",
          "list_files",
          "search_text",
          "write_file",
          "replace_text",
          "run_command",
          "git_diff",
        ],
      ),
      prompt: "Implement the frontend from {{ outputs.requirements }}.",
      output_mode: "text",
      max_attempts: 2,
    },
    {
      id: "backend",
      type: "agent",
      name: "Backend",
      depends_on: ["requirements"],
      position: { x: 296, y: 348 },
      agent: createAgent(
        "backend-engineer",
        "Backend engineer",
        "Implement the backend portion with bounded, testable changes.",
        [
          "read_file",
          "list_files",
          "search_text",
          "write_file",
          "replace_text",
          "run_command",
          "git_diff",
        ],
      ),
      prompt: "Implement the backend from {{ outputs.requirements }}.",
      output_mode: "text",
      max_attempts: 2,
    },
    {
      id: "quality",
      type: "loop",
      name: "Quality loop",
      depends_on: ["frontend", "backend"],
      position: { x: 558, y: 220 },
      nodes: qualityNodes,
      until: {
        path: "outputs.verify.approved",
        operator: "equals",
        value: true,
      },
      max_iterations: 3,
      on_exhausted: "fail",
    },
    {
      id: "approval",
      type: "approval",
      name: "Ship gate",
      depends_on: ["quality"],
      position: { x: 816, y: 220 },
      prompt: "Approve the final workspace changes?",
      reject_behavior: "fail",
    },
  ],
};

export function cloneDefaultWorkflow() {
  return structuredClone(defaultWorkflow);
}
