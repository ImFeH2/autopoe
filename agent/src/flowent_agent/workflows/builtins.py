from typing import TYPE_CHECKING, Any

from flowent_agent.workflows.models import WorkflowDefinition

if TYPE_CHECKING:
    from flowent_agent.persistence.workflows import WorkflowStore


def agent(
    identifier: str,
    name: str,
    instructions: str,
    tools: list[str],
) -> dict[str, Any]:
    return {
        "id": identifier,
        "name": name,
        "instructions": instructions,
        "model": {
            "provider": "default",
            "model": "default",
            "api_mode": "responses",
            "credential_id": "default",
        },
        "limits": {
            "request_limit": 24,
            "tool_calls_limit": 48,
            "timeout_seconds": 300,
        },
        "retries": 2,
        "tools": tools,
    }


def software_delivery_workflow() -> WorkflowDefinition:
    return WorkflowDefinition.model_validate(
        {
            "id": "software-delivery",
            "name": "Software delivery",
            "description": "",
            "max_parallelism": 3,
            "nodes": [
                {
                    "id": "requirements",
                    "type": "agent",
                    "name": "Requirements",
                    "depends_on": [],
                    "position": {"x": 40, "y": 220},
                    "agent": agent(
                        "analyst",
                        "Analyst",
                        "Turn the request into testable requirements, constraints, and component boundaries.",
                        ["read_file", "list_files", "search_text"],
                    ),
                    "prompt": "Analyze {{ input.request }} in {{ workspace.path }}.",
                    "output_mode": "text",
                    "max_attempts": 2,
                },
                {
                    "id": "frontend",
                    "type": "agent",
                    "name": "Frontend",
                    "depends_on": ["requirements"],
                    "position": {"x": 296, "y": 92},
                    "agent": agent(
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
                    "prompt": "Implement the frontend from {{ outputs.requirements }}.",
                    "output_mode": "text",
                    "max_attempts": 2,
                },
                {
                    "id": "backend",
                    "type": "agent",
                    "name": "Backend",
                    "depends_on": ["requirements"],
                    "position": {"x": 296, "y": 348},
                    "agent": agent(
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
                    "prompt": "Implement the backend from {{ outputs.requirements }}.",
                    "output_mode": "text",
                    "max_attempts": 2,
                },
                {
                    "id": "quality",
                    "type": "loop",
                    "name": "Quality loop",
                    "depends_on": ["frontend", "backend"],
                    "position": {"x": 558, "y": 220},
                    "nodes": quality_nodes(),
                    "until": {
                        "path": "outputs.verify.approved",
                        "operator": "equals",
                        "value": True,
                    },
                    "max_iterations": 3,
                    "on_exhausted": "fail",
                },
                {
                    "id": "approval",
                    "type": "approval",
                    "name": "Ship gate",
                    "depends_on": ["quality"],
                    "position": {"x": 816, "y": 220},
                    "prompt": "Approve the final workspace changes?",
                    "reject_behavior": "fail",
                },
            ],
        }
    )


def quality_nodes() -> list[dict[str, Any]]:
    return [
        {
            "id": "review",
            "type": "agent",
            "name": "Code review",
            "depends_on": [],
            "position": {"x": 40, "y": 100},
            "agent": agent(
                "reviewer",
                "Reviewer",
                "Review correctness, security, and maintainability. Return only the requested JSON.",
                ["read_file", "list_files", "search_text", "git_diff"],
            ),
            "prompt": "Review iteration {{ iteration }} in {{ workspace.path }}. Respond with JSON containing approved, findings, and summary.",
            "output_mode": "json",
            "max_attempts": 2,
        },
        {
            "id": "test",
            "type": "agent",
            "name": "Tests",
            "depends_on": [],
            "position": {"x": 40, "y": 340},
            "agent": agent(
                "tester",
                "Tester",
                "Run focused verification and return only the requested JSON.",
                ["read_file", "search_text", "run_command", "git_status"],
            ),
            "prompt": "Test iteration {{ iteration }} in {{ workspace.path }}. Respond with JSON containing approved, findings, and summary.",
            "output_mode": "json",
            "max_attempts": 2,
        },
        {
            "id": "repair",
            "type": "agent",
            "name": "Repair",
            "depends_on": ["review", "test"],
            "position": {"x": 330, "y": 220},
            "agent": agent(
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
            "prompt": "Resolve these findings: review={{ outputs.review }}, tests={{ outputs.test }}.",
            "output_mode": "text",
            "max_attempts": 2,
        },
        {
            "id": "verify",
            "type": "agent",
            "name": "Verification",
            "depends_on": ["repair"],
            "position": {"x": 620, "y": 220},
            "agent": agent(
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
            "prompt": "Verify iteration {{ iteration }} after {{ outputs.repair }}. Respond with JSON containing approved, findings, and summary.",
            "output_mode": "json",
            "max_attempts": 2,
        },
    ]


async def seed_builtin_workflows(store: "WorkflowStore") -> None:
    definition = software_delivery_workflow()
    if await store.get_draft(definition.id) is None:
        await store.save_draft(definition)
