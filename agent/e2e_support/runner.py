from __future__ import annotations

from flowent.domain import Activation
from flowent.runtime import AgentRunContext, AgentRunFailure


class DeterministicRunner:
    def __init__(self) -> None:
        self._failed_messages: set[tuple[int, int, int]] = set()

    def run(self, activation: Activation, context: AgentRunContext) -> None:
        agent = context.state.member(activation.agent_id)
        for item in activation.items:
            discussion = context.discussion(
                "read",
                discussion_id=item.discussion_id,
                message_ids=list(item.message_ids),
            )
            requested = [
                message
                for message in discussion["messages"]
                if message["id"] in item.message_ids
            ]
            bodies = " | ".join(message["body"] for message in requested)
            retry_key = (
                activation.agent_id,
                item.discussion_id,
                requested[0]["id"],
            )
            mention_ids: list[int] = []
            if (
                bodies.startswith("E2E_RETRY_TASK:")
                and retry_key not in self._failed_messages
            ):
                self._failed_messages.add(retry_key)
                raise AgentRunFailure("Model request failed")
            if bodies.startswith("E2E_RETRY_TASK:"):
                body = f"{agent['name']} completed the retried work."
            elif bodies.startswith("E2E_AGENT_HANDOFF:"):
                members = context.organization("list_members")
                discussion_member_ids = set(discussion["member_ids"])
                target = next(
                    (
                        member
                        for member in members
                        if member["type"] == "agent"
                        and member["id"] != activation.agent_id
                        and member["id"] in discussion_member_ids
                    ),
                    None,
                )
                if target is None:
                    raise AgentRunFailure("Agent handoff requires another Agent")
                body = (
                    f"E2E_AGENT_FOLLOWUP: {agent['name']} asked "
                    f"{target['name']} to continue."
                )
                mention_ids = [target["id"]]
            elif bodies.startswith("E2E_AGENT_FOLLOWUP:"):
                body = f"{agent['name']} completed the Agent handoff."
            elif bodies.startswith("E2E_REPOSITORY_TASK:"):
                directory = "artifacts/desktop/e2e-agent-work"
                inspected = context.exec(["git", "status", "--short"], ".", 10)
                context.patch(
                    """diff --git a/artifacts/desktop/e2e-agent-work/input.txt b/artifacts/desktop/e2e-agent-work/input.txt
--- a/artifacts/desktop/e2e-agent-work/input.txt
+++ b/artifacts/desktop/e2e-agent-work/input.txt
@@ -1 +1 @@
-before
+after
"""
                )
                verified = context.exec(
                    ["git", "diff", "--", "input.txt"], directory, 10
                )
                body = (
                    f"{agent['name']} used exec and patch. "
                    f"status={inspected['exit_code']} verify={verified['exit_code']}"
                )
            else:
                body = f"{agent['name']} received: {bodies}"
            context.discussion(
                "send",
                discussion_id=item.discussion_id,
                body=body,
                mention_ids=mention_ids,
            )
            context.discussion(
                "ack",
                discussion_id=item.discussion_id,
                message_ids=list(item.message_ids),
            )
