from __future__ import annotations

import subprocess
import sys

import pytest


def test_sidecar_runs_until_stdin_closes() -> None:
    process = subprocess.Popen(
        [sys.executable, "-m", "flowent"],
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    try:
        with pytest.raises(subprocess.TimeoutExpired):
            process.wait(timeout=0.1)

        assert process.stdin is not None
        process.stdin.close()
        assert process.wait(timeout=5) == 0
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
