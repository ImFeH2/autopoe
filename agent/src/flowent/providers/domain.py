from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class ProviderError(ValueError):
    pass


class ProviderType(StrEnum):
    OPENAI = "openai"
    OPENAI_COMPATIBLE = "openai-compatible"
    ANTHROPIC = "anthropic"
    GOOGLE = "google"


@dataclass(frozen=True, slots=True)
class Provider:
    id: str
    name: str
    type: ProviderType
    base_url: str

    def to_dict(self) -> dict[str, str]:
        return {
            "id": self.id,
            "name": self.name,
            "type": self.type.value,
            "base_url": self.base_url,
        }


@dataclass(frozen=True, slots=True)
class ProviderModel:
    id: str
    name: str

    def to_dict(self) -> dict[str, str]:
        return {"id": self.id, "name": self.name}
