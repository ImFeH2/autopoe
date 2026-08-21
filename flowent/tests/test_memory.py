from __future__ import annotations

import os
import stat
from pathlib import Path

import pytest

from flowent.domain import DomainError
from flowent.memory import (
    HUMAN_READ_MAX_BYTES,
    INDEX_MAX_BYTES,
    INDEX_MAX_LINES,
    MEMORY_PATH_MAX_LENGTH,
    AgentMemory,
)


def test_memory_crud_is_agent_private_and_outside_workspace(tmp_path: Path) -> None:
    data_directory = tmp_path / "data"
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    memory = AgentMemory(data_directory)

    written = memory.write(2, "MEMORY.md", "# Index\n- Read patterns.md\n")
    memory.write(2, "topics/patterns.md", "first\nsecond\nthird\n")

    assert written == {
        "path": "MEMORY.md",
        "bytes": 27,
        "index": {
            "loaded_lines": 2,
            "total_lines": 2,
            "loaded_bytes": 27,
            "total_bytes": 27,
            "truncated": False,
        },
    }
    assert memory.list(2) == {
        "paths": ["MEMORY.md", "topics/patterns.md"],
        "count": 2,
    }
    assert memory.list(3) == {"paths": [], "count": 0}
    assert memory.read(2, "topics/patterns.md", offset=2, limit=1) == {
        "path": "topics/patterns.md",
        "content": "second\n",
        "start_line": 2,
        "end_line": 2,
        "total_lines": 3,
        "truncated": True,
    }
    assert not list(workspace.iterdir())
    assert (data_directory / "agents" / "2" / "memory" / "MEMORY.md").read_text() == (
        "# Index\n- Read patterns.md\n"
    )

    with pytest.raises(DomainError, match="not found"):
        memory.read(3, "MEMORY.md")

    edited = memory.edit(2, "topics/patterns.md", "second", "updated")
    assert edited == {
        "path": "topics/patterns.md",
        "replacement_count": 1,
        "bytes": 20,
    }
    assert memory.read(2, "topics/patterns.md")["content"] == (
        "first\nupdated\nthird\n"
    )
    assert memory.delete(2, "topics/patterns.md") == {
        "deleted_path": "topics/patterns.md"
    }
    assert memory.list(2) == {"paths": ["MEMORY.md"], "count": 1}


def test_memory_edit_requires_an_exact_unique_change(tmp_path: Path) -> None:
    memory = AgentMemory(tmp_path)
    memory.write(2, "notes.md", "same same\n")

    with pytest.raises(DomainError, match="not found"):
        memory.edit(2, "notes.md", "missing", "new")
    with pytest.raises(DomainError, match="matched 2 times"):
        memory.edit(2, "notes.md", "same", "new")
    with pytest.raises(DomainError, match="would not change"):
        memory.edit(2, "notes.md", "same", "same", replace_all=True)

    assert memory.edit(2, "notes.md", "same", "new", replace_all=True) == {
        "path": "notes.md",
        "replacement_count": 2,
        "bytes": 8,
    }
    assert memory.read(2, "notes.md")["content"] == "new new\n"


def test_memory_index_context_is_bounded_by_lines_and_utf8_bytes(
    tmp_path: Path,
) -> None:
    memory = AgentMemory(tmp_path)
    lines = [f"line {index}\n" for index in range(INDEX_MAX_LINES + 5)]
    memory.write(2, "MEMORY.md", "".join(lines))

    context = memory.index_context(2)

    assert context is not None
    assert context.startswith('<memory truncated="true">\n')
    assert "line 199\n" in context
    assert "line 200\n" not in context
    assert context.endswith("</memory>")

    byte_limited = "é" * INDEX_MAX_BYTES
    memory.write(2, "MEMORY.md", byte_limited)
    context = memory.index_context(2)

    assert context is not None
    assert context.startswith('<memory truncated="true">\n')
    loaded = context.split("\n", 1)[1].rsplit("\n</memory>", 1)[0]
    assert len(loaded.encode("utf-8")) <= INDEX_MAX_BYTES
    assert not loaded.endswith("�")


def test_memory_index_reports_invalid_utf8_without_failing_the_turn(
    tmp_path: Path,
) -> None:
    memory = AgentMemory(tmp_path)
    memory.write(2, "MEMORY.md", "valid")
    target = tmp_path / "agents" / "2" / "memory" / "MEMORY.md"
    target.write_bytes(b"\xff")

    assert memory.index_context(2) == (
        "<memory>\n"
        "MEMORY.md could not be loaded. Use memory action=write to repair it.\n"
        "</memory>"
    )


def test_memory_rejects_escaping_non_markdown_and_symlink_paths(
    tmp_path: Path,
) -> None:
    memory = AgentMemory(tmp_path / "data")
    outside = tmp_path / "outside.md"
    outside.write_text("outside")

    invalid_paths = (
        "../outside.md",
        "/outside.md",
        "topic/../outside.md",
        "topic//outside.md",
        "topic/./outside.md",
        "topic\\outside.md",
        "notes.txt",
        " notes.md",
        "notes.md ",
        "notes.md\0",
    )
    for path in invalid_paths:
        with pytest.raises(DomainError, match="Memory (path|files)"):
            memory.write(2, path, "content")

    agent_root = tmp_path / "data" / "agents" / "2"
    agent_root.mkdir(parents=True)
    (agent_root / "memory").symlink_to(tmp_path)
    assert "MEMORY.md could not be loaded" in memory.index_context(2)
    with pytest.raises(DomainError, match="symbolic link"):
        memory.write(2, "outside.md", "changed")
    assert outside.read_text() == "outside"

    (agent_root / "memory").unlink()
    memory.write(2, "inside.md", "inside")
    target = agent_root / "memory" / "link.md"
    target.symlink_to(outside)
    with pytest.raises(DomainError, match="regular file"):
        memory.read(2, "link.md")
    assert memory.list(2) == {"paths": ["inside.md"], "count": 1}


