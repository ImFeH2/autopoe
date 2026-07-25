from __future__ import annotations

import argparse
import re
import subprocess
from collections.abc import Iterable
from pathlib import Path


STABLE_TAG = re.compile(r"^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")


def _version(tag: str) -> tuple[int, int, int] | None:
    match = STABLE_TAG.fullmatch(tag)
    if match is None:
        return None
    return tuple(int(part) for part in match.groups())


def should_update_latest(release_tag: str, tags: Iterable[str]) -> bool:
    available = tuple(tags)
    release_version = _version(release_tag)
    if release_version is None or release_tag not in available:
        return False
    stable_versions = tuple(
        version for tag in available if (version := _version(tag)) is not None
    )
    return bool(stable_versions) and release_version == max(stable_versions)


def repository_tags(root: Path) -> tuple[str, ...]:
    result = subprocess.run(
        ["git", "tag", "--list"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    )
    return tuple(line for line in result.stdout.splitlines() if line)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--release-tag", required=True)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    args = parser.parse_args()
    update = should_update_latest(args.release_tag, repository_tags(args.root))
    print("true" if update else "false")


if __name__ == "__main__":
    main()
