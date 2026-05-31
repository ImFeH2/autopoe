import json

import pytest

from flowent.approval import (
    ApprovalReviewRequest,
    ApprovalTranscriptEntry,
    review_approval_request,
)
from flowent.llm import ProviderConnection, ProviderFormat


def provider_connection() -> ProviderConnection:
    return ProviderConnection(
        model="model",
        name="Provider",
        provider=ProviderFormat.OPENAI,
        secret_reference="secret",
    )


@pytest.mark.anyio
async def test_review_payload_includes_current_user_request_and_transcript(
    tmp_path,
) -> None:
    captured_messages: list[dict[str, object]] = []

    async def fake_completion(**request: object) -> object:
        captured_messages.extend(request["messages"])
        return {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(
                            {
                                "risk_level": "low",
                                "risk_score": 25,
                                "rationale": "User approved after concrete risk context.",
                                "evidence": [
                                    {
                                        "message": "Assistant explained Docker socket impact.",
                                        "why": "Establishes informed consent.",
                                    }
                                ],
                            }
                        ),
                        "role": "assistant",
                    }
                },
            ],
        }

    decision = await review_approval_request(
        provider_connection(),
        ApprovalReviewRequest(
            action="additional_permissions",
            arguments={"command": "docker compose up -d --build"},
            cwd=tmp_path,
            tool_name="shell_command",
            user_request="确认",
            transcript=[
                ApprovalTranscriptEntry(
                    role="assistant",
                    content=(
                        "This will recreate the dev container, write to the Docker "
                        "socket, and briefly interrupt the local service."
                    ),
                ),
                ApprovalTranscriptEntry(role="user", content="确认"),
            ],
            write_paths=[tmp_path / "docker.sock"],
        ),
        completion=fake_completion,
    )

    assert decision.decision == "approved"
    assert decision.risk_level == "low"
    assert decision.risk_score == 25
    assert "informed of the concrete risk" in str(captured_messages[0]["content"])
    payload = json.loads(str(captured_messages[-1]["content"]))
    assert payload["user_request"] == "确认"
    assert payload["transcript"][-1] == {"role": "user", "content": "确认"}


@pytest.mark.anyio
async def test_concrete_docker_socket_confirmation_can_be_approved(tmp_path) -> None:
    async def fake_completion(**request: object) -> object:
        return {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(
                            {
                                "risk_level": "medium",
                                "risk_score": 55,
                                "rationale": (
                                    "The user approved after being told the command "
                                    "will recreate the dev container through Docker."
                                ),
                                "evidence": [],
                            }
                        ),
                        "role": "assistant",
                    }
                }
            ]
        }

    decision = await review_approval_request(
        provider_connection(),
        ApprovalReviewRequest(
            action="additional_permissions",
            arguments={
                "command": "docker compose up -d --force-recreate flowent",
            },
            cwd=tmp_path,
            tool_name="shell_command",
            user_request="确认",
            transcript=[
                ApprovalTranscriptEntry(
                    role="assistant",
                    content=(
                        "This will recreate the Flowent dev container through "
                        "Docker and may briefly interrupt the running service."
                    ),
                ),
                ApprovalTranscriptEntry(role="user", content="确认"),
            ],
            write_paths=[tmp_path / "docker.sock"],
        ),
        completion=fake_completion,
    )

    assert decision.decision == "approved"
    assert decision.risk_level == "medium"
    assert decision.risk_score == 55


@pytest.mark.anyio
async def test_vague_confirmation_without_concrete_risk_context_is_denied(
    tmp_path,
) -> None:
    captured_payload: dict[str, object] = {}

    async def fake_completion(**request: object) -> object:
        captured_payload.update(json.loads(str(request["messages"][-1]["content"])))
        return {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(
                            {
                                "risk_level": "high",
                                "risk_score": 82,
                                "rationale": (
                                    "The transcript only contains a vague confirmation "
                                    "and no concrete Docker risk explanation."
                                ),
                                "evidence": [],
                            }
                        ),
                        "role": "assistant",
                    }
                }
            ]
        }

    decision = await review_approval_request(
        provider_connection(),
        ApprovalReviewRequest(
            action="additional_permissions",
            arguments={
                "command": "docker compose up -d --force-recreate flowent",
            },
            cwd=tmp_path,
            tool_name="shell_command",
            user_request="确认",
            transcript=[ApprovalTranscriptEntry(role="user", content="确认")],
            write_paths=[tmp_path / "docker.sock"],
        ),
        completion=fake_completion,
    )

    assert decision.decision == "denied"
    assert decision.risk_level == "high"
    assert decision.risk_score == 82
    assert captured_payload["transcript"] == [{"role": "user", "content": "确认"}]


@pytest.mark.anyio
async def test_broad_destructive_action_with_vague_confirmation_is_denied(
    tmp_path,
) -> None:
    async def fake_completion(**request: object) -> object:
        return {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(
                            {
                                "risk_level": "high",
                                "risk_score": 96,
                                "rationale": (
                                    "The action can delete broad data and the user "
                                    "did not approve that concrete destructive risk."
                                ),
                                "evidence": [
                                    {
                                        "message": "rm -rf /var/lib/postgresql",
                                        "why": "Broad destructive write outside the task.",
                                    }
                                ],
                            }
                        ),
                        "role": "assistant",
                    }
                }
            ]
        }

    decision = await review_approval_request(
        provider_connection(),
        ApprovalReviewRequest(
            action="sandbox_failure",
            arguments={"command": "rm -rf /var/lib/postgresql"},
            cwd=tmp_path,
            tool_name="shell_command",
            tool_result="Read-only file system",
            user_request="确认",
            transcript=[ApprovalTranscriptEntry(role="user", content="确认")],
        ),
        completion=fake_completion,
    )

    assert decision.decision == "denied"
    assert decision.risk_level == "high"
    assert decision.risk_score == 96


@pytest.mark.anyio
async def test_invalid_reviewer_json_is_denied(tmp_path) -> None:
    async def fake_completion(**request: object) -> object:
        return {
            "choices": [
                {"message": {"content": "approved", "role": "assistant"}},
            ],
        }

    decision = await review_approval_request(
        provider_connection(),
        ApprovalReviewRequest(
            action="sandbox_failure",
            arguments={"command": "touch file.txt"},
            cwd=tmp_path,
            tool_name="shell_command",
            tool_result="Read-only file system",
        ),
        completion=fake_completion,
    )

    assert decision.decision == "denied"
    assert "valid JSON" in decision.reason


@pytest.mark.anyio
async def test_reviewer_call_failure_is_denied(tmp_path) -> None:
    async def fake_completion(**request: object) -> object:
        raise RuntimeError("model unavailable")

    decision = await review_approval_request(
        provider_connection(),
        ApprovalReviewRequest(
            action="edit",
            arguments={"patch": "*** Begin Patch\n*** End Patch"},
            cwd=tmp_path,
            tool_name="apply_patch",
            write_paths=[tmp_path / "outside"],
        ),
        completion=fake_completion,
    )

    assert decision.decision == "denied"
    assert "model unavailable" in decision.reason
