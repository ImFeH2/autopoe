from __future__ import annotations

from pathlib import Path

import pytest

from huddol.adapters.files.tree import MarkdownTree
from huddol.services.library import Library
from huddol.services.memory import Memory


@pytest.fixture
def library(tmp_path: Path) -> Library:
    return Library(MarkdownTree(tmp_path / "library"))


@pytest.fixture
def memory(tmp_path: Path) -> Memory:
    return Memory(MarkdownTree(tmp_path / "agents" / "13" / "memory"))


def test_library_round_trips_a_document(library: Library) -> None:
    entry = library.write("guides/onboarding.md", "welcome")
    document = library.read("guides/onboarding.md")
    assert document.content == "welcome"
    assert document.content_hash == entry.content_hash


def test_library_concurrent_edit_is_rejected_then_recoverable(library: Library) -> None:
    first = library.write("shared.md", "v1")
    library.write("shared.md", "v2", expected_hash=first.content_hash)
    latest = library.read("shared.md")
    assert latest.content == "v2"
    assert library.write("shared.md", "v3", expected_hash=latest.content_hash)


def test_memory_index_context_is_empty_without_files(memory: Memory) -> None:
    assert memory.index_context() == ""


def test_memory_index_context_lists_files_and_index(memory: Memory) -> None:
    memory.write("MEMORY.md", "- huddol rewrite plan")
    memory.write("topics/rewrite.md", "details")
    context = memory.index_context()
    assert "huddol rewrite plan" in context
    assert "topics/rewrite.md" in context


def test_memory_falls_back_to_a_plain_listing_without_an_index(memory: Memory) -> None:
    memory.write("topics/rewrite.md", "details")
    context = memory.index_context()
    assert context.startswith("Your memory files:")
    assert "topics/rewrite.md" in context


def test_library_and_memory_are_separate_trees(
    library: Library, memory: Memory
) -> None:
    library.write("shared.md", "org wide")
    memory.write("private.md", "mine")
    assert [item.path for item in library.list()] == ["shared.md"]
    assert [item.path for item in memory.list()] == ["private.md"]
