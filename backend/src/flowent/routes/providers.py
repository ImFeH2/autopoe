from fastapi import FastAPI, HTTPException, status

from flowent.api_models import (
    ProviderModelsFailureResponse,
    ProviderModelsRequest,
    ProviderModelsResponse,
)
from flowent.llm import (
    ProviderModelFetchError,
    ProviderModelFetchFailure,
    list_provider_models,
)
from flowent.storage import StateStore, StoredProvider, StoredSettings

PROVIDER_MODEL_FAILURE_STATUS: dict[ProviderModelFetchFailure, int] = {
    ProviderModelFetchFailure.CONNECTION_FAILED: status.HTTP_502_BAD_GATEWAY,
    ProviderModelFetchFailure.ACCESS_DENIED: status.HTTP_403_FORBIDDEN,
    ProviderModelFetchFailure.RATE_LIMITED: status.HTTP_429_TOO_MANY_REQUESTS,
    ProviderModelFetchFailure.PROVIDER_UNAVAILABLE: status.HTTP_503_SERVICE_UNAVAILABLE,
    ProviderModelFetchFailure.REQUEST_FAILED: status.HTTP_400_BAD_REQUEST,
}


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
        try:
            return ProviderModelsResponse(
                models=list_provider_models(
                    base_url=request.base_url,
                    provider=request.provider,
                    secret_reference=request.secret_reference,
                ),
            )
        except ProviderModelFetchError as exc:
            detail = ProviderModelsFailureResponse(code=exc.failure.value)
            raise HTTPException(
                detail=detail.model_dump(),
                status_code=PROVIDER_MODEL_FAILURE_STATUS[exc.failure],
            ) from exc

    @app.put("/api/settings")
    async def save_settings(settings: StoredSettings) -> StoredSettings:
        return store.save_settings(settings)
