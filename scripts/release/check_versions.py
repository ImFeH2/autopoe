from __future__ import annotations

import argparse
import json
import tomllib
from pathlib import Path
from typing import Any


class VersionMismatchError(RuntimeError):
    pass


def _toml(path: Path) -> dict[str, Any]:
    with path.open("rb") as source:
        return tomllib.load(source)


def validate_versions(root: Path) -> str:
    project_root = root.resolve()
    package_version = json.loads(
        (project_root / "package.json").read_text(encoding="utf8")
    )["version"]
    paths = {
        "backend/pyproject.toml": project_root / "backend" / "pyproject.toml",
        "native/flowent-native/Cargo.toml": project_root
        / "native"
        / "flowent-native"
        / "Cargo.toml",
        "native/flowent-sandbox-windows/Cargo.toml": project_root
        / "native"
        / "flowent-sandbox-windows"
        / "Cargo.toml",
    }
    versions = {
        label: _toml(path)["project" if label.startswith("backend/") else "package"][
            "version"
        ]
        for label, path in paths.items()
    }
    mismatches = [
        f"{label}={version}"
        for label, version in versions.items()
        if version != package_version
    ]
    backend = _toml(paths["backend/pyproject.toml"])["project"]
    native_requirements = [
        requirement
        for requirement in backend.get("dependencies", [])
        if requirement.split("==", 1)[0].strip().lower() == "flowent-native"
    ]
    expected_requirement = f"flowent-native=={package_version}"
    if native_requirements != [expected_requirement]:
        mismatches.append(
            "backend flowent-native dependency="
            + (", ".join(native_requirements) if native_requirements else "missing")
        )
    if mismatches:
        raise VersionMismatchError(
            f"Release versions must all match package.json={package_version}: "
            + "; ".join(mismatches)
        )
    return package_version


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path.cwd())
    args = parser.parse_args()
    print(validate_versions(args.root))


if __name__ == "__main__":
    main()
