from __future__ import annotations

from unicodedata import category, normalize

MEMBER_NAME_MAX_CODE_POINTS = 32
MEMBER_NAME_MAX_UTF8_BYTES = 128


def member_name_policy_data() -> dict[str, str | int]:
    return {
        "normalization": "NFKC",
        "max_code_points": MEMBER_NAME_MAX_CODE_POINTS,
        "max_utf8_bytes": MEMBER_NAME_MAX_UTF8_BYTES,
    }


class MemberNameValidationError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def normalized_member_name(value: str) -> str:
    return normalize("NFKC", value)


def normalized_member_name_key(value: str) -> str:
    return normalized_member_name(value).casefold()


def validate_mention_safe_name(value: str) -> str:
    if not value:
        raise MemberNameValidationError("invalid_name", "Member name is required")
    if value != value.strip():
        raise MemberNameValidationError(
            "invalid_name", "Member name cannot start or end with whitespace"
        )
    if not any(category(character)[0] in {"L", "N"} for character in value):
        raise MemberNameValidationError(
            "invalid_name", "Member names require a Unicode letter or number"
        )
    if any(
        character not in " -_" and category(character)[0] not in {"L", "M", "N"}
        for character in value
    ):
        raise MemberNameValidationError(
            "invalid_name",
            "Member names may contain only Unicode letters, numbers, marks, ASCII spaces, '-' and '_'",
        )
    return value


def validate_member_name_for_mutation(value: str) -> str:
    validate_mention_safe_name(value)
    normalized = normalized_member_name(value)
    try:
        utf8_bytes = len(normalized.encode("utf-8"))
    except UnicodeEncodeError as error:
        raise MemberNameValidationError(
            "invalid_name", "Member name must contain valid Unicode"
        ) from error
    if utf8_bytes > MEMBER_NAME_MAX_UTF8_BYTES:
        raise MemberNameValidationError(
            "name_too_large",
            f"Member name must be at most {MEMBER_NAME_MAX_UTF8_BYTES} UTF-8 bytes after NFKC normalization",
        )
    if len(normalized) > MEMBER_NAME_MAX_CODE_POINTS:
        raise MemberNameValidationError(
            "name_too_long",
            f"Member name must be at most {MEMBER_NAME_MAX_CODE_POINTS} Unicode characters after NFKC normalization",
        )
    return value
