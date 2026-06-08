from fastapi import FastAPI

from flowent.api_models import ProviderModelsRequest, ProviderModelsResponse
from flowent.llm import list_provider_models
from flowent.storage import StateStore, StoredProvider, StoredSettings


def register_provider_routes(app: FastAPI, *, store: StateStore) -> None:
    @app.post("/api/providers")
    async def save_provider(provider: StoredProvider) -> StoredProvider:
        return store.save_provider(provider)

    @app.delete("/api/providers/{provider_id}")
    async def delete_provider(provider_id: str) -> dict[str, bool]:
        store.delete_provider(provider_id)
        return {"ok": True}

    @app.post("/api/providers/models")
    async def provider_models(request: ProviderModelsRequest) -> ProviderModelsResponse:
        return ProviderModelsResponse(
            models=list_provider_models(
                base_url=request.base_url,
                provider=request.provider,
                secret_reference=request.secret_reference,
            ),
        )

    @app.put("/api/settings")
    async def save_settings(settings: StoredSettings) -> StoredSettings:
        return store.save_settings(settings)
