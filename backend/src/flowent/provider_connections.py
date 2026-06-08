import logging

from fastapi import HTTPException

from flowent.llm import ProviderConnection
from flowent.storage import StoredState

logger = logging.getLogger("flowent.provider_connections")


def selected_connection(state: StoredState) -> ProviderConnection:
    provider = next(
        (
            stored_provider
            for stored_provider in state.providers
            if stored_provider.id == state.settings.selected_provider_id
        ),
        None,
    )
    if provider is None or not state.settings.selected_model:
        logger.warning("Workspace request blocked because provider or model is missing")
        raise HTTPException(
            status_code=400,
            detail="Choose a provider and model before sending.",
        )
    if not provider.api_key:
        logger.warning("Workspace request blocked because selected provider has no key")
        raise HTTPException(status_code=400, detail="Add a key before sending.")

    logger.debug(
        "Workspace request using provider=%s model=%s",
        provider.name,
        state.settings.selected_model,
    )
    return ProviderConnection(
        base_url=provider.base_url or None,
        model=state.settings.selected_model,
        name=provider.name,
        provider=provider.type,
        reasoning_effort=state.settings.reasoning_effort,
        secret_reference=provider.api_key,
    )
