import os
from pathlib import Path

DEFAULT_DATA_DIR = Path.home() / ".flowent"


def data_directory() -> Path:
    configured_directory = os.environ.get("FLOWENT_DATA_DIR")
    if configured_directory:
        return Path(configured_directory).expanduser()
    return DEFAULT_DATA_DIR
