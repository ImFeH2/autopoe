from __future__ import annotations

import os
import subprocess
import sys
import tarfile
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "start-wsl-backend.sh"
pytestmark = pytest.mark.skipif(
    sys.platform != "linux", reason="Linux backend component"
)


def launch(archive: Path, root: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["/bin/sh", str(SCRIPT), "bundled", str(archive)],
        env={
            **os.environ,
            "XDG_CACHE_HOME": str(root / "cache"),
            "HUDDOL_DATA_DIR": str(root / "data"),
        },
        capture_output=True,
        check=False,
        text=True,
        timeout=10,
    )


def test_component_is_deployed_once_and_runs_in_the_backend(tmp_path: Path) -> None:
    component = tmp_path / "huddol"
    component.write_text("#!/bin/sh\nprintf 'backend:%s\\n' \"$HUDDOL_DATA_DIR\"\n")
    archive = tmp_path / "backend component.tar"
    with tarfile.open(archive, "w") as bundle:
        bundle.add(component, arcname="huddol")
    for _ in range(2):
        result = launch(archive, tmp_path)
        assert result.returncode == 0, result.stderr
        assert result.stdout.strip() == f"backend:{tmp_path / 'data'}"
    cache = tmp_path / "cache/huddol/backends"
    assert len(list(cache.iterdir())) == 1
    assert not list(cache.glob(".stage-*"))


def test_invalid_component_does_not_leave_a_partial_deployment(tmp_path: Path) -> None:
    archive = tmp_path / "invalid.tar"
    archive.write_text("invalid archive")
    result = launch(archive, tmp_path)
    assert result.returncode != 0
    assert not list((tmp_path / "cache/huddol/backends").iterdir())
    assert not (tmp_path / "data").exists()
