import os
import stat
import tempfile
from pathlib import Path

import pytest

_test_environment = Path(tempfile.mkdtemp(prefix="flowent-tests-"))
_test_bin = _test_environment / "bin"
_test_bin.mkdir(parents=True, exist_ok=True)
_test_bwrap = _test_bin / "bwrap"
_test_bwrap.write_text("#!/bin/sh\nexit 0\n")
_test_bwrap.chmod(_test_bwrap.stat().st_mode | stat.S_IXUSR)

os.environ.setdefault("FLOWENT_DATA_DIR", str(_test_environment / "data"))
os.environ["PATH"] = f"{_test_bin}{os.pathsep}{os.environ.get('PATH', '')}"


@pytest.fixture(autouse=True)
def sandbox_available(monkeypatch):
    monkeypatch.setattr("flowent.sandbox.sandbox_binary", lambda: "/usr/bin/bwrap")
