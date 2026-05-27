import os
from pathlib import Path

DEFAULT_DATA_DIR = Path.home() / ".flowent"
WORKDIR_ENV_VAR = "FLOWENT_WORKDIR"


def data_directory() -> Path:
    configured_directory = os.environ.get("FLOWENT_DATA_DIR")
    if configured_directory:
        return Path(configured_directory).expanduser()
    return DEFAULT_DATA_DIR


def resolve_workdir(workdir: Path | str | None = None) -> Path:
    raw_workdir = workdir if workdir is not None else os.environ.get(WORKDIR_ENV_VAR)
    path = Path(raw_workdir).expanduser() if raw_workdir else Path.cwd()
    resolved = path.resolve(strict=False)
    if not resolved.exists():
        raise ValueError(f"Workdir does not exist: {resolved}")
    if not resolved.is_dir():
        raise ValueError(f"Workdir is not a directory: {resolved}")
    return resolved
