from __future__ import annotations

import unicodedata
from datetime import UTC, datetime
from threading import Lock
from typing import Any, Protocol

from huddol.domain import DomainError

LIBRARY_TITLE_MAX_CODE_POINTS = 120
LIBRARY_TITLE_MAX_BYTES = 512
LIBRARY_CONTENT_MAX_BYTES = 1_000_000


class LibraryRepository(Protocol):
    def list_library_documents(self) -> list[dict[str, Any]]: ...

    def load_library_document(self, document_id: int) -> dict[str, Any] | None: ...

    def create_library_document(
        self,
        title: str,
        content: str,
        created_at: str,
    ) -> dict[str, Any]: ...

    def update_library_document(
        self,
        document_id: int,
        title: str,
        content: str,
        updated_at: str,
    ) -> dict[str, Any]: ...

    def delete_library_document(self, document_id: int) -> bool: ...


class Library:
    def __init__(self, repository: LibraryRepository) -> None:
        self._repository = repository
        self._lock = Lock()

    def list(self) -> dict[str, Any]:
        documents = sorted(
            self._repository.list_library_documents(),
            key=lambda item: (normalize_library_title(item["title"]), item["id"]),
        )
        return {"documents": documents, "count": len(documents)}

    def read(self, document_id: int) -> dict[str, Any]:
        return {"document": self._require(document_id)}

    def create(self, title: str, content: str) -> dict[str, Any]:
        title = validate_library_title(title)
        content = validate_library_content(content)
        with self._lock:
            self._require_unique_title(title)
            document = self._repository.create_library_document(
                title,
                content,
                datetime.now(UTC).isoformat(),
            )
        return {"document": document}

    def update(
        self,
        document_id: int,
        expected_revision: int,
        title: str,
        content: str,
    ) -> dict[str, Any]:
        title = validate_library_title(title)
        content = validate_library_content(content)
        with self._lock:
            current = self._require(document_id)
            if expected_revision != current["revision"]:
                raise DomainError(
                    "library_revision_conflict",
                    "Library document changed; reload it before saving",
                )
            self._require_unique_title(title, excluding_id=document_id)
            document = self._repository.update_library_document(
                document_id,
                title,
                content,
                datetime.now(UTC).isoformat(),
            )
        return {"document": document}

    def delete(self, document_id: int, expected_revision: int) -> dict[str, Any]:
        with self._lock:
            current = self._require(document_id)
            if expected_revision != current["revision"]:
                raise DomainError(
                    "library_revision_conflict",
                    "Library document changed; reload it before deleting",
                )
            if not self._repository.delete_library_document(document_id):
                raise DomainError(
                    "library_document_not_found", "Library document was not found"
                )
        return {"deleted_document_id": document_id}

    def _require(self, document_id: int) -> dict[str, Any]:
        if type(document_id) is not int or document_id < 1:
            raise DomainError(
                "invalid_library_document", "Library document ID must be positive"
            )
        document = self._repository.load_library_document(document_id)
        if document is None:
            raise DomainError(
                "library_document_not_found", "Library document was not found"
            )
        return document

    def _require_unique_title(
        self,
        title: str,
        excluding_id: int | None = None,
    ) -> None:
        normalized = normalize_library_title(title)
        if any(
            item["id"] != excluding_id
            and normalize_library_title(item["title"]) == normalized
            for item in self._repository.list_library_documents()
        ):
            raise DomainError(
                "duplicate_library_title",
                "A Library document already uses this title",
            )


def normalize_library_title(title: str) -> str:
    return unicodedata.normalize("NFKC", title).casefold()


def validate_library_title(title: str) -> str:
    if not isinstance(title, str):
        raise DomainError("invalid_library_title", "Library title must be text")
    if not title or title != title.strip():
        raise DomainError(
            "invalid_library_title",
            "Library title is required and cannot start or end with whitespace",
        )
    if len(title) > LIBRARY_TITLE_MAX_CODE_POINTS:
        raise DomainError(
            "invalid_library_title",
            f"Library title must be at most {LIBRARY_TITLE_MAX_CODE_POINTS} characters",
        )
    try:
        encoded = title.encode("utf-8")
    except UnicodeEncodeError as error:
        raise DomainError(
            "invalid_library_title", "Library title must be valid UTF-8"
        ) from error
    if len(encoded) > LIBRARY_TITLE_MAX_BYTES:
        raise DomainError(
            "invalid_library_title",
            f"Library title must be at most {LIBRARY_TITLE_MAX_BYTES} bytes",
        )
    if any(unicodedata.category(character).startswith("C") for character in title):
        raise DomainError(
            "invalid_library_title", "Library title cannot contain control characters"
        )
    return title


def validate_library_content(content: str) -> str:
    if not isinstance(content, str):
        raise DomainError("invalid_library_content", "Library content must be text")
    try:
        encoded = content.encode("utf-8")
    except UnicodeEncodeError as error:
        raise DomainError(
            "invalid_library_content", "Library content must be valid UTF-8"
        ) from error
    if len(encoded) > LIBRARY_CONTENT_MAX_BYTES:
        raise DomainError(
            "invalid_library_content",
            f"Library content must be at most {LIBRARY_CONTENT_MAX_BYTES} bytes",
        )
    return content
