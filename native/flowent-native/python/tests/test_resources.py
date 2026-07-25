import hashlib
import json
import os
import platform
import sys
from pathlib import Path

import pytest

import flowent_native
from flowent_native import resources


def current_target_id() -> str:
    return flowent_native.target_id(sys.platform, platform.machine())


def write_bundle(root: Path, content: bytes = b"fixture executable") -> Path:
    binary = root / "bin" / "rg"
    binary.parent.mkdir(parents=True)
    binary.write_bytes(content)
    binary.chmod(0o755)
    manifest = {
        "schemaVersion": 1,
        "target": {"id": current_target_id()},
        "resources": {
            "ripgrep": {
                "path": "bin/rg",
                "executable": True,
                "size": len(content),
                "sha256": hashlib.sha256(content).hexdigest(),
            }
        },
    }
    (root / "resources.json").write_text(json.dumps(manifest), encoding="utf8")
    return binary


def test_target_id_maps_supported_platforms_and_architectures() -> None:
    assert flowent_native.target_id("linux", "x86_64") == "linux-x64"
    assert flowent_native.target_id("linux", "aarch64") == "linux-arm64"
    assert flowent_native.target_id("darwin", "arm64") == "darwin-arm64"
    assert flowent_native.target_id("win32", "AMD64") == "win32-x64"


def test_target_id_rejects_unsupported_platforms() -> None:
    with pytest.raises(
        flowent_native.NativeResourceError, match="Unsupported platform"
    ):
        flowent_native.target_id("freebsd", "x86_64")


def test_resource_path_locates_and_verifies_current_platform_resource(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    binary = write_bundle(tmp_path)
    monkeypatch.setattr(resources, "_default_runtime_root", lambda: tmp_path)

    assert flowent_native.resource_path("ripgrep") == binary.resolve()
    assert os.access(binary, os.X_OK)


def test_resource_path_rejects_corrupted_resources(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    binary = write_bundle(tmp_path)
    binary.write_bytes(b"corrupt executable")
    monkeypatch.setattr(resources, "_default_runtime_root", lambda: tmp_path)

    with pytest.raises(flowent_native.NativeResourceError, match="SHA256 mismatch"):
        flowent_native.resource_path("ripgrep")


def test_resource_path_rejects_paths_outside_runtime_bundle(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    outside = tmp_path.parent / "outside"
    outside.write_bytes(b"outside")
    manifest = {
        "schemaVersion": 1,
        "target": {"id": current_target_id()},
        "resources": {
            "ripgrep": {
                "path": "../outside",
                "executable": True,
                "size": 7,
                "sha256": hashlib.sha256(b"outside").hexdigest(),
            }
        },
    }
    (tmp_path / "resources.json").write_text(json.dumps(manifest), encoding="utf8")
    monkeypatch.setattr(resources, "_default_runtime_root", lambda: tmp_path)

    with pytest.raises(
        flowent_native.NativeResourceError, match="escapes runtime bundle"
    ):
        flowent_native.resource_path("ripgrep")


def test_pyinstaller_runtime_root_uses_meipass(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(sys, "_MEIPASS", str(tmp_path), raising=False)

    assert resources._default_runtime_root() == tmp_path / "flowent-runtime"
