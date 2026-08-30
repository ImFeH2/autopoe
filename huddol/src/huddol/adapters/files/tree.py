from __future__ import annotations

import hashlib
import os
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath

from huddol.core.errors import DomainError
from huddol.ports.files import ConflictError, TreeEntry

MAX_FILE_BYTES = 1_000_000
ALLOWED_SUFFIX = ".md"


def content_hash(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()[:16]


class MarkdownTree:
    def __init__(self, root: Path | str) -> None:
        self._root = Path(root)
        self._root.mkdir(parents=True, exist_ok=True)

    @property
    def root(self) -> Path:
        return self._root

    def _resolve(self, path: str, *, require_suffix: bool = True) -> Path:
        if not isinstance(path, str) or not path.strip():
            raise DomainError("invalid_path", "Path must not be empty")
        pure = PurePosixPath(path.replace("\\", "/"))
        if pure.is_absolute() or any(part in ("..", "") for part in pure.parts):
            raise DomainError(
                "invalid_path", "Path must be relative and must not escape"
            )
        if require_suffix and pure.suffix != ALLOWED_SUFFIX:
            raise DomainError("invalid_path", "Only Markdown files are allowed")
        target = (self._root / pure).resolve()
        root = self._root.resolve()
        if target != root and root not in target.parents:
            raise DomainError("invalid_path", "Path must stay inside the tree")
        return target

    def _relative(self, target: Path) -> str:
        return target.resolve().relative_to(self._root.resolve()).as_posix()

    def _entry(self, target: Path) -> TreeEntry:
        stat = target.stat()
        modified = datetime.fromtimestamp(stat.st_mtime, UTC)
        return TreeEntry(
            path=self._relative(target),
            size=stat.st_size,
            modified_at=modified.isoformat(timespec="seconds").replace("+00:00", "Z"),
            content_hash=content_hash(target.read_text(encoding="utf-8")),
        )

    def list(self, path: str | None = None) -> tuple[TreeEntry, ...]:
        base = self._root if path is None else self._resolve(path, require_suffix=False)
        if not base.is_dir():
            return ()
        found = [
            self._entry(item)
            for item in sorted(base.rglob(f"*{ALLOWED_SUFFIX}"))
            if item.is_file() and not item.is_symlink()
        ]
        return tuple(found)

    def read(self, path: str) -> tuple[str, str]:
        target = self._resolve(path)
        if not target.is_file() or target.is_symlink():
            raise DomainError("not_found", f"{path} does not exist")
        content = target.read_text(encoding="utf-8")
        return content, content_hash(content)

    def write(
        self, path: str, content: str, *, expected_hash: str | None = None
    ) -> TreeEntry:
        if not isinstance(content, str):
            raise DomainError("invalid_content", "Content must be a string")
        if len(content.encode("utf-8")) > MAX_FILE_BYTES:
            raise DomainError("invalid_content", "Content is too large")
        target = self._resolve(path)
        exists = target.is_file()
        if exists:
            current = content_hash(target.read_text(encoding="utf-8"))
            if expected_hash is None:
                raise DomainError(
                    "expected_hash_required",
                    "expected_hash is required when overwriting an existing document",
                )
            if expected_hash != current:
                raise ConflictError(path, expected_hash, current)
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_name(target.name + ".tmp")
        temporary.write_text(content, encoding="utf-8")
        os.replace(temporary, target)
        return self._entry(target)

    def delete(self, path: str) -> None:
        target = self._resolve(path)
        if not target.is_file():
            raise DomainError("not_found", f"{path} does not exist")
        target.unlink()
        parent = target.parent
        root = self._root.resolve()
        while parent != root and not any(parent.iterdir()):
            parent.rmdir()
            parent = parent.parent

    def move(self, source: str, destination: str) -> TreeEntry:
        origin = self._resolve(source)
        target = self._resolve(destination)
        if not origin.is_file():
            raise DomainError("not_found", f"{source} does not exist")
        if target.exists():
            raise DomainError("already_exists", f"{destination} already exists")
        target.parent.mkdir(parents=True, exist_ok=True)
        os.replace(origin, target)
        return self._entry(target)
