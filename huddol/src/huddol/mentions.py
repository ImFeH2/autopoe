from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass
from unicodedata import category

from huddol.member_names import (
    normalized_member_name_key,
    validate_mention_safe_name,
)


@dataclass(frozen=True)
class MentionName:
    member_id: int
    name: str


@dataclass(frozen=True)
class MentionNameIssue:
    code: str
    member_ids: tuple[int, ...]
    names: tuple[str, ...]
    normalized_name: str | None = None


@dataclass(frozen=True)
class MentionOccurrence:
    member_id: int
    start: int
    end: int


def normalized_mention_name(value: str) -> str:
    return normalized_member_name_key(value)


def validate_mention_name(value: str) -> str:
    return validate_mention_safe_name(value)


def mention_name_issues(names: Iterable[MentionName]) -> tuple[MentionNameIssue, ...]:
    items = tuple(names)
    issues: list[MentionNameIssue] = []
    valid_by_key: dict[str, list[MentionName]] = {}
    for item in items:
        try:
            valid_name = validate_mention_name(item.name)
        except ValueError:
            issues.append(
                MentionNameIssue(
                    code="invalid_name",
                    member_ids=(item.member_id,),
                    names=(item.name,),
                )
            )
            continue
        valid_by_key.setdefault(normalized_mention_name(valid_name), []).append(item)
    for normalized_name, matches in valid_by_key.items():
        if len(matches) > 1:
            issues.append(
                MentionNameIssue(
                    code="duplicate_name",
                    member_ids=tuple(item.member_id for item in matches),
                    names=tuple(item.name for item in matches),
                    normalized_name=normalized_name,
                )
            )
    return tuple(sorted(issues, key=lambda item: (item.member_ids, item.code)))


def mention_syntax_issues(
    agent_names: Iterable[MentionName],
    human_names: Iterable[MentionName] = (),
) -> tuple[MentionNameIssue, ...]:
    agents = tuple(agent_names)
    issues = list(mention_name_issues(agents))
    humans_by_key: dict[str, list[MentionName]] = {}
    for human in human_names:
        humans_by_key.setdefault(
            normalized_mention_name(human.name.strip()), []
        ).append(human)
    for agent in agents:
        try:
            valid_name = validate_mention_name(agent.name)
        except ValueError:
            continue
        conflicts = humans_by_key.get(normalized_mention_name(valid_name), [])
        if conflicts:
            issues.append(
                MentionNameIssue(
                    code="duplicate_name",
                    member_ids=(
                        agent.member_id,
                        *(item.member_id for item in conflicts),
                    ),
                    names=(agent.name, *(item.name for item in conflicts)),
                    normalized_name=normalized_mention_name(valid_name),
                )
            )
    return tuple(sorted(issues, key=lambda item: (item.member_ids, item.code)))


def find_mentions(
    body: str,
    names: Iterable[MentionName],
    *,
    excluded_member_ids: Iterable[int] = (),
) -> tuple[MentionOccurrence, ...]:
    excluded = frozenset(excluded_member_ids)
    items = tuple(item for item in names if item.member_id not in excluded)
    if mention_name_issues(items):
        return ()
    candidates = tuple(
        sorted(
            ((normalized_mention_name(item.name), item.member_id) for item in items),
            key=lambda item: (-len(item[0]), item[1]),
        )
    )
    ignored = _ignored_markdown_spans(body)
    occurrences: list[MentionOccurrence] = []
    for start, character in enumerate(body):
        if (
            character != "@"
            or _in_spans(start, ignored)
            or _looks_like_email(body, start)
        ):
            continue
        matches: list[tuple[int, int, int]] = []
        for normalized_name, member_id in candidates:
            end = _matching_end(body, start + 1, normalized_name)
            if end is None or _in_spans(end - 1, ignored):
                continue
            following = body[end] if end < len(body) else None
            if following is not None and _is_name_character(following):
                continue
            matches.append((end, len(normalized_name), member_id))
        if not matches:
            continue
        longest = max(length for _, length, _ in matches)
        for end, length, member_id in matches:
            if length == longest:
                occurrences.append(MentionOccurrence(member_id, start, end))
    return tuple(occurrences)


