from __future__ import annotations

import json

from huddol.adapters.model.compaction import compact


def request(index: int, size: int = 10) -> dict[str, object]:
    return {
        "kind": "request",
        "parts": [{"part_kind": "user-prompt", "content": "r" * size}],
        "index": index,
    }


def response(index: int, size: int = 10) -> dict[str, object]:
    return {
        "kind": "response",
        "parts": [{"part_kind": "text", "content": "t" * size}],
        "index": index,
    }


def conversation(pairs: int, size: int = 10) -> list[object]:
    history: list[object] = []
    for index in range(pairs):
        history.append(request(index, size))
        history.append(response(index, size))
    return history


def test_short_history_is_left_alone() -> None:
    history = conversation(2)
    result = compact(history, threshold=1_000_000)
    assert result.applied is False
    assert result.kept == history


def test_history_over_the_threshold_is_trimmed() -> None:
    history = conversation(40, size=200)
    result = compact(history, threshold=5_000)
    assert result.applied is True
    assert result.after_bytes < result.before_bytes
    assert len(result.kept) < len(history)


def test_the_kept_history_always_starts_with_a_request() -> None:
    history = conversation(40, size=200)
    kept = compact(history, threshold=5_000).kept
    assert kept
    first = kept[0]
    assert isinstance(first, dict)
    assert first["kind"] == "request"


def test_the_most_recent_exchanges_survive() -> None:
    history = conversation(40, size=200)
    kept = compact(history, threshold=5_000).kept
    assert kept[-1] == history[-1]
    assert kept[-2] == history[-2]


def test_compaction_never_drops_everything() -> None:
    history = conversation(40, size=5_000)
    result = compact(history, threshold=10)
    assert len(result.kept) > 0
    assert result.applied is True


def test_a_history_shorter_than_the_keep_window_is_untouched() -> None:
    history = conversation(2, size=100_000)
    result = compact(history, threshold=10)
    assert result.applied is False
    assert result.kept == history


def test_result_is_still_valid_json() -> None:
    history = conversation(40, size=200)
    kept = compact(history, threshold=5_000).kept
    assert json.loads(json.dumps(kept)) == kept
