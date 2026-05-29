import pytest

from flowent.approval import ApprovalReviewRequest, review_approval_request
from flowent.llm import ProviderConnection, ProviderFormat


def provider_connection() -> ProviderConnection:
    return ProviderConnection(
        model="model",
        name="Provider",
        provider=ProviderFormat.OPENAI,
        secret_reference="secret",
    )


@pytest.mark.anyio
async def test_review_payload_includes_current_user_request(tmp_path) -> None:
    captured_messages: list[dict[str, object]] = []

    async def fake_completion(**request: object) -> object:
        captured_messages.extend(request["messages"])
        return {
            "choices": [
                {
                    "message": {
                        "content": '{"decision":"approved","reason":"Matches request."}',
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
            user_request="Start the dev container with Docker Compose.",
            write_paths=[tmp_path / "docker.sock"],
        ),
        completion=fake_completion,
    )

    assert decision.decision == "approved"
    assert "Start the dev container with Docker Compose." in str(
        captured_messages[-1]["content"]
    )


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
