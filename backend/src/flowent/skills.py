from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from flowent.llm import ChatMessage
from flowent.storage import StateStore, StoredSkill

PROJECT_SKILLS_DIRECTORY = Path(".flowent") / "skills"
SKILL_FILENAME = "SKILL.md"
SKILL_REFERENCE_PATTERN = re.compile(r"(?<!\w)\$([a-z0-9][a-z0-9-]*)\b")


@dataclass(frozen=True)
class SkillDocument:
    body: str
    skill: StoredSkill


def skill_slug(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "skill"


def skill_id(scope: str, path: Path) -> str:
    return f"{scope}:{path.resolve(strict=False)}"


def skill_directories(cwd: Path, store: StateStore) -> list[tuple[str, Path]]:
    return [
        ("project", cwd.resolve(strict=False) / PROJECT_SKILLS_DIRECTORY),
        ("user", store.directory / "skills"),
    ]


def parse_skill_frontmatter(content: str) -> tuple[dict[str, str], str]:
    if not content.startswith("---\n"):
        return {}, content

    end_index = content.find("\n---", 4)
    if end_index == -1:
        return {}, content

    metadata: dict[str, str] = {}
    for line in content[4:end_index].splitlines():
        key, separator, value = line.partition(":")
        if not separator:
            continue
        metadata[key.strip().lower()] = value.strip().strip("\"'")

    body_start = end_index + len("\n---")
    if content[body_start : body_start + 1] == "\n":
        body_start += 1
    return metadata, content[body_start:]


def load_skill_document(scope: str, path: Path, enabled: bool) -> SkillDocument:
    content = path.read_text(errors="replace")
    metadata, body = parse_skill_frontmatter(content)
    name = metadata.get("name", "").strip()
    description = metadata.get("description", "").strip()
    fallback_name = path.parent.name.replace("-", " ").strip().title() or "Skill"
    display_name = name or fallback_name
    error = "" if name and description else "Skill needs a name and description."
    slug = skill_slug(display_name)
    return SkillDocument(
        body=body.strip(),
        skill=StoredSkill(
            description=description,
            enabled=enabled,
            error=error,
            id=skill_id(scope, path),
            name=display_name,
            path=str(path.resolve(strict=False)),
            scope=scope,
            slug=slug,
        ),
    )


def discover_skill_documents(cwd: Path, store: StateStore) -> list[SkillDocument]:
    enabled_by_id = store.read_skill_enabled()
    documents: list[SkillDocument] = []
    for scope, directory in skill_directories(cwd, store):
        if not directory.is_dir():
            continue
        for path in sorted(directory.glob(f"*/{SKILL_FILENAME}")):
            resolved_id = skill_id(scope, path)
            documents.append(
                load_skill_document(
                    scope,
                    path,
                    enabled_by_id.get(resolved_id, True),
                )
            )
    return documents


def discover_skills(cwd: Path, store: StateStore) -> list[StoredSkill]:
    return [document.skill for document in discover_skill_documents(cwd, store)]


def referenced_skill_slugs(content: str) -> list[str]:
    slugs: list[str] = []
    for match in SKILL_REFERENCE_PATTERN.finditer(content):
        slug = match.group(1)
        if slug not in slugs:
            slugs.append(slug)
    return slugs


def explicit_skill_messages(
    cwd: Path,
    store: StateStore,
    content: str,
) -> list[ChatMessage]:
    requested_slugs = referenced_skill_slugs(content)
    if not requested_slugs:
        return []

    documents_by_slug = {
        document.skill.slug: document
        for document in discover_skill_documents(cwd, store)
        if document.skill.enabled and not document.skill.error
    }
    messages: list[ChatMessage] = []
    for slug in requested_slugs:
        document = documents_by_slug.get(slug)
        if document is None:
            continue
        messages.append(
            ChatMessage(
                role="user",
                content=(
                    f'<skill name="{document.skill.name}" slug="{document.skill.slug}">\n'
                    f"{document.body}\n"
                    "</skill>"
                ),
            )
        )
    return messages


def update_skill_enabled(
    cwd: Path,
    store: StateStore,
    skill_id_value: str,
    enabled: bool,
) -> StoredSkill:
    for skill in discover_skills(cwd, store):
        if skill.id == skill_id_value:
            store.save_skill_enabled(skill_id_value, enabled)
            return skill.model_copy(update={"enabled": enabled})
    raise KeyError(skill_id_value)
