from __future__ import annotations

from huddol.core.errors import DomainError
from huddol.ports.files import FileTree, TreeEntry

INDEX = "MEMORY.md"


class Memory:
    def __init__(self, tree: FileTree) -> None:
        self._tree = tree

    def list(self) -> tuple[TreeEntry, ...]:
        return self._tree.list()

    def read(self, path: str) -> tuple[str, str]:
        return self._tree.read(path)

    def write(
        self, path: str, content: str, *, expected_hash: str | None = None
    ) -> TreeEntry:
        return self._tree.write(path, content, expected_hash=expected_hash)

    def delete(self, path: str) -> None:
        self._tree.delete(path)

    def index_context(self) -> str:
        entries = self._tree.list()
        if not entries:
            return ""
        try:
            content, _ = self._tree.read(INDEX)
        except DomainError:
            content = ""
        listing = "\n".join(f"- {item.path}" for item in entries)
        if content.strip():
            return f"Your memory index ({INDEX}):\n{content.strip()}\n\nFiles:\n{listing}"
        return f"Your memory files:\n{listing}"
