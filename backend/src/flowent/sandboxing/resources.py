from __future__ import annotations

import importlib
import os
import shutil
from collections.abc import Callable
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path


class ResourceSource(StrEnum):
    SYSTEM = "system"
    BUNDLED = "bundled"


@dataclass(frozen=True)
class ResolvedExecutable:
    path: Path
    source: ResourceSource


class ResourceResolutionError(RuntimeError):
    pass


BundledProvider = Callable[[], Path | None]
WhichExecutable = Callable[[str], str | None]


class ExecutableResolver:
    def __init__(
        self,
        *,
        system_names: tuple[str, ...],
        bundled_provider: BundledProvider,
        which: WhichExecutable = shutil.which,
    ) -> None:
        self.system_names = system_names
        self.bundled_provider = bundled_provider
        self.which = which

    def resolve(self) -> ResolvedExecutable | None:
        candidates = self._system_candidates()
        if candidates:
            return candidates[0]
        return self._bundled_candidate(())

    def resolve_candidates(self) -> tuple[ResolvedExecutable, ...]:
        candidates = list(self._system_candidates())
        bundled = self._bundled_candidate(tuple(candidates))
        if bundled is not None and all(
            candidate.path != bundled.path for candidate in candidates
        ):
            candidates.append(bundled)
        return tuple(candidates)

    def _system_candidates(self) -> tuple[ResolvedExecutable, ...]:
        candidates: list[ResolvedExecutable] = []
        for name in self.system_names:
            raw_path = self.which(name)
            if raw_path is None:
                continue
            path = Path(raw_path).expanduser().resolve(strict=False)
            if (
                path.is_file()
                and os.access(path, os.X_OK)
                and all(candidate.path != path for candidate in candidates)
            ):
                candidates.append(
                    ResolvedExecutable(path=path, source=ResourceSource.SYSTEM)
                )
        return tuple(candidates)

    def _bundled_candidate(
        self,
        existing: tuple[ResolvedExecutable, ...],
    ) -> ResolvedExecutable | None:
        try:
            bundled_path = self.bundled_provider()
        except ResourceResolutionError:
            if existing:
                return None
            raise
        except Exception as error:
            if existing:
                return None
            raise ResourceResolutionError(
                "Bundled executable could not be resolved."
            ) from error
        if bundled_path is None:
            return None
        resolved = bundled_path.expanduser().resolve(strict=False)
        if not resolved.is_file() or not os.access(resolved, os.X_OK):
            if existing:
                return None
            raise ResourceResolutionError("Bundled executable is not executable.")
        return ResolvedExecutable(path=resolved, source=ResourceSource.BUNDLED)


def native_resource_path(name: str) -> Path | None:
    try:
        module = importlib.import_module("flowent_native")
    except ModuleNotFoundError as error:
        if error.name == "flowent_native":
            return None
        raise ResourceResolutionError(
            "Bundled resource package could not be loaded."
        ) from error
    resource_path = getattr(module, "resource_path", None)
    if not callable(resource_path):
        raise ResourceResolutionError(
            "Bundled resource package does not expose resource_path."
        )
    try:
        return Path(resource_path(name))
    except Exception as error:
        raise ResourceResolutionError(
            f"Bundled resource {name!r} could not be loaded."
        ) from error


def default_bwrap_resolver() -> ExecutableResolver:
    return ExecutableResolver(
        system_names=("/usr/bin/bwrap", "/bin/bwrap"),
        bundled_provider=lambda: native_resource_path("bubblewrap"),
    )
