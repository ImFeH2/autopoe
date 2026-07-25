from __future__ import annotations

import importlib
import os
import shutil
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from types import ModuleType


class SystemToolState(StrEnum):
    AVAILABLE = "available"
    MISSING = "missing"
    INVALID = "invalid"


@dataclass(frozen=True)
class SystemToolStatus:
    state: SystemToolState
    executable: Path | None = None
    source: str | None = None

    @property
    def available(self) -> bool:
        return self.state is SystemToolState.AVAILABLE


class RuntimeFilesState(StrEnum):
    AVAILABLE = "available"
    DEVELOPMENT = "development"
    MISSING = "missing"
    INVALID = "invalid"


@dataclass(frozen=True)
class RuntimeFilesStatus:
    state: RuntimeFilesState
    source: str
    resource_count: int = 0

    @property
    def available(self) -> bool:
        return self.state in {
            RuntimeFilesState.AVAILABLE,
            RuntimeFilesState.DEVELOPMENT,
        }


class SystemToolError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        status: SystemToolStatus | RuntimeFilesStatus | None = None,
    ) -> None:
        self.status = status
        super().__init__(message)


RIPGREP_INSTALL_HINT = "Run 'flowent doctor' for details."
SYSTEM_RUNTIME_ENV_VAR = "FLOWENT_SYSTEM_RUNTIME"
_CONTAINER_RUNTIME_TOOLS = ("bwrap", "rg")


def _native_runtime_module() -> ModuleType | None:
    try:
        return importlib.import_module("flowent_native")
    except ModuleNotFoundError as error:
        if error.name == "flowent_native":
            return None
        raise


def _is_source_development() -> bool:
    repository_root = Path(__file__).resolve().parents[3]
    return (repository_root / "backend" / "pyproject.toml").is_file() and (
        repository_root / "native" / "flowent-native"
    ).is_dir()


def _uses_container_runtime() -> bool:
    return os.environ.get(SYSTEM_RUNTIME_ENV_VAR) == "1"


def _system_executable(name: str) -> Path | None:
    raw_path = shutil.which(name)
    if raw_path is None:
        return None
    path = Path(raw_path).expanduser().resolve(strict=False)
    if not path.is_file() or not os.access(path, os.X_OK):
        return None
    return path


def _built_in_resource(module: ModuleType, name: str) -> Path:
    resource_path = getattr(module, "resource_path", None)
    if not callable(resource_path):
        raise RuntimeError("Built-in runtime files cannot be resolved.")
    path = Path(resource_path(name)).expanduser().resolve(strict=False)
    if not path.is_file() or (os.name != "nt" and not os.access(path, os.X_OK)):
        raise RuntimeError("Built-in runtime file is not executable.")
    return path


def ripgrep_status() -> SystemToolStatus:
    development = _is_source_development()
    if development:
        system_executable = _system_executable("rg")
        if system_executable is None:
            return SystemToolStatus(state=SystemToolState.MISSING)
        return SystemToolStatus(
            state=SystemToolState.AVAILABLE,
            executable=system_executable,
            source="system",
        )
    try:
        native_runtime = _native_runtime_module()
    except Exception:
        return SystemToolStatus(
            state=SystemToolState.INVALID,
            source="built-in",
        )
    if native_runtime is not None:
        try:
            executable = _built_in_resource(native_runtime, "ripgrep")
        except Exception:
            return SystemToolStatus(
                state=SystemToolState.INVALID,
                source="built-in",
            )
        return SystemToolStatus(
            state=SystemToolState.AVAILABLE,
            executable=executable,
            source="built-in",
        )
    container = _uses_container_runtime()
    if not container:
        return SystemToolStatus(
            state=SystemToolState.MISSING,
            source="built-in",
        )
    system_executable = _system_executable("rg")
    if system_executable is None:
        return SystemToolStatus(
            state=SystemToolState.MISSING,
            source="system" if container else None,
        )
    return SystemToolStatus(
        state=SystemToolState.AVAILABLE,
        executable=system_executable,
        source="system",
    )


def ripgrep_binary() -> str | None:
    status = ripgrep_status()
    if status.available and status.executable is not None:
        return str(status.executable)
    if status.state is SystemToolState.INVALID:
        raise SystemToolError(
            "File search is not available because a built-in file failed verification.",
            status=status,
        )
    return None


def ensure_ripgrep_available() -> str:
    rg = ripgrep_binary()
    if rg is None:
        status = SystemToolStatus(state=SystemToolState.MISSING)
        raise SystemToolError(
            f"File search is not available. {RIPGREP_INSTALL_HINT}",
            status=status,
        )
    return rg


def runtime_files_status() -> RuntimeFilesStatus:
    if _is_source_development():
        return RuntimeFilesStatus(
            state=RuntimeFilesState.DEVELOPMENT,
            source="system",
        )
    try:
        native_runtime = _native_runtime_module()
    except Exception:
        return RuntimeFilesStatus(
            state=RuntimeFilesState.INVALID,
            source="built-in",
        )
    if native_runtime is None:
        if _uses_container_runtime():
            container_resources = tuple(
                _system_executable(name) for name in _CONTAINER_RUNTIME_TOOLS
            )
            if any(resource is None for resource in container_resources):
                return RuntimeFilesStatus(
                    state=RuntimeFilesState.MISSING,
                    source="container",
                )
            return RuntimeFilesStatus(
                state=RuntimeFilesState.AVAILABLE,
                source="container",
                resource_count=len(container_resources),
            )
        return RuntimeFilesStatus(
            state=RuntimeFilesState.MISSING,
            source="built-in",
        )
    available_resources = getattr(native_runtime, "available_resources", None)
    if not callable(available_resources):
        return RuntimeFilesStatus(
            state=RuntimeFilesState.INVALID,
            source="built-in",
        )
    try:
        resource_names = tuple(available_resources())
        if not resource_names or not all(
            isinstance(name, str) for name in resource_names
        ):
            raise RuntimeError("Built-in runtime files are incomplete.")
        for name in resource_names:
            _built_in_resource(native_runtime, name)
    except Exception:
        return RuntimeFilesStatus(
            state=RuntimeFilesState.INVALID,
            source="built-in",
        )
    return RuntimeFilesStatus(
        state=RuntimeFilesState.AVAILABLE,
        source="built-in",
        resource_count=len(resource_names),
    )
