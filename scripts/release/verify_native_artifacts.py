from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import tarfile
import tempfile
import zipfile
from email.parser import BytesParser
from pathlib import Path, PurePosixPath
from typing import Any


class ArtifactVerificationError(RuntimeError):
    pass


def _target(root: Path, target_id: str) -> dict[str, Any]:
    manifest = json.loads(
        (root / "scripts" / "runtime" / "targets.json").read_text(encoding="utf8")
    )
    try:
        return manifest["targets"][target_id]
    except KeyError as error:
        raise ArtifactVerificationError(
            f"Unknown release target: {target_id}"
        ) from error


def verify_application(application: Path, version: str) -> None:
    executable = str(application.resolve())
    result = subprocess.run(
        [executable, "--version"],
        check=True,
        capture_output=True,
        text=True,
        timeout=30,
    )
    if result.stdout.strip() != f"flowent {version}":
        raise ArtifactVerificationError(
            f"Frozen application reported an unexpected version: {result.stdout.strip()}"
        )
    code_marker = "FLOWENT_NATIVE_CODE_READY"
    code_result = subprocess.run(
        [executable, "_run-python"],
        check=True,
        capture_output=True,
        input=json.dumps(
            {
                "code": "output = input.upper()",
                "input": code_marker.lower(),
                "inputs": [],
            }
        ),
        text=True,
        timeout=30,
    )
    if code_result.stdout != code_marker:
        raise ArtifactVerificationError(
            "Frozen application could not run its built-in Python runtime."
        )
    with tempfile.TemporaryDirectory(prefix="flowent-artifact-patch-") as directory:
        patch_root = Path(directory)
        patch_result = subprocess.run(
            [executable, "apply-patch", "--cwd", str(patch_root)],
            check=True,
            capture_output=True,
            input=(
                "*** Begin Patch\n"
                "*** Add File: result.txt\n"
                "+frozen patch ready\n"
                "*** End Patch\n"
            ),
            text=True,
            timeout=30,
        )
        patched_file = patch_root / "result.txt"
        if (
            patch_result.returncode != 0
            or not patched_file.is_file()
            or patched_file.read_text(encoding="utf8") != "frozen patch ready\n"
        ):
            raise ArtifactVerificationError(
                "Frozen application could not run its built-in patch runtime."
            )


