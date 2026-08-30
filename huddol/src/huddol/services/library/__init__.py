from __future__ import annotations

from dataclasses import dataclass

from huddol.ports.files import FileTree, TreeEntry


@dataclass(frozen=True)
class Document:
    path: str
    content: str
    content_hash: str


class Library:
    def __init__(self, tree: FileTree) -> None:
        self._tree = tree

    def list(self, path: str | None = None) -> tuple[TreeEntry, ...]:
        return self._tree.list(path)

    def read(self, path: str) -> Document:
        content, digest = self._tree.read(path)
        return Document(path, content, digest)

    def write(
        self, path: str, content: str, *, expected_hash: str | None = None
    ) -> TreeEntry:
        return self._tree.write(path, content, expected_hash=expected_hash)

    def delete(self, path: str) -> None:
        self._tree.delete(path)

    def move(self, source: str, destination: str) -> TreeEntry:
        return self._tree.move(source, destination)
