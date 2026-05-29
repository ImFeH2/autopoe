import pytest

from flowent.patch import PatchError, affected_paths, apply_patch


def test_apply_patch_applies_context_hunk_with_interleaved_changes(tmp_path) -> None:
    target = tmp_path / "notes.txt"
    target.write_text("start\nalpha\nmiddle\nbeta\nend\n")
    patch = """*** Begin Patch
*** Update File: notes.txt
@@
 start
-alpha
+one
 middle
-beta
+two
 end
*** End Patch
"""

    result = apply_patch(patch, tmp_path)

    assert result == {"files": [{"path": str(target), "status": "modified"}]}
    assert target.read_text() == "start\none\nmiddle\ntwo\nend\n"


def test_apply_patch_reports_context_mismatch(tmp_path) -> None:
    target = tmp_path / "notes.txt"
    target.write_text("start\nalpha\nend\n")
    patch = """*** Begin Patch
*** Update File: notes.txt
@@
 missing
-alpha
+beta
 end
*** End Patch
"""

    with pytest.raises(PatchError, match=r"Patch context was not found\."):
        apply_patch(patch, tmp_path)

    assert target.read_text() == "start\nalpha\nend\n"


def test_apply_patch_applies_multiple_hunks_in_order(tmp_path) -> None:
    target = tmp_path / "notes.txt"
    target.write_text("first\nsame\nend first\nsecond\nsame\nend second\n")
    patch = """*** Begin Patch
*** Update File: notes.txt
@@
 first
-same
+one
 end first
@@
 second
-same
+two
 end second
*** End Patch
"""

    apply_patch(patch, tmp_path)

    assert target.read_text() == "first\none\nend first\nsecond\ntwo\nend second\n"


def test_apply_patch_keeps_simple_contiguous_replacement(tmp_path) -> None:
    target = tmp_path / "notes.txt"
    target.write_text("alpha\nbeta\n")
    patch = """*** Begin Patch
*** Update File: notes.txt
@@
-alpha
-beta
+ready
*** End Patch
"""

    apply_patch(patch, tmp_path)

    assert target.read_text() == "ready\n"


def test_affected_paths_reads_structured_patch_write_targets(tmp_path) -> None:
    patch = """*** Begin Patch
*** Update File: notes.txt
@@
-alpha
+beta
*** Add File: created.txt
+hello
*** Delete File: old.txt
*** Update File: before.txt
*** Move to: after.txt
@@
-before
+after
*** End Patch
"""

    paths = affected_paths(patch, tmp_path)

    assert paths == [
        (tmp_path / "notes.txt").resolve(strict=False),
        (tmp_path / "created.txt").resolve(strict=False),
        (tmp_path / "old.txt").resolve(strict=False),
        (tmp_path / "before.txt").resolve(strict=False),
        (tmp_path / "after.txt").resolve(strict=False),
    ]
