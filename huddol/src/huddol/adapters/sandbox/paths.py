from __future__ import annotations

import os
from collections.abc import Sequence
from pathlib import Path

from huddol.core.errors import DomainError


def normalize_directories(
    values: Sequence[str], *, require_existing: bool = False
) -> tuple[Path, ...]:
    normalized: list[Path] = []
    seen: set[str] = set()
    for value in values:
        if not isinstance(value, str) or not value.strip():
            raise DomainError(
                "invalid_directory", "Writable directories must be non-empty strings"
            )
        candidate = Path(value).expanduser()
        if not candidate.is_absolute():
            raise DomainError(
                "invalid_directory", "Writable directories must be absolute paths"
            )
        try:
            resolved = candidate.resolve(strict=require_existing)
        except (OSError, RuntimeError, ValueError) as error:
            raise DomainError(
                "invalid_directory", f"Cannot resolve writable directory: {error}"
            ) from error
        if require_existing and not resolved.is_dir():
            raise DomainError(
                "invalid_directory", "Writable directories must be existing directories"
            )
        identity = os.path.normcase(str(resolved))
        if identity in seen:
            continue
        seen.add(identity)
        normalized.append(resolved)
    return tuple(normalized)


def is_within(path: Path, roots: Sequence[Path]) -> bool:
    return any(path == root or path.is_relative_to(root) for root in roots)


def bind_order(roots: Sequence[Path]) -> tuple[Path, ...]:
    return tuple(sorted(roots, key=lambda item: len(item.parts)))
