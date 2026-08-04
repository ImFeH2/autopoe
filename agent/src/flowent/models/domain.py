from __future__ import annotations

from dataclasses import dataclass


class ModelError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class ModelSelection:
    provider_id: str
    model_id: str

    def to_dict(self) -> dict[str, str]:
        return {
            "provider_id": self.provider_id,
            "model_id": self.model_id,
        }
