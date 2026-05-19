from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path


class PatchError(RuntimeError):
    pass


@dataclass(frozen=True)
class PatchChange:
    path: Path
    kind: str
    move_path: Path | None = None


def affected_paths(patch: str, cwd: Path) -> list[Path]:
    paths: list[Path] = []
    for line in patch.splitlines():
        if line.startswith(
            ("*** Add File: ", "*** Delete File: ", "*** Update File: ")
        ):
            paths.append((cwd / line.split(": ", 1)[1]).resolve(strict=False))
        elif line.startswith("*** Move to: "):
            paths.append(
                (cwd / line.removeprefix("*** Move to: ")).resolve(strict=False)
            )
    return paths


def parse_patch(patch: str, cwd: Path) -> list[dict[str, object]]:
    lines = patch.splitlines()
    if not lines or lines[0].strip() != "*** Begin Patch":
        raise PatchError("Patch must start with Begin Patch.")
    if lines[-1].strip() != "*** End Patch":
        raise PatchError("Patch must end with End Patch.")

    operations: list[dict[str, object]] = []
    index = 1
    while index < len(lines) - 1:
        line = lines[index]
        if line.startswith("*** Add File: "):
            target = (cwd / line.removeprefix("*** Add File: ")).resolve(strict=False)
            index += 1
            contents: list[str] = []
            while index < len(lines) - 1 and not lines[index].startswith("*** "):
                content_line = lines[index]
                if not content_line.startswith("+"):
                    raise PatchError("Add file lines must start with +.")
                contents.append(content_line[1:])
                index += 1
            operations.append(
                {"kind": "add", "path": target, "content": "\n".join(contents) + "\n"}
            )
            continue
        if line.startswith("*** Delete File: "):
            target = (cwd / line.removeprefix("*** Delete File: ")).resolve(
                strict=False
            )
            operations.append({"kind": "delete", "path": target})
            index += 1
            continue
        if line.startswith("*** Update File: "):
            target = (cwd / line.removeprefix("*** Update File: ")).resolve(
                strict=False
            )
            index += 1
            move_path = None
            if index < len(lines) - 1 and lines[index].startswith("*** Move to: "):
                move_path = (cwd / lines[index].removeprefix("*** Move to: ")).resolve(
                    strict=False
                )
                index += 1
            chunks: list[dict[str, list[str]]] = []
            current: dict[str, list[str]] | None = None
            while index < len(lines) - 1 and not lines[index].startswith("*** "):
                content_line = lines[index]
                if content_line.startswith("@@"):
                    current = {"remove": [], "add": []}
                    chunks.append(current)
                elif content_line.startswith("-"):
                    if current is None:
                        current = {"remove": [], "add": []}
                        chunks.append(current)
                    current["remove"].append(content_line[1:])
                elif content_line.startswith("+"):
                    if current is None:
                        current = {"remove": [], "add": []}
                        chunks.append(current)
                    current["add"].append(content_line[1:])
                elif content_line.startswith(" ") or content_line == "*** End of File":
                    pass
                else:
                    raise PatchError(
                        "Update lines must start with context, +, -, or @@."
                    )
                index += 1
            operations.append(
                {
                    "kind": "update",
                    "path": target,
                    "move_path": move_path,
                    "chunks": chunks,
                }
            )
            continue
        if not line.strip():
            index += 1
            continue
        raise PatchError(f"Invalid patch line: {line}")
    return operations


def apply_update(original: str, chunks: list[dict[str, list[str]]]) -> str:
    content = original
    for chunk in chunks:
        remove = "\n".join(chunk["remove"])
        add = "\n".join(chunk["add"])
        if remove:
            candidates = [remove, remove + "\n"]
            for candidate in candidates:
                if candidate in content:
                    replacement = add + (
                        "\n" if candidate.endswith("\n") and add else ""
                    )
                    content = content.replace(candidate, replacement, 1)
                    break
            else:
                raise PatchError("Patch context was not found.")
        elif add:
            content = (
                content
                + ("" if content.endswith("\n") or not content else "\n")
                + add
                + "\n"
            )
    return content


def apply_patch(patch: str, cwd: Path) -> dict[str, object]:
    operations = parse_patch(patch, cwd)
    changed: list[dict[str, str]] = []
    for operation in operations:
        kind = str(operation["kind"])
        path = operation["path"]
        if not isinstance(path, Path):
            raise PatchError("Patch path is invalid.")
        if kind == "add":
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(str(operation["content"]))
            changed.append({"path": str(path), "status": "added"})
        elif kind == "delete":
            path.unlink()
            changed.append({"path": str(path), "status": "deleted"})
        elif kind == "update":
            original = path.read_text()
            chunks = operation["chunks"]
            if not isinstance(chunks, list):
                raise PatchError("Patch chunks are invalid.")
            new_content = apply_update(original, chunks)
            move_path = operation.get("move_path")
            if isinstance(move_path, Path):
                move_path.parent.mkdir(parents=True, exist_ok=True)
                move_path.write_text(new_content)
                path.unlink()
                changed.append({"path": str(move_path), "status": "modified"})
            else:
                path.write_text(new_content)
                changed.append({"path": str(path), "status": "modified"})
    return {"files": changed}


def run_apply_patch_cli(*, cwd: Path, patch: str) -> int:
    try:
        result = apply_patch(patch, cwd.resolve(strict=False))
    except Exception as error:
        print(json.dumps({"error": str(error)}))
        return 1
    print(json.dumps(result))
    return 0