def verify_npm_package(directory: Path, target: dict[str, Any], version: str) -> Path:
    packages = sorted(directory.glob("*.tgz"))
    if len(packages) != 1:
        raise ArtifactVerificationError(
            f"Expected one npm package, found {len(packages)}."
        )
    bundle = f"package/vendor/{target['rustTarget']}"
    with tempfile.TemporaryDirectory(prefix="flowent-npm-artifact-") as directory:
        extracted = Path(directory)
        with tarfile.open(packages[0], "r:gz") as archive:
            package_member = archive.extractfile("package/package.json")
            if package_member is None:
                raise ArtifactVerificationError("npm package has no package.json.")
            package = json.load(package_member)
            resources_member = archive.extractfile(f"{bundle}/resources.json")
            if resources_member is None:
                raise ArtifactVerificationError(
                    "npm package has no runtime resource manifest."
                )
            resources = json.load(resources_member)
            if resources.get("target", {}).get("id") != target["id"]:
                raise ArtifactVerificationError(
                    "npm package runtime target does not match."
                )
            resource_entries = resources.get("resources")
            if not isinstance(resource_entries, dict) or sorted(
                resource_entries
            ) != sorted(target["requiredResources"]):
                raise ArtifactVerificationError(
                    "npm package runtime resources are incomplete."
                )
            for name, entry in resource_entries.items():
                if not isinstance(entry, dict):
                    raise ArtifactVerificationError(
                        f"npm package runtime resource {name} is invalid."
                    )
                relative = entry.get("path")
                path = PurePosixPath(relative) if isinstance(relative, str) else None
                if (
                    path is None
                    or path.is_absolute()
                    or not path.parts
                    or ".." in path.parts
                ):
                    raise ArtifactVerificationError(
                        f"npm package runtime resource {name} has an invalid path."
                    )
                resource_member = archive.extractfile(f"{bundle}/{path.as_posix()}")
                if resource_member is None:
                    raise ArtifactVerificationError(
                        f"npm package runtime resource {name} is missing."
                    )
                contents = resource_member.read()
                expected_size = entry.get("size")
                expected_digest = entry.get("sha256")
                if (
                    not isinstance(expected_size, int)
                    or isinstance(expected_size, bool)
                    or len(contents) != expected_size
                    or not isinstance(expected_digest, str)
                    or hashlib.sha256(contents).hexdigest() != expected_digest
                ):
                    raise ArtifactVerificationError(
                        f"npm package runtime resource {name} failed verification."
                    )
            application_path = f"{bundle}/flowent/flowent{target['executableSuffix']}"
            try:
                application_member = archive.getmember(application_path)
            except KeyError as error:
                raise ArtifactVerificationError(
                    "npm package has no frozen application."
                ) from error
            if not application_member.isfile():
                raise ArtifactVerificationError(
                    "npm package frozen application is not a file."
                )
            archive.extractall(extracted, filter="data")

        expected_version = f"{version}-{target['npm']['versionTag']}"
        if package.get("name") != target["npm"]["name"]:
            raise ArtifactVerificationError(
                "npm package name does not match the target."
            )
        if package.get("version") != expected_version:
            raise ArtifactVerificationError(
                "npm package version does not match the target."
            )
        if package.get("os") != [target["npm"]["os"]]:
            raise ArtifactVerificationError(
                "npm package operating system does not match."
            )
        if package.get("cpu") != [target["npm"]["cpu"]]:
            raise ArtifactVerificationError("npm package architecture does not match.")
        expected_libc = target["npm"].get("libc")
        if package.get("libc") != expected_libc:
            raise ArtifactVerificationError("npm package C library does not match.")
        verify_application(extracted / application_path, version)
    return packages[0]


def verify_python_wheel(
    directory: Path,
    target: dict[str, Any],
    version: str,
) -> Path:
    wheels = sorted(directory.glob("*.whl"))
    if len(wheels) != 1:
        raise ArtifactVerificationError(
            f"Expected one Python wheel, found {len(wheels)}."
        )
    expected_platform = target["python"]["wheelPlatform"].replace("-", "_")
    wheel_platforms = wheels[0].stem.rsplit("-", 1)[-1].split(".")
    if expected_platform not in wheel_platforms:
        raise ArtifactVerificationError(
            "Python wheel platform does not match the release target."
        )
    with zipfile.ZipFile(wheels[0]) as archive:
        metadata_paths = [
            name for name in archive.namelist() if name.endswith(".dist-info/METADATA")
        ]
        resource_paths = [
            name
            for name in archive.namelist()
            if name.endswith("flowent_native/runtime/resources.json")
        ]
        if len(metadata_paths) != 1 or len(resource_paths) != 1:
            raise ArtifactVerificationError(
                "Python wheel is missing package metadata or runtime resources."
            )
        metadata = BytesParser().parsebytes(archive.read(metadata_paths[0]))
        resources = json.loads(archive.read(resource_paths[0]))
    if metadata["Name"] != "flowent-native" or metadata["Version"] != version:
        raise ArtifactVerificationError(
            "Python wheel version does not match the release."
        )
    if resources.get("target", {}).get("id") != target["id"]:
        raise ArtifactVerificationError("Python wheel runtime target does not match.")
    if sorted(resources.get("resources", {})) != sorted(target["requiredResources"]):
        raise ArtifactVerificationError(
            "Python wheel runtime resources are incomplete."
        )
    return wheels[0]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--application", type=Path, required=True)
    parser.add_argument("--npm-dir", type=Path, required=True)
    parser.add_argument("--wheel-dir", type=Path, required=True)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    args = parser.parse_args()
    target = _target(args.root.resolve(), args.target)
    verify_application(args.application, args.version)
    verify_npm_package(args.npm_dir, target, args.version)
    verify_python_wheel(args.wheel_dir, target, args.version)


if __name__ == "__main__":
    main()
