from __future__ import annotations

import os
import stat
import tempfile
from collections.abc import Callable, Iterable, Iterator
from pathlib import Path
from typing import Annotated, Any, Literal

from pydantic import Field
from pydantic_ai import ToolFailed

FileSpace = Literal["workspace", "home"]
Depth = Annotated[int, Field(ge=1, le=5)]
EntryLimit = Annotated[int, Field(ge=1, le=500)]
LineNumber = Annotated[int, Field(ge=1)]
LineCount = Annotated[int, Field(ge=1, le=500)]
ResultLimit = Annotated[int, Field(ge=1, le=200)]

MAX_FILE_BYTES = 2 * 1024 * 1024
MAX_READ_BYTES = 256 * 1024
MAX_LINE_PREVIEW = 500
SKIPPED_DIRECTORIES = frozenset(
    {".git", ".venv", "__pycache__", "build", "dist", "node_modules", "target"}
)


class FileTools:
    def __init__(self, workspace: Path, home: Path):
        self.roots = {
            "workspace": workspace.resolve(),
            "home": home.resolve(),
        }

    @property
    def functions(self) -> list[Callable[..., Any]]:
        return [
            self.list_files,
            self.read_file,
            self.search_files,
            self.write_file,
            self.replace_in_file,
        ]

    @property
    def names(self) -> list[str]:
        return [function.__name__ for function in self.functions]

    def list_files(
        self,
        space: FileSpace,
        path: str = ".",
        depth: Depth = 1,
        max_entries: EntryLimit = 200,
    ) -> dict[str, Any]:
        """List files and directories inside a Workspace or Agent Home path."""
        target = self._resolve(space, path)
        if not target.exists():
            raise ToolFailed(f"Path not found: {path}")
        if not target.is_dir():
            return {"entries": [self._entry(space, target)], "truncated": False}

        entries: list[dict[str, Any]] = []
        truncated = False

        def visit(directory: Path, level: int) -> None:
            nonlocal truncated
            try:
                children = sorted(
                    directory.iterdir(), key=lambda item: item.name.casefold()
                )
            except OSError as error:
                raise ToolFailed(
                    f"Could not list path: {self._display(space, directory)}"
                ) from error
            for child in children:
                if len(entries) >= max_entries:
                    truncated = True
                    return
                entries.append(self._entry(space, child))
                if (
                    level < depth
                    and not child.is_symlink()
                    and child.is_dir()
                    and child.name not in SKIPPED_DIRECTORIES
                ):
                    visit(child, level + 1)
                    if truncated:
                        return

        visit(target, 1)
        return {"entries": entries, "truncated": truncated}

    def read_file(
        self,
        space: FileSpace,
        path: str,
        start_line: LineNumber = 1,
        line_count: LineCount = 200,
    ) -> dict[str, Any]:
        """Read a UTF-8 text file from a Workspace or Agent Home line range."""
        target = self._file(space, path)
        text = self._read_text(target, path)
        lines = text.splitlines(keepends=True)
        if lines and start_line > len(lines):
            raise ToolFailed(f"Start line exceeds file length: {start_line}")
        selected = lines[start_line - 1 : start_line - 1 + line_count]
        content = "".join(selected)
        if len(content.encode("utf-8")) > MAX_READ_BYTES:
            raise ToolFailed(
                "Requested line range is too large; use a smaller line_count"
            )
        end_line = start_line + len(selected) - 1 if selected else 0
        return {
            "path": self._display(space, target),
            "content": content,
            "start_line": start_line,
            "end_line": end_line,
            "total_lines": len(lines),
            "has_more": end_line < len(lines),
        }

    def search_files(
        self,
        space: FileSpace,
        query: str,
        path: str = ".",
        case_sensitive: bool = False,
        max_results: ResultLimit = 50,
    ) -> dict[str, Any]:
        """Search UTF-8 text files for literal text inside a Workspace or Agent Home."""
        if not query:
            raise ToolFailed("Search query is required")
        if len(query) > 256:
            raise ToolFailed("Search query is too long")
        target = self._resolve(space, path)
        if not target.exists():
            raise ToolFailed(f"Path not found: {path}")
        if target.is_file():
            files: Iterable[Path] = [target]
        elif target.is_dir():
            files = self._search_files(target)
        else:
            raise ToolFailed(f"Path is not a file or directory: {path}")
        needle = query if case_sensitive else query.casefold()
        matches: list[dict[str, Any]] = []
        skipped_files = 0

        for candidate in files:
            try:
                resolved = candidate.resolve()
                if not resolved.is_relative_to(self._root(space)):
                    skipped_files += 1
                    continue
                if not resolved.is_file() or resolved.stat().st_size > MAX_FILE_BYTES:
                    skipped_files += 1
                    continue
                data = resolved.read_bytes()
            except OSError as error:
                raise ToolFailed(
                    f"Could not search file: {self._display(space, candidate)}"
                ) from error
            if b"\0" in data:
                skipped_files += 1
                continue
            try:
                text = data.decode("utf-8")
            except UnicodeDecodeError:
                skipped_files += 1
                continue

            for line_number, line in enumerate(text.splitlines(), 1):
                haystack = line if case_sensitive else line.casefold()
                column = haystack.find(needle)
                if column < 0:
                    continue
                preview_start = max(0, column - 100)
                preview = line[preview_start : preview_start + MAX_LINE_PREVIEW]
                matches.append(
                    {
                        "path": self._display(space, candidate),
                        "line": line_number,
                        "column": column + 1,
                        "text": preview,
                        "text_start_column": preview_start + 1,
                        "text_truncated": len(preview) < len(line),
                    }
                )
                if len(matches) >= max_results:
                    return {
                        "matches": matches,
                        "truncated": True,
                        "skipped_files": skipped_files,
                    }

        return {
            "matches": matches,
            "truncated": False,
            "skipped_files": skipped_files,
        }

    def write_file(
        self,
        space: FileSpace,
        path: str,
        content: str,
        overwrite: bool = False,
    ) -> dict[str, Any]:
        """Create a UTF-8 text file or explicitly overwrite one in Workspace or Home."""
        target = self._resolve(space, path)
        if target == self._root(space):
            raise ToolFailed("A file path is required")
        if target.exists() and target.is_dir():
            raise ToolFailed(f"Path is a directory: {path}")
        if target.exists() and not overwrite:
            raise ToolFailed(
                "File already exists; use overwrite=true or replace_in_file"
            )
        data = self._encode_text(content)
        if len(data) > MAX_FILE_BYTES:
            raise ToolFailed("File content is too large")
        created = not target.exists()
        self._atomic_write(target, data)
        return {
            "path": self._display(space, target),
            "bytes": len(data),
            "created": created,
        }

    def replace_in_file(
        self,
        space: FileSpace,
        path: str,
        old_text: str,
        new_text: str,
        replace_all: bool = False,
    ) -> dict[str, Any]:
        """Replace exact text in a UTF-8 Workspace or Agent Home file."""
        if not old_text:
            raise ToolFailed("old_text is required")
        target = self._file(space, path)
        content = self._read_text(target, path)
        occurrences = content.count(old_text)
        if occurrences == 0:
            raise ToolFailed("old_text was not found")
        if occurrences > 1 and not replace_all:
            raise ToolFailed(
                f"old_text occurs {occurrences} times; make it unique or use replace_all=true"
            )
        replacements = occurrences if replace_all else 1
        updated = content.replace(old_text, new_text, -1 if replace_all else 1)
        data = self._encode_text(updated)
        if len(data) > MAX_FILE_BYTES:
            raise ToolFailed("Updated file content is too large")
        self._atomic_write(target, data)
        return {
            "path": self._display(space, target),
            "replacements": replacements,
            "bytes": len(data),
        }

    def _root(self, space: FileSpace) -> Path:
        try:
            return self.roots[space]
        except KeyError as error:
            raise ToolFailed("space must be workspace or home") from error

    def _resolve(self, space: FileSpace, path: str) -> Path:
        root = self._root(space)
        requested = Path(path)
        if requested.is_absolute():
            raise ToolFailed("Path must be relative to the selected space")
        try:
            target = (root / requested).resolve()
        except OSError as error:
            raise ToolFailed(f"Could not resolve path: {path}") from error
        if not target.is_relative_to(root):
            raise ToolFailed("Path escapes the selected space")
        return target

    def _file(self, space: FileSpace, path: str) -> Path:
        target = self._resolve(space, path)
        if not target.exists():
            raise ToolFailed(f"File not found: {path}")
        if not target.is_file():
            raise ToolFailed(f"Path is not a file: {path}")
        return target

    def _read_text(self, target: Path, path: str) -> str:
        try:
            if target.stat().st_size > MAX_FILE_BYTES:
                raise ToolFailed("File is too large")
            text = target.read_text(encoding="utf-8")
        except UnicodeDecodeError as error:
            raise ToolFailed(f"File is not valid UTF-8: {path}") from error
        except OSError as error:
            raise ToolFailed(f"Could not read file: {path}") from error
        if "\0" in text:
            raise ToolFailed(f"File is not valid UTF-8 text: {path}")
        return text

    def _search_files(self, target: Path) -> Iterator[Path]:
        def failed(error: OSError) -> None:
            raise ToolFailed(f"Could not search path: {target.name}") from error

        for directory, names, filenames in os.walk(target, onerror=failed):
            names[:] = sorted(
                (name for name in names if name not in SKIPPED_DIRECTORIES),
                key=str.casefold,
            )
            for filename in sorted(filenames, key=str.casefold):
                yield Path(directory) / filename

    def _entry(self, space: FileSpace, path: Path) -> dict[str, Any]:
        try:
            if path.is_symlink():
                kind = "symlink"
                size = None
            elif path.is_dir():
                kind = "directory"
                size = None
            elif path.is_file():
                kind = "file"
                size = path.stat().st_size
            else:
                kind = "other"
                size = None
        except OSError as error:
            raise ToolFailed(f"Could not inspect path: {path.name}") from error
        return {
            "path": self._display(space, path),
            "type": kind,
            "size": size,
        }

    def _display(self, space: FileSpace, path: Path) -> str:
        root = self._root(space)
        try:
            relative = path.relative_to(root)
        except ValueError:
            relative = path.resolve().relative_to(root)
        value = relative.as_posix()
        return value or "."

    @staticmethod
    def _encode_text(content: str) -> bytes:
        if "\0" in content:
            raise ToolFailed("File content must be UTF-8 text")
        try:
            return content.encode("utf-8")
        except UnicodeEncodeError as error:
            raise ToolFailed("File content must be valid UTF-8") from error

    @staticmethod
    def _atomic_write(target: Path, data: bytes) -> None:
        temporary: Path | None = None
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            mode = stat.S_IMODE(target.stat().st_mode) if target.exists() else 0o644
            descriptor, name = tempfile.mkstemp(
                dir=target.parent,
                prefix=f".{target.name}.",
                suffix=".tmp",
            )
            temporary = Path(name)
            with os.fdopen(descriptor, "wb") as output:
                output.write(data)
                output.flush()
                os.fsync(output.fileno())
            temporary.chmod(mode)
            os.replace(temporary, target)
        except OSError as error:
            raise ToolFailed(f"Could not write file: {target.name}") from error
        finally:
            if temporary and temporary.exists():
                try:
                    temporary.unlink()
                except OSError as error:
                    raise ToolFailed(
                        f"Could not remove temporary file: {temporary.name}"
                    ) from error