def _is_name_character(character: str) -> bool:
    return character in "-_" or category(character)[0] in {"L", "M", "N"}


def _matching_end(body: str, start: int, target: str) -> int | None:
    for end in range(start + 1, len(body) + 1):
        value = normalized_mention_name(body[start:end])
        if value == target:
            return end
        if len(value) > len(target):
            return None
        if len(value) == len(target) and (
            end == len(body) or category(body[end])[0] != "M"
        ):
            return None
    return None


def _looks_like_email(body: str, start: int) -> bool:
    left = start
    while left > 0 and re.fullmatch(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]", body[left - 1]):
        left -= 1
    if left == start:
        return False
    return re.match(r"[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+", body[start + 1 :]) is not None


def _in_spans(position: int, spans: tuple[tuple[int, int], ...]) -> bool:
    return any(start <= position < end for start, end in spans)


def _ignored_markdown_spans(body: str) -> tuple[tuple[int, int], ...]:
    code_spans = _code_spans(body)
    definition_spans, definitions = _reference_definitions(body, tuple(code_spans))
    link_spans = _link_spans(body, tuple(code_spans), definitions, definition_spans)
    url_spans = _url_spans(body, (*code_spans, *link_spans))
    return tuple(sorted((*code_spans, *definition_spans, *link_spans, *url_spans)))


def _code_spans(body: str) -> list[tuple[int, int]]:
    spans: list[tuple[int, int]] = []
    index = 0
    line_start = True
    while index < len(body):
        if line_start:
            indent = 0
            while (
                index + indent < len(body)
                and body[index + indent] == " "
                and indent < 4
            ):
                indent += 1
            fence_start = index + indent
            if body.startswith("```", fence_start) or body.startswith(
                "~~~", fence_start
            ):
                marker = body[fence_start]
                width = 0
                while (
                    fence_start + width < len(body)
                    and body[fence_start + width] == marker
                ):
                    width += 1
                line_end = body.find("\n", fence_start)
                search = len(body) if line_end < 0 else line_end + 1
                end = len(body)
                while search < len(body):
                    candidate = search
                    spaces = 0
                    while (
                        candidate < len(body) and body[candidate] == " " and spaces < 4
                    ):
                        candidate += 1
                        spaces += 1
                    count = 0
                    while (
                        candidate + count < len(body)
                        and body[candidate + count] == marker
                    ):
                        count += 1
                    close_end = body.find("\n", candidate + count)
                    suffix_end = len(body) if close_end < 0 else close_end
                    if count >= width and all(
                        char in " \t" for char in body[candidate + count : suffix_end]
                    ):
                        end = len(body) if close_end < 0 else close_end + 1
                        break
                    next_line = body.find("\n", search)
                    if next_line < 0:
                        break
                    search = next_line + 1
                spans.append((index, end))
                index = end
                line_start = True
                continue
        if body[index] == "`":
            width = 1
            while index + width < len(body) and body[index + width] == "`":
                width += 1
            close = body.find("`" * width, index + width)
            if close >= 0:
                spans.append((index, close + width))
                index = close + width
                line_start = index > 0 and body[index - 1] == "\n"
                continue
        line_start = body[index] == "\n"
        index += 1
    return spans


def _reference_definitions(
    body: str,
    excluded: tuple[tuple[int, int], ...],
) -> tuple[list[tuple[int, int]], frozenset[str]]:
    spans: list[tuple[int, int]] = []
    definitions: set[str] = set()
    line_start = 0
    while line_start < len(body):
        line_end = body.find("\n", line_start)
        if line_end < 0:
            line_end = len(body)
        cursor = line_start
        indent = 0
        while cursor < line_end and body[cursor] == " " and indent < 4:
            cursor += 1
            indent += 1
        if indent <= 3 and cursor < line_end and body[cursor] == "[":
            label_end = _matching_delimiter(body, cursor, "[", "]", excluded)
            if label_end is not None and label_end < line_end:
                colon = label_end + 1
                if colon < line_end and body[colon] == ":":
                    destination = body[colon + 1 : line_end].strip()
                    label = _reference_label(body[cursor + 1 : label_end])
                    if label and destination:
                        definitions.add(label)
                        spans.append((line_start, line_end))
        line_start = line_end + 1
    return spans, frozenset(definitions)


