from __future__ import annotations

from pathlib import Path

import pytest

from huddol.adapters.files.tree import MarkdownTree, content_hash
from huddol.core.errors import DomainError
from huddol.ports.files import ConflictError


@pytest.fixture
def tree(tmp_path: Path) -> MarkdownTree:
    return MarkdownTree(tmp_path / "library")


def require_symlinks(tmp_path: Path) -> None:
    probe = tmp_path / "symlink-probe"
    try:
        probe.symlink_to(tmp_path)
    except (OSError, NotImplementedError) as error:
        pytest.skip(f"symlinks are unavailable on this host: {error}")
    probe.unlink()


def test_creates_reads_and_lists_nested_documents(tree: MarkdownTree) -> None:
    tree.write("notes.md", "top level")
    tree.write("specs/protocol.md", "nested")
    assert [item.path for item in tree.list()] == ["notes.md", "specs/protocol.md"]
    content, digest = tree.read("specs/protocol.md")
    assert content == "nested"
    assert digest == content_hash("nested")


def test_overwrite_requires_matching_expected_hash(tree: MarkdownTree) -> None:
    entry = tree.write("doc.md", "first")
    with pytest.raises(DomainError) as missing:
        tree.write("doc.md", "second")
    assert missing.value.code == "expected_hash_required"

    with pytest.raises(ConflictError) as stale:
        tree.write("doc.md", "second", expected_hash="0" * 16)
    assert stale.value.actual == entry.content_hash

    updated = tree.write("doc.md", "second", expected_hash=entry.content_hash)
    assert updated.content_hash == content_hash("second")


def test_creating_a_new_document_needs_no_expected_hash(tree: MarkdownTree) -> None:
    assert tree.write("fresh.md", "hello").path == "fresh.md"


@pytest.mark.parametrize(
    "path",
    ["../escape.md", "/etc/passwd.md", "a/../../b.md", "", "   "],
)
def test_rejects_paths_that_escape_the_tree(tree: MarkdownTree, path: str) -> None:
    with pytest.raises(DomainError) as error:
        tree.write(path, "nope")
    assert error.value.code == "invalid_path"


def test_rejects_non_markdown_files(tree: MarkdownTree) -> None:
    with pytest.raises(DomainError) as error:
        tree.write("script.sh", "rm -rf /")
    assert error.value.code == "invalid_path"


def test_symlinked_files_cannot_read_outside_the_tree(
    tree: MarkdownTree, tmp_path: Path
) -> None:
    require_symlinks(tmp_path)
    secret = tmp_path / "secret.md"
    secret.write_text("classified", encoding="utf-8")
    (tree.root / "link.md").symlink_to(secret)
    with pytest.raises(DomainError) as error:
        tree.read("link.md")
    assert error.value.code == "invalid_path"
    assert [item.path for item in tree.list()] == []


def test_symlink_pointing_inside_the_tree_is_still_excluded_from_listings(
    tree: MarkdownTree, tmp_path: Path
) -> None:
    require_symlinks(tmp_path)
    tree.write("real.md", "content")
    (tree.root / "alias.md").symlink_to(tree.root / "real.md")
    assert [item.path for item in tree.list()] == ["real.md"]


def test_delete_prunes_empty_parent_directories(tree: MarkdownTree) -> None:
    tree.write("a/b/c.md", "deep")
    tree.delete("a/b/c.md")
    assert tree.list() == ()
    assert not (tree.root / "a").exists()


def test_move_renames_and_refuses_to_clobber(tree: MarkdownTree) -> None:
    tree.write("old.md", "content")
    tree.write("taken.md", "other")
    moved = tree.move("old.md", "folder/new.md")
    assert moved.path == "folder/new.md"
    assert tree.read("folder/new.md")[0] == "content"

    tree.write("again.md", "x")
    with pytest.raises(DomainError) as error:
        tree.move("again.md", "taken.md")
    assert error.value.code == "already_exists"


def test_writes_are_atomic_and_leave_no_temporary_files(tree: MarkdownTree) -> None:
    tree.write("doc.md", "content")
    leftovers = [item.name for item in tree.root.rglob("*.tmp")]
    assert leftovers == []
