import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

DEFAULT_STATIC_DIR = Path(__file__).parent / "static"


def frontend_static_directory() -> Path:
    configured_directory = os.environ.get("FLOWENT_STATIC_DIR")
    if configured_directory:
        return Path(configured_directory)
    repository_frontend_dist = Path(__file__).resolve().parents[3] / "frontend" / "dist"
    if repository_frontend_dist.is_dir():
        return repository_frontend_dist
    return DEFAULT_STATIC_DIR


def create_app(*, serve_frontend: bool = True) -> FastAPI:
    app = FastAPI(title="Flowent")

    static_dir = frontend_static_directory().resolve(strict=False)

    @app.get("/api/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    if serve_frontend and static_dir.is_dir():
        assets_dir = static_dir / "assets"
        if assets_dir.is_dir():
            app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

        @app.get("/{path:path}")
        async def spa_fallback(path: str) -> FileResponse:
            file = (static_dir / path).resolve(strict=False)
            if file.is_file() and file.is_relative_to(static_dir):
                return FileResponse(file)
            return FileResponse(static_dir / "index.html")

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app)
