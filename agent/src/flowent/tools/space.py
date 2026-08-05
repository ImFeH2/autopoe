from pathlib import Path
from typing import Literal

from pydantic_ai import ToolFailed

Space = Literal["workspace", "home"]


class SpacePaths:
    def __init__(self, workspace: Path, home: Path):
        self.roots = {
            "workspace": workspace.resolve(),
            "home": home.resolve(),
        }

    def root(self, space: Space) -> Path:
        try:
            return self.roots[space]
        except KeyError as error:
            raise ToolFailed("space must be workspace or home") from error

    def resolve(self, space: Space, path: str) -> Path:
        root = self.root(space)
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

    def display(self, space: Space, path: Path) -> str:
        root = self.root(space)
        try:
            relative = path.relative_to(root)
        except ValueError:
            relative = path.resolve().relative_to(root)
        value = relative.as_posix()
        return value or "."
