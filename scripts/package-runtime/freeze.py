from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import sys
from pathlib import Path, PurePosixPath
from typing import Any


def _input_argument(option: str, source: Path, destination: str) -> list[str]:
    return [option, f"{source}{os.pathsep}{destination}"]


def _load_input(input_path: Path) -> dict[str, Any]:
    value = json.loads(input_path.read_text(encoding="utf8"))
    if (
        value.get("schemaVersion") != 2
        or value.get("bundleDirectory") != "flowent-runtime"
    ):
        raise ValueError("Unsupported PyInstaller runtime input.")
    return value


def _relative_path(root: Path, value: object, label: str) -> Path:
    if not isinstance(value, str) or not value or "\\" in value:
        raise ValueError(f"{label} must be a portable relative path.")
    relative = PurePosixPath(value)
    if relative.is_absolute() or ".." in relative.parts:
        raise ValueError(f"{label} must be a portable relative path.")
    resolved_root = root.resolve()
    path = resolved_root.joinpath(*relative.parts).resolve()
    try:
        path.relative_to(resolved_root)
    except ValueError as error:
        raise ValueError(f"{label} escapes its root.") from error
    return path


def install_runtime_executables(*, input_path: Path, output_dir: Path) -> None:
    runtime_input = _load_input(input_path.resolve())
    input_root = input_path.resolve().parent
    application_root = output_dir.resolve() / "flowent" / "_internal"
    if not application_root.is_dir():
        raise ValueError("Frozen application output is unavailable.")
    for entry in runtime_input.get("executableFiles", []):
        if not isinstance(entry, dict):
            raise ValueError("Executable runtime input is invalid.")
        source = _relative_path(
            input_root,
            entry.get("source"),
            "Executable runtime source",
        )
        destination = _relative_path(
            application_root,
            entry.get("destination"),
            "Executable runtime destination",
        )
        if not source.is_file():
            raise ValueError(f"Executable runtime source is unavailable: {source}")
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)
        if os.name != "nt":
            destination.chmod(0o755)


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

    arguments = create_arguments(
        project_root=options.project_root,
        input_path=options.input,
        output_dir=options.output,
        work_dir=options.work,
        spec_dir=options.spec,
    )
    run(arguments)
    install_runtime_executables(
        input_path=options.input,
        output_dir=options.output,
    )


if __name__ == "__main__":
    main()
