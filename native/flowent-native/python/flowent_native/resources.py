import hashlib
import json
import os
import platform
import re
import sys
from pathlib import Path
from typing import Any


class NativeResourceError(RuntimeError):
    pass


_SHA256_PATTERN = re.compile(r"^[a-f0-9]{64}$")
_MACHINE_ALIASES = {
    "aarch64": "arm64",
    "amd64": "x64",
    "arm64": "arm64",
    "x86_64": "x64",
}
_PLATFORMS = {"darwin", "linux", "win32"}


def target_id(platform_name: str, machine: str) -> str:
    normalized_platform = platform_name.lower()
    normalized_machine = _MACHINE_ALIASES.get(machine.lower())
    if normalized_platform not in _PLATFORMS or normalized_machine is None:
        raise NativeResourceError(f"Unsupported platform: {platform_name} {machine}")
    return f"{normalized_platform}-{normalized_machine}"


def _current_target_id() -> str:
    return target_id(sys.platform, platform.machine())


def _default_runtime_root() -> Path:
    frozen_root = getattr(sys, "_MEIPASS", None)
    if frozen_root is not None:
        return Path(frozen_root) / "flowent-runtime"
    return Path(__file__).resolve().parent / "runtime"


def _load_manifest(root: Path) -> dict[str, Any]:
    manifest_path = root / "resources.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise NativeResourceError(
            f"Native resource manifest could not be read: {manifest_path}"
        ) from error
    if manifest.get("schemaVersion") != 1:
        raise NativeResourceError("Unsupported native resource manifest")
    target = manifest.get("target")
    if not isinstance(target, dict) or target.get("id") != _current_target_id():
        raise NativeResourceError("Native resources do not match the current platform")
    resources = manifest.get("resources")
    if not isinstance(resources, dict):
        raise NativeResourceError("Native resource manifest has no resources")
    return manifest


def resource_manifest() -> dict[str, Any]:
    return _load_manifest(_default_runtime_root())


def available_resources() -> tuple[str, ...]:
    return tuple(sorted(resource_manifest()["resources"]))


def _digest(path: Path) -> tuple[int, str]:
    size = 0
    digest = hashlib.sha256()
    try:
        with path.open("rb") as resource:
            while chunk := resource.read(1024 * 1024):
                size += len(chunk)
                digest.update(chunk)
    except OSError as error:
        raise NativeResourceError(
            f"Native resource could not be read: {path}"
        ) from error
    return size, digest.hexdigest()


def resource_path(name: str) -> Path:
    root = _default_runtime_root().resolve()
    manifest = _load_manifest(root)
    resource = manifest["resources"].get(name)
    if not isinstance(resource, dict):
        raise NativeResourceError(f"Native resource is not available: {name}")
    relative_path = resource.get("path")
    if not isinstance(relative_path, str) or not relative_path:
        raise NativeResourceError(f"Native resource has an invalid path: {name}")
    try:
        path = (root / relative_path).resolve(strict=True)
        path.relative_to(root)
    except (OSError, ValueError) as error:
        raise NativeResourceError(
            f"Native resource escapes runtime bundle: {name}"
        ) from error
    if not path.is_file():
        raise NativeResourceError(f"Native resource is not a file: {name}")
    expected_size = resource.get("size")
    expected_sha256 = resource.get("sha256")
    if (
        not isinstance(expected_size, int)
        or expected_size < 0
        or not isinstance(expected_sha256, str)
        or _SHA256_PATTERN.fullmatch(expected_sha256) is None
    ):
        raise NativeResourceError(f"Native resource checksum is invalid: {name}")
    actual_size, actual_sha256 = _digest(path)
    if actual_size != expected_size:
        raise NativeResourceError(
            f"Native resource size mismatch for {name}: expected {expected_size}, got {actual_size}"
        )
    if actual_sha256 != expected_sha256:
        raise NativeResourceError(
            f"Native resource SHA256 mismatch for {name}: expected {expected_sha256}, got {actual_sha256}"
        )
    if (
        resource.get("executable") is True
        and os.name != "nt"
        and not os.access(path, os.X_OK)
    ):
        raise NativeResourceError(f"Native resource is not executable: {name}")
    return path
