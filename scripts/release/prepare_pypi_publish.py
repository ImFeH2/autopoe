from __future__ import annotations

import argparse
import hashlib
import json
import urllib.error
import urllib.request
from collections.abc import Callable, Mapping
from pathlib import Path
from urllib.parse import quote


class PyPIArtifactError(RuntimeError):
    pass


def _artifact_project(path: Path, version: str) -> str:
    name = path.name
    if name == f"flowent-{version}.tar.gz" or (
        name.startswith(f"flowent-{version}-") and name.endswith(".whl")
    ):
        return "flowent"
    if name.startswith(f"flowent_native-{version}-") and name.endswith(".whl"):
        return "flowent-native"
    raise PyPIArtifactError(f"Unexpected artifact: {name}")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def pypi_release_files(project: str, version: str) -> dict[str, str]:
    url = f"https://pypi.org/pypi/{quote(project, safe='')}/json"
    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            payload = json.load(response)
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return {}
        raise PyPIArtifactError(
            f"Could not read PyPI metadata for {project}: HTTP {error.code}."
        ) from error
    except (OSError, ValueError) as error:
        raise PyPIArtifactError(
            f"Could not read PyPI metadata for {project}."
        ) from error

    releases = payload.get("releases")
    if not isinstance(releases, dict):
        raise PyPIArtifactError(f"PyPI returned invalid metadata for {project}.")
    release = releases.get(version, [])
    if not isinstance(release, list):
        raise PyPIArtifactError(
            f"PyPI returned invalid release metadata for {project} {version}."
        )

    files: dict[str, str] = {}
    for item in release:
        if not isinstance(item, dict):
            raise PyPIArtifactError(
                f"PyPI returned invalid file metadata for {project} {version}."
            )
        filename = item.get("filename")
        digests = item.get("digests")
        sha256 = digests.get("sha256") if isinstance(digests, dict) else None
        if not isinstance(filename, str) or not isinstance(sha256, str):
            raise PyPIArtifactError(
                f"PyPI returned incomplete file metadata for {project} {version}."
            )
        if filename in files and files[filename] != sha256:
            raise PyPIArtifactError(
                f"PyPI returned conflicting file metadata for {filename}."
            )
        files[filename] = sha256.lower()
    return files


def prepare_pypi_publish(
    directory: Path,
    version: str,
    remote_files: Callable[[str], Mapping[str, str]] | None = None,
) -> tuple[Path, ...]:
    artifacts = sorted(
        path
        for path in directory.iterdir()
        if path.is_file() and (path.suffix == ".whl" or path.name.endswith(".tar.gz"))
    )
    if not artifacts:
        raise PyPIArtifactError("No Python artifacts were found for publishing.")

    projects = {path: _artifact_project(path, version) for path in artifacts}
    fetch = remote_files or (lambda project: pypi_release_files(project, version))
    remote_by_project = {
        project: dict(fetch(project)) for project in set(projects.values())
    }
    matching: list[Path] = []

    for path, project in projects.items():
        remote_digest = remote_by_project[project].get(path.name)
        if remote_digest is None:
            continue
        local_digest = _sha256(path)
        if local_digest != remote_digest.lower():
            raise PyPIArtifactError(
                f"PyPI artifact {path.name} already exists but its SHA256 does not match."
            )
        matching.append(path)

    for path in matching:
        path.unlink()

    return tuple(path for path in artifacts if path not in matching)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--version", required=True)
    args = parser.parse_args()
    remaining = prepare_pypi_publish(args.directory, args.version)
    print(f"Python artifacts remaining for publish: {len(remaining)}")


if __name__ == "__main__":
    main()
