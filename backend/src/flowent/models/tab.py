from __future__ import annotations

import time
from dataclasses import dataclass, field

from flowent.models.graph import WorkflowDefinition


@dataclass
class Tab:
    id: str
    title: str
    leader_id: str | None = None
    definition: WorkflowDefinition = field(default_factory=WorkflowDefinition)
    allow_network: bool = False
    write_dirs: list[str] = field(default_factory=list)
    permissions_initialized: bool = False
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    def serialize(self) -> dict[str, object]:
        return {
            "id": self.id,
            "title": self.title,
            "leader_id": self.leader_id,
            "definition": self.definition.serialize(),
            "allow_network": self.allow_network,
            "write_dirs": list(self.write_dirs),
            "permissions_initialized": self.permissions_initialized,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }

    @classmethod
    def from_mapping(cls, data: dict[str, object]) -> Tab:
        from flowent.settings import build_assistant_write_dirs

        created_at = data.get("created_at")
        updated_at = data.get("updated_at")
        raw_definition = data.get("definition")
        raw_permissions_initialized = data.get("permissions_initialized")
        raw_write_dirs_value = data.get("write_dirs")
        raw_write_dirs = (
            [item for item in raw_write_dirs_value if isinstance(item, str)]
            if isinstance(raw_write_dirs_value, list)
            else []
        )
        try:
            write_dirs = build_assistant_write_dirs(
                raw_write_dirs,
                field_name="write_dirs",
            )
        except ValueError:
            write_dirs = []
        return cls(
            id=str(data.get("id", "")),
            title=str(data.get("title", "")),
            leader_id=str(data["leader_id"])
            if isinstance(data.get("leader_id"), str)
            else None,
            definition=WorkflowDefinition.from_mapping(
                raw_definition if isinstance(raw_definition, dict) else None
            ),
            allow_network=bool(data.get("allow_network", False)),
            write_dirs=write_dirs,
            permissions_initialized=(
                bool(raw_permissions_initialized)
                or "allow_network" in data
                or "write_dirs" in data
            ),
            created_at=created_at
            if isinstance(created_at, (int, float))
            else time.time(),
            updated_at=updated_at
            if isinstance(updated_at, (int, float))
            else time.time(),
        )
