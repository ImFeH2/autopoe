from __future__ import annotations

import argparse
import json
import os
import platform
import sys
from pathlib import Path
from typing import Any


def _input_argument(option: str, source: Path, destination: str) -> list[str]:
    return [option, f"{source}{os.pathsep}{destination}"]


def _load_input(input_path: Path) -> dict[str, Any]:
    value = json.loads(input_path.read_text(encoding="utf8"))
    if (
        value.get("schemaVersion") != 1
        or value.get("bundleDirectory") != "flowent-runtime"
    ):
        raise ValueError("Unsupported PyInstaller runtime input.")
    return value


def validate_target(target: str) -> None:
    architectures = {
        "aarch64": "arm64",
        "amd64": "x64",
        "arm64": "arm64",
        "x86_64": "x64",
    }
    architecture = architectures.get(platform.machine().lower())
    current_target = f"{sys.platform}-{architecture}"
    if target != current_target:
        expected_platform, expected_architecture = target.split("-", 1)
        raise ValueError(
            f"{target} must be built on {expected_platform} {expected_architecture}."
        )


def create_arguments(
    *,
    project_root: Path,
    input_path: Path,
    output_dir: Path,
    work_dir: Path,
    spec_dir: Path,
) -> list[str]:
    root = project_root.resolve()
    runtime_input = _load_input(input_path.resolve())
    validate_target(runtime_input["target"])
    input_root = input_path.resolve().parent
    arguments = [
        "--noconfirm",
        "--clean",
        "--onedir",
        "--noupx",
        "--console",
        "--name",
        "flowent",
        "--contents-directory",
        "_internal",
        "--distpath",
        str(output_dir.resolve()),
        "--workpath",
        str(work_dir.resolve()),
        "--specpath",
        str(spec_dir.resolve()),
        "--paths",
        str(root / "backend" / "src"),
        "--paths",
        str(root / "native" / "flowent-native" / "python"),
        "--hidden-import",
        "flowent_native",
        "--copy-metadata",
        "flowent",
        "--exclude-module",
        "_pytest",
        "--exclude-module",
        "mypy",
        "--exclude-module",
        "pytest",
        "--collect-submodules",
        "flowent",
    ]
    arguments.extend(
        _input_argument(
            "--add-data",
            root / "backend" / "src" / "flowent" / "static",
            "flowent/static",
        )
    )
    for entry in runtime_input.get("binaries", []):
        arguments.extend(
            _input_argument(
                "--add-binary",
                input_root / entry["source"],
                entry["destination"],
            )
        )
    for entry in runtime_input.get("data", []):
        arguments.extend(
            _input_argument(
                "--add-data",
                input_root / entry["source"],
                entry["destination"],
            )
        )
    arguments.append(str(root / "scripts" / "package-runtime" / "entrypoint.py"))
    return arguments


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-root", type=Path, required=True)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--work", type=Path, required=True)
    parser.add_argument("--spec", type=Path, required=True)
    return parser.parse_args()


def main() -> None:
    options = parse_args()
    from PyInstaller.__main__ import run

    run(
        create_arguments(
            project_root=options.project_root,
            input_path=options.input,
            output_dir=options.output,
            work_dir=options.work,
            spec_dir=options.spec,
        )
    )


if __name__ == "__main__":
    main()
