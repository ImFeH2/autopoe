from pathlib import Path

from fastapi import FastAPI

from flowent.api_models import WritablePathListResponse, WritablePathRequest
from flowent.storage import StateStore, StoredWritablePath


def normalized_request_path(path: str, cwd: Path) -> Path:
    raw_path = Path(path).expanduser()
    if not raw_path.is_absolute():
        raw_path = cwd / raw_path
    return raw_path.resolve(strict=False)


def register_permission_routes(
    app: FastAPI,
    *,
    cwd: Path,
    store: StateStore,
) -> None:
    @app.post("/api/permissions/writable-paths")
    async def save_writable_path(
        request: WritablePathRequest,
    ) -> StoredWritablePath:
        return store.save_writable_path(normalized_request_path(request.path, cwd))

    @app.delete("/api/permissions/writable-paths")
    async def delete_writable_path(
        request: WritablePathRequest,
    ) -> WritablePathListResponse:
        return WritablePathListResponse(
            writable_paths=store.delete_writable_path(
                normalized_request_path(request.path, cwd)
            )
        )
