import pytest
from pydantic import ValidationError

from flowent_agent.protocol import Envelope


def test_envelope_round_trip() -> None:
    envelope = Envelope(
        id="request-1",
        kind="request",
        name="agent.run",
        payload={"run_id": "run-1"},
    )

    assert Envelope.model_validate_json(envelope.model_dump_json()) == envelope


def test_response_requires_correlation() -> None:
    with pytest.raises(ValidationError):
        Envelope(id="response-1", kind="response", name="agent.run")
