from __future__ import annotations

import time
from dataclasses import dataclass, field

from flowent.models.graph import WorkflowActivationState, WorkflowDefinition


@dataclass
class Tab:
    id: str
    title: str
    leader_id: str | None = None
    definition: WorkflowDefinition = field(default_factory=WorkflowDefinition)
    activation_state: WorkflowActivationState = WorkflowActivationState.INACTIVE
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    def serialize(self) -> dict[str, object]:
        return {
            "id": self.id,
            "title": self.title,
            "leader_id": self.leader_id,
            "definition": self.definition.serialize(),
            "activation_state": self.activation_state.value,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }

    @classmethod
    def from_mapping(cls, data: dict[str, object]) -> Tab:
        created_at = data.get("created_at")
        updated_at = data.get("updated_at")
        raw_definition = data.get("definition")
        raw_activation_state = data.get("activation_state")
        try:
            activation_state = WorkflowActivationState(str(raw_activation_state))
        except ValueError:
            activation_state = WorkflowActivationState.INACTIVE
        return cls(
            id=str(data.get("id", "")),
            title=str(data.get("title", "")),
            leader_id=str(data["leader_id"])
            if isinstance(data.get("leader_id"), str)
            else None,
            definition=WorkflowDefinition.from_mapping(
                raw_definition if isinstance(raw_definition, dict) else None
            ),
            activation_state=activation_state,
            created_at=created_at
            if isinstance(created_at, (int, float))
            else time.time(),
            updated_at=updated_at
            if isinstance(updated_at, (int, float))
            else time.time(),
        )