def _link_spans(
    body: str,
    excluded: tuple[tuple[int, int], ...],
    definitions: frozenset[str],
    definition_spans: list[tuple[int, int]],
) -> list[tuple[int, int]]:
    spans: list[tuple[int, int]] = []
    index = 0
    all_excluded = (*excluded, *definition_spans)
    while index < len(body):
        if (
            body[index] != "["
            or _in_spans(index, all_excluded)
            or _escaped(body, index)
        ):
            index += 1
            continue
        label_end = _matching_delimiter(body, index, "[", "]", excluded)
        if label_end is None:
            index += 1
            continue
        label = _reference_label(body[index + 1 : label_end])
        suffix = label_end + 1
        end: int | None = None
        if suffix < len(body) and body[suffix] == "(":
            destination_end = _matching_delimiter(body, suffix, "(", ")", excluded)
            if destination_end is not None:
                end = destination_end + 1
        elif suffix < len(body) and body[suffix] == "[":
            reference_end = _matching_delimiter(body, suffix, "[", "]", excluded)
            if reference_end is not None:
                reference = _reference_label(body[suffix + 1 : reference_end]) or label
                if reference in definitions:
                    end = reference_end + 1
        elif label in definitions:
            end = label_end + 1
        if end is None:
            index += 1
            continue
        spans.append((index, end))
        index = end
    return spans


def _reference_label(value: str) -> str:
    unescaped: list[str] = []
    index = 0
    while index < len(value):
        if value[index] == "\\" and index + 1 < len(value):
            index += 1
        unescaped.append(value[index])
        index += 1
    return " ".join("".join(unescaped).split()).casefold()


def _url_spans(
    body: str,
    excluded: tuple[tuple[int, int], ...],
) -> list[tuple[int, int]]:
    spans: list[tuple[int, int]] = []
    index = 0
    while index < len(body):
        if _in_spans(index, excluded):
            index += 1
            continue
        prefix_end = _url_prefix_end(body, index)
        if prefix_end is None:
            index += 1
            continue
        end = prefix_end
        depth = 0
        while end < len(body):
            character = body[end]
            if character.isspace() or character in "<>[]{}\"'":
                break
            if character == "(":
                depth += 1
            elif character == ")":
                if depth == 0:
                    break
                depth -= 1
            end += 1
        while end > index and body[end - 1] in ".,;:!?":
            end -= 1
        spans.append((index, end))
        index = max(end, index + 1)
    return spans


def _url_prefix_end(body: str, index: int) -> int | None:
    if index > 0 and _is_name_character(body[index - 1]):
        return None
    if body.startswith("www.", index):
        return index + 4
    cursor = index
    if cursor >= len(body) or not body[cursor].isascii() or not body[cursor].isalpha():
        return None
    cursor += 1
    while cursor < len(body) and (
        body[cursor].isascii() and (body[cursor].isalnum() or body[cursor] in "+.-")
    ):
        cursor += 1
    if cursor >= len(body) or body[cursor] != ":":
        return None
    return cursor + 1


def _matching_delimiter(
    body: str,
    start: int,
    opening: str,
    closing: str,
    excluded: tuple[tuple[int, int], ...],
) -> int | None:
    depth = 0
    for index in range(start, len(body)):
        if _in_spans(index, excluded) or _escaped(body, index):
            continue
        character = body[index]
        if character == opening:
            depth += 1
        elif character == closing:
            depth -= 1
            if depth == 0:
                return index
    return None


def _escaped(body: str, index: int) -> bool:
    backslashes = 0
    index -= 1
    while index >= 0 and body[index] == "\\":
        backslashes += 1
        index -= 1
    return backslashes % 2 == 1
