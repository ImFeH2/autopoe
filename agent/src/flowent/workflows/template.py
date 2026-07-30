import json
import re
from typing import Any

VARIABLE_PATTERN = re.compile(r"{{\s*([A-Za-z0-9_.-]+)\s*}}")


class TemplateRenderer:
    def render(self, template: str, context: dict[str, Any]) -> str:
        matches = list(VARIABLE_PATTERN.finditer(template))
        if len(matches) == 1 and matches[0].span() == (0, len(template)):
            return self.to_text(self.resolve(matches[0].group(1), context))

        def replace(match: re.Match[str]) -> str:
            return self.to_text(self.resolve(match.group(1), context))

        return VARIABLE_PATTERN.sub(replace, template)

    @staticmethod
    def resolve(path: str, context: dict[str, Any]) -> Any:
        current: Any = context
        for segment in path.split("."):
            if isinstance(current, dict) and segment in current:
                current = current[segment]
            elif isinstance(current, list) and segment.isdigit():
                index = int(segment)
                if index >= len(current):
                    raise ValueError(f"Template path not found: {path}")
                current = current[index]
            else:
                raise ValueError(f"Template path not found: {path}")
        return current

    @staticmethod
    def to_text(value: Any) -> str:
        if isinstance(value, str):
            return value
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def evaluate_condition(condition: Any, context: dict[str, Any]) -> bool:
    actual = TemplateRenderer.resolve(condition.path, context)
    operator = condition.operator
    if operator == "truthy":
        return bool(actual)
    if operator == "falsy":
        return not actual
    if operator == "equals":
        return actual == condition.value
    if operator == "not_equals":
        return actual != condition.value
    if operator == "contains":
        return condition.value in actual
    if operator == "not_contains":
        return condition.value not in actual
    raise ValueError(f"Unknown condition operator: {operator}")
