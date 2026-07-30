from flowent_agent.runtime import Runtime


def test_chunk_text_preserves_content() -> None:
    value = "Flowent streams from Python"

    assert "".join(Runtime.chunk_text(value)) == value