def test_memory_validates_read_and_edit_arguments(tmp_path: Path) -> None:
    memory = AgentMemory(tmp_path)
    memory.write(2, "notes.md", "content")

    for offset in (0, -1, True, 1.5):
        with pytest.raises(DomainError, match="offset"):
            memory.read(2, "notes.md", offset=offset)  # type: ignore[arg-type]
    for limit in (0, 2001, True, 1.5):
        with pytest.raises(DomainError, match="limit"):
            memory.read(2, "notes.md", limit=limit)  # type: ignore[arg-type]
    with pytest.raises(DomainError, match="old_text"):
        memory.edit(2, "notes.md", "", "new")
    with pytest.raises(DomainError, match="new_text"):
        memory.edit(2, "notes.md", "content", 1)  # type: ignore[arg-type]
    with pytest.raises(DomainError, match="replace_all"):
        memory.edit(2, "notes.md", "content", "new", 1)  # type: ignore[arg-type]


def test_memory_atomic_failure_preserves_original_and_permissions(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    memory = AgentMemory(tmp_path)
    memory.write(2, "MEMORY.md", "before\n")
    target = tmp_path / "agents" / "2" / "memory" / "MEMORY.md"
    target.chmod(0o640)

    def reject_replace(_source: Path, _target: Path) -> None:
        raise PermissionError("blocked")

    monkeypatch.setattr(os, "replace", reject_replace)
    with pytest.raises(DomainError, match="could not be written"):
        memory.write(2, "MEMORY.md", "after\n")

    assert target.read_text() == "before\n"
    assert not list(target.parent.glob(".*.flowent-*"))

    monkeypatch.undo()
    memory.write(2, "MEMORY.md", "after\n")
    if os.name == "posix":
        assert stat.S_IMODE(target.stat().st_mode) == 0o600
        assert stat.S_IMODE(target.parent.stat().st_mode) == 0o700


def test_memory_deletion_and_startup_cleanup_do_not_follow_symlinks(
    tmp_path: Path,
) -> None:
    memory = AgentMemory(tmp_path / "data")
    memory.write(2, "MEMORY.md", "active")
    memory.write(3, "MEMORY.md", "orphan")
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "keep.md").write_text("keep")
    symlink = tmp_path / "data" / "agents" / "4"
    symlink.symlink_to(outside, target_is_directory=True)
    (tmp_path / "data" / "agents" / "unmanaged").mkdir()

    assert memory.remove_orphans({2}) == 2
    assert memory.list(2) == {"paths": ["MEMORY.md"], "count": 1}
    assert not (tmp_path / "data" / "agents" / "3").exists()
    assert not symlink.exists()
    assert (outside / "keep.md").read_text() == "keep"
    assert (tmp_path / "data" / "agents" / "unmanaged").is_dir()

    memory.delete_all(2)
    assert not (tmp_path / "data" / "agents" / "2").exists()


def test_human_memory_listing_is_paged_and_pins_main_index(tmp_path: Path) -> None:
    memory = AgentMemory(tmp_path)
    for path in ("zeta.md", "topics/beta.md", "MEMORY.md", "alpha.md"):
        memory.write(2, path, path)

    first = memory.list_page(2, offset=0, limit=2)
    second = memory.list_page(2, offset=2, limit=2)

    assert first == {
        "paths": ["MEMORY.md", "alpha.md"],
        "count": 2,
        "total": 4,
        "offset": 0,
        "limit": 2,
        "has_more": True,
        "next_offset": 2,
    }
    assert second["paths"] == ["topics/beta.md", "zeta.md"]
    assert second["has_more"] is False
    assert second["next_offset"] is None
    assert memory.list_page(2, offset=99, limit=2) == {
        "paths": [],
        "count": 0,
        "total": 4,
        "offset": 4,
        "limit": 2,
        "has_more": False,
        "next_offset": None,
    }


def test_human_memory_read_has_a_utf8_byte_ceiling(tmp_path: Path) -> None:
    memory = AgentMemory(tmp_path)
    memory.write(2, "large.md", "é" * (HUMAN_READ_MAX_BYTES + 10))

    result = memory.read_for_human(2, "large.md")

    assert result["bytes"] <= HUMAN_READ_MAX_BYTES
    assert result["bytes_truncated"] is True
    assert result["truncated"] is True
    assert "�" not in result["content"]
    assert result["path"] == "large.md"


def test_memory_rejects_control_characters_and_overlong_paths(tmp_path: Path) -> None:
    memory = AgentMemory(tmp_path)

    invalid_paths = (
        "bad\nname.md",
        "bad\tname.md",
        "safe\u202eevil.md",
        "safe\u200bevil.md",
        " notes.md",
        "notes.md ",
        "x" * MEMORY_PATH_MAX_LENGTH + ".md",
    )
    for path in invalid_paths:
        with pytest.raises(DomainError, match="Memory path is invalid"):
            memory.write(2, path, "content")

    valid = "/".join(["x" * 200] * 5 + ["x" * 16 + ".md"])
    assert len(valid) == MEMORY_PATH_MAX_LENGTH
    assert memory.write(2, valid, "content")["path"] == valid
