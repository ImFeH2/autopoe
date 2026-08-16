from __future__ import annotations

import os
import shutil
import stat
import tempfile
from pathlib import Path, PurePosixPath
from threading import RLock
from typing import Any

from flowent.diagnostics import log_event, log_exception
from flowent.domain import DomainError

MEMORY_INDEX = "MEMORY.md"
INDEX_MAX_LINES = 200
INDEX_MAX_BYTES = 25 * 1024
READ_DEFAULT_LINES = 200
READ_MAX_LINES = 2000
MEMORY_CONTEXT_START = "<memory>"
MEMORY_CONTEXT_END = "</memory>"


class AgentMemory:
    def __init__(self, data_directory: Path) -> None:
        self._root = data_directory / "agents"
        self._lock = RLock()
        self._ensure_directory(self._root)

    def list(self, agent_id: int) -> dict[str, Any]:
        with self._lock:
            root = self._memory_root(agent_id, create=False)
            if root is None:
                paths: list[str] = []
            else:
                paths = sorted(self._list_paths(root))
        return {"paths": paths, "count": len(paths)}

    def read(
        self,
        agent_id: int,
        path: str,
        offset: int = 1,
        limit: int = READ_DEFAULT_LINES,
    ) -> dict[str, Any]:
        if type(offset) is not int or offset < 1:
            raise DomainError(
                "invalid_memory_offset", "Memory offset must be a positive integer"
            )
        if type(limit) is not int or not 1 <= limit <= READ_MAX_LINES:
            raise DomainError(
                "invalid_memory_limit",
                f"Memory limit must be between 1 and {READ_MAX_LINES}",
            )
        with self._lock:
            target = self._existing_file(agent_id, path)
            content = self._read_text(target)
        lines = content.splitlines(keepends=True)
        start = min(offset - 1, len(lines))
        selected = lines[start : start + limit]
        return {
            "path": self._display_path(path),
            "content": "".join(selected),
            "start_line": start + 1,
            "end_line": start + len(selected),
            "total_lines": len(lines),
            "truncated": start + len(selected) < len(lines),
        }

    def write(self, agent_id: int, path: str, content: str) -> dict[str, Any]:
        if not isinstance(content, str):
            raise DomainError(
                "invalid_memory_content", "Memory content must be a string"
            )
        encoded = content.encode("utf-8")
        with self._lock:
            target = self._target_file(agent_id, path, create_parent=True)
            self._atomic_write(target, encoded)
        result: dict[str, Any] = {
            "path": self._display_path(path),
            "bytes": len(encoded),
        }
        if result["path"] == MEMORY_INDEX:
            result["index"] = self._index_status(content)
        return result

    def edit(
        self,
        agent_id: int,
        path: str,
        old_text: str,
        new_text: str,
        replace_all: bool = False,
    ) -> dict[str, Any]:
        if not isinstance(old_text, str) or not old_text:
            raise DomainError(
                "invalid_memory_edit", "Memory old_text must be a non-empty string"
            )
        if not isinstance(new_text, str):
            raise DomainError("invalid_memory_edit", "Memory new_text must be a string")
        if type(replace_all) is not bool:
            raise DomainError(
                "invalid_memory_edit", "Memory replace_all must be a boolean"
            )
        with self._lock:
            target = self._existing_file(agent_id, path)
            content = self._read_text(target)
            count = content.count(old_text)
            if count == 0:
                raise DomainError(
                    "memory_text_not_found", "Memory old_text was not found"
                )
            if count > 1 and not replace_all:
                raise DomainError(
                    "memory_text_not_unique",
                    f"Memory old_text matched {count} times; use replace_all to replace every match",
                )
            updated = content.replace(old_text, new_text, -1 if replace_all else 1)
            if updated == content:
                raise DomainError(
                    "memory_edit_unchanged", "Memory edit would not change the file"
                )
            encoded = updated.encode("utf-8")
            self._atomic_write(target, encoded)
        result: dict[str, Any] = {
            "path": self._display_path(path),
            "replacement_count": count if replace_all else 1,
            "bytes": len(encoded),
        }
        if result["path"] == MEMORY_INDEX:
            result["index"] = self._index_status(updated)
        return result

    def delete(self, agent_id: int, path: str) -> dict[str, Any]:
        display_path = self._display_path(path)
        with self._lock:
            target = self._existing_file(agent_id, path)
            try:
                target.unlink()
                self._remove_empty_parents(target.parent, self._agent_root(agent_id))
            except OSError as error:
                raise DomainError(
                    "memory_delete_failed", "Memory file could not be deleted"
                ) from error
        return {"deleted_path": display_path}

    def index_context(self, agent_id: int) -> str | None:
        try:
            with self._lock:
                root = self._memory_root(agent_id, create=False)
                if root is None:
                    return None
                target = root / MEMORY_INDEX
                if not target.exists():
                    return None
                self._validate_existing_file(target)
                content, truncated = self._read_index(target)
        except (DomainError, OSError, UnicodeError) as error:
            log_exception("memory.index.failed", error, agent_id=agent_id)
            return (
                f"{MEMORY_CONTEXT_START}\n"
                "MEMORY.md could not be loaded. Use memory action=write to repair it.\n"
                f"{MEMORY_CONTEXT_END}"
            )
        opening = '<memory truncated="true">' if truncated else MEMORY_CONTEXT_START
        return f"{opening}\n{content}\n{MEMORY_CONTEXT_END}"

    def delete_all(self, agent_id: int) -> None:
        with self._lock:
            root = self._agent_root(agent_id)
            self._remove_tree(root)
        log_event("memory.agent.deleted", agent_id=agent_id)

    def remove_orphans(self, active_agent_ids: set[int]) -> int:
        removed = 0
        with self._lock:
            try:
                entries = list(self._root.iterdir())
            except OSError as error:
                raise RuntimeError(
                    "Agent Memory directory could not be inspected"
                ) from error
            for entry in entries:
                if not entry.name.isdigit() or int(entry.name) in active_agent_ids:
                    continue
                self._remove_tree(entry)
                removed += 1
        log_event("memory.orphans.removed", removed_count=removed)
        return removed

    def _memory_root(self, agent_id: int, *, create: bool) -> Path | None:
        agent_root = self._agent_root(agent_id)
        if agent_root.exists() or agent_root.is_symlink():
            self._validate_directory(agent_root)
        elif create:
            self._ensure_directory(agent_root)
        else:
            return None
        root = agent_root / "memory"
        if root.exists() or root.is_symlink():
            self._validate_directory(root)
            return root
        if not create:
            return None
        self._ensure_directory(root)
        return root

    def _target_file(self, agent_id: int, path: str, *, create_parent: bool) -> Path:
        parts = self._path_parts(path)
        root = self._memory_root(agent_id, create=True)
        assert root is not None
        current = root
        for part in parts[:-1]:
            current = current / part
            if current.exists() or current.is_symlink():
                self._validate_directory(current)
            elif create_parent:
                self._ensure_directory(current)
            else:
                raise DomainError("memory_not_found", "Memory file was not found")
        target = current / parts[-1]
        if target.exists() or target.is_symlink():
            self._validate_existing_file(target)
        return target

    def _existing_file(self, agent_id: int, path: str) -> Path:
        target = self._target_file(agent_id, path, create_parent=False)
        if not target.exists():
            raise DomainError("memory_not_found", "Memory file was not found")
        self._validate_existing_file(target)
        return target

    def _agent_root(self, agent_id: int) -> Path:
        if type(agent_id) is not int or agent_id < 1:
            raise DomainError("invalid_agent_id", "Agent ID must be a positive integer")
        return self._root / str(agent_id)

    @staticmethod
    def _path_parts(path: str) -> tuple[str, ...]:
        if (
            not isinstance(path, str)
            or not path
            or path != path.strip()
            or "\0" in path
        ):
            raise DomainError("invalid_memory_path", "Memory path is invalid")
        if "\\" in path:
            raise DomainError(
                "invalid_memory_path", "Memory paths must use forward slashes"
            )
        raw_parts = path.split("/")
        parsed = PurePosixPath(path)
        if parsed.is_absolute() or any(part in ("", ".", "..") for part in raw_parts):
            raise DomainError(
                "invalid_memory_path",
                "Memory path must stay inside the Agent Memory directory",
            )
        if parsed.suffix != ".md":
            raise DomainError(
                "invalid_memory_path", "Memory files must use the .md extension"
            )
        return parsed.parts

    @classmethod
    def _display_path(cls, path: str) -> str:
        return PurePosixPath(*cls._path_parts(path)).as_posix()

    @staticmethod
    def _validate_directory(path: Path) -> None:
        if path.is_symlink() or not path.is_dir():
            raise DomainError(
                "invalid_memory_path",
                "Memory path contains a non-directory or symbolic link",
            )

    @staticmethod
    def _validate_existing_file(path: Path) -> None:
        try:
            mode = path.lstat().st_mode
        except OSError as error:
            raise DomainError(
                "memory_not_found", "Memory file was not found"
            ) from error
        if stat.S_ISLNK(mode) or not stat.S_ISREG(mode):
            raise DomainError(
                "invalid_memory_path", "Memory path is not a regular file"
            )

    @classmethod
    def _ensure_directory(cls, path: Path) -> None:
        try:
            path.mkdir(mode=0o700, parents=True, exist_ok=True)
            cls._validate_directory(path)
            path.chmod(0o700)
        except OSError as error:
            raise RuntimeError("Agent Memory directory could not be created") from error

    @classmethod
    def _list_paths(cls, root: Path) -> list[str]:
        paths: list[str] = []
        try:
            for directory, names, files in os.walk(root, followlinks=False):
                current = Path(directory)
                names[:] = [name for name in names if not (current / name).is_symlink()]
                for name in files:
                    candidate = current / name
                    if candidate.is_symlink() or candidate.suffix != ".md":
                        continue
                    cls._validate_existing_file(candidate)
                    paths.append(candidate.relative_to(root).as_posix())
        except OSError as error:
            raise DomainError(
                "memory_list_failed", "Memory files could not be listed"
            ) from error
        return paths

    @staticmethod
    def _read_text(path: Path) -> str:
        try:
            return path.read_text(encoding="utf-8")
        except UnicodeError as error:
            raise DomainError(
                "invalid_memory_content", "Memory file is not valid UTF-8"
            ) from error
        except OSError as error:
            raise DomainError(
                "memory_read_failed", "Memory file could not be read"
            ) from error

    @classmethod
    def _atomic_write(cls, target: Path, content: bytes) -> None:
        descriptor: int | None = None
        temporary: Path | None = None
        try:
            descriptor, name = tempfile.mkstemp(
                prefix=f".{target.name}.flowent-",
                dir=target.parent,
            )
            temporary = Path(name)
            file = os.fdopen(descriptor, "wb")
            descriptor = None
            with file:
                file.write(content)
                file.flush()
                os.fsync(file.fileno())
            temporary.chmod(0o600)
            os.replace(temporary, target)
            target.chmod(0o600)
        except OSError as error:
            raise DomainError(
                "memory_write_failed", "Memory file could not be written"
            ) from error
        finally:
            if descriptor is not None:
                os.close(descriptor)
            if temporary is not None:
                try:
                    temporary.unlink(missing_ok=True)
                except OSError:
                    pass

    @classmethod
    def _read_index(cls, path: Path) -> tuple[str, bool]:
        with path.open("rb") as file:
            raw = file.read(INDEX_MAX_BYTES + 1)
        return cls._bounded_index(raw)

    @classmethod
    def _index_status(cls, content: str) -> dict[str, Any]:
        encoded = content.encode("utf-8")
        loaded, truncated = cls._bounded_index(encoded)
        return {
            "loaded_lines": len(loaded.splitlines()),
            "total_lines": len(content.splitlines()),
            "loaded_bytes": len(loaded.encode("utf-8")),
            "total_bytes": len(encoded),
            "truncated": truncated,
        }

    @staticmethod
    def _bounded_index(raw: bytes) -> tuple[str, bool]:
        bytes_truncated = len(raw) > INDEX_MAX_BYTES
        prefix = raw[:INDEX_MAX_BYTES]
        while prefix:
            try:
                text = prefix.decode("utf-8")
                break
            except UnicodeDecodeError as error:
                if error.reason != "unexpected end of data" or error.end != len(prefix):
                    raise
                prefix = prefix[:-1]
        else:
            text = ""
        lines = text.splitlines(keepends=True)
        lines_truncated = len(lines) > INDEX_MAX_LINES
        return "".join(lines[:INDEX_MAX_LINES]), bytes_truncated or lines_truncated

    @staticmethod
    def _remove_empty_parents(path: Path, stop: Path) -> None:
        current = path
        while current != stop and current != current.parent:
            try:
                current.rmdir()
            except OSError:
                return
            current = current.parent

    @staticmethod
    def _remove_tree(path: Path) -> None:
        try:
            if path.is_symlink() or path.is_file():
                path.unlink()
            elif path.exists():
                shutil.rmtree(path)
        except OSError as error:
            raise RuntimeError("Agent Memory could not be deleted") from error
