from typing import Any


def without_delivery(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: without_delivery(item)
            for key, item in value.items()
            if key not in {"delivery", "activity_frontiers"}
        }
    if isinstance(value, list):
        return [without_delivery(item) for item in value]
    return value
