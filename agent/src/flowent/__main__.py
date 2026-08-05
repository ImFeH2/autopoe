from __future__ import annotations

import asyncio
import os
from pathlib import Path
from typing import Any

from flowent.collaboration import CollaborationStore
from flowent.models import ModelError, ModelStore, resolve_model
from flowent.project import Project, ProjectStore
from flowent.protocol import JsonlConnection, ProtocolError
from flowent.providers import ProviderError, ProviderStore, fetch_models
from flowent.runtime import AgentRuntime

RUNTIME_READY = "runtime/ready"
RUNTIME_SHUTDOWN = "runtime/shutdown"
APPROVAL_TIMEOUT = 300


def respond(connection: JsonlConnection, request_id: str, result: Any) -> None:
    connection.send({"id": request_id, "result": result})


def reject(connection: JsonlConnection, request_id: str, message: str) -> None:
    connection.send({"id": request_id, "error": {"message": message}})


def state(project: Project | None, runtime: AgentRuntime | None) -> dict[str, Any]:
    runtime_state = (
        runtime.state()
        if runtime
        else {"agent": None, "chat": None, "messages": [], "last_turn": None}
    )
    return {
        "project": project.to_dict() if project else None,
        **runtime_state,
    }


async def serve() -> None:
    connection = JsonlConnection()
    connection.start()
    data_dir = os.environ.get("FLOWENT_DATA_DIR")
    if not data_dir:
        raise RuntimeError("FLOWENT_DATA_DIR is required")

    root = Path(data_dir)
    store = ProjectStore(root)
    collaboration_store = CollaborationStore(root)
    provider_store = ProviderStore(root)
    model_store = ModelStore(root)
    await store.initialize()
    await collaboration_store.initialize()
    await provider_store.initialize()
    await model_store.initialize()
    selection = await model_store.get()

    async def provider_secret(provider_id: str) -> str | None:
        secret = await connection.request("providers/secret", {"id": provider_id})
        if secret is not None and not isinstance(secret, str):
            raise ProtocolError("desktop returned an invalid provider secret")
        return secret

    async def selected_model():
        selected = await model_store.get()
        if selected is None:
            raise ModelError("model is not configured")
        return await resolve_model(selected, provider_store, provider_secret)

    async def request_approval(params: dict[str, Any]) -> bool:
        try:
            result = await asyncio.wait_for(
                connection.request("approval/request", params),
                APPROVAL_TIMEOUT,
            )
        except TimeoutError as error:
            raise ProtocolError("approval timed out") from error
        if not isinstance(result, bool):
            raise ProtocolError("desktop returned an invalid approval")
        return result

    async def create_runtime(current_project: Project) -> AgentRuntime:
        snapshot = await collaboration_store.open_project(current_project.id)
        return AgentRuntime(
            root,
            current_project,
            connection.send,
            selection.model_id if selection else None,
            selected_model,
            request_approval,
            collaboration_store,
            snapshot,
        )

    project = await store.current()
    runtime = await create_runtime(project) if project else None
    connection.send(
        {
            "method": RUNTIME_READY,
            "params": {
                "project": project.to_dict() if project else None,
                "agent": runtime.agent_info() if runtime else None,
                "chat": runtime.chat.to_dict() if runtime else None,
                "capabilities": [
                    "state/get",
                    "project/open",
                    "providers/list",
                    "providers/save",
                    "providers/delete",
                    "providers/models",
                    "model/get",
                    "model/set",
                    "chat/send",
                    RUNTIME_SHUTDOWN,
                ],
            },
        }
    )
    while message := await connection.receive():
        request_id = message.get("id")
        method = message.get("method")
        if not isinstance(method, str):
            continue

        if method == "chat/send":
            params = message.get("params")
            content = params.get("content") if isinstance(params, dict) else None
            if runtime and isinstance(content, str) and content.strip():
                await runtime.run_turn(content.strip())
            continue
        if not isinstance(request_id, str):
            continue
        if method == "state/get":
            respond(connection, request_id, state(project, runtime))
            continue
        if method == "project/open":
            params = message.get("params")
            workspace = params.get("workspace") if isinstance(params, dict) else None
            if not isinstance(workspace, str) or not workspace.strip():
                reject(connection, request_id, "workspace is required")
                continue
            try:
                project = await store.open(workspace)
            except (OSError, ValueError) as error:
                reject(connection, request_id, str(error))
                continue
            runtime = await create_runtime(project)
            respond(connection, request_id, state(project, runtime))
            continue
        if method == "providers/list":
            providers = await provider_store.list()
            respond(
                connection,
                request_id,
                [provider.to_dict() for provider in providers],
            )
            continue
        if method == "providers/save":
            params = message.get("params")
            if not isinstance(params, dict):
                reject(connection, request_id, "provider is required")
                continue
            provider_id = params.get("id")
            name = params.get("name")
            provider_type = params.get("type")
            base_url = params.get("base_url")
            if provider_id is not None and not isinstance(provider_id, str):
                reject(connection, request_id, "invalid provider ID")
                continue
            if not all(
                isinstance(value, str) for value in (name, provider_type, base_url)
            ):
                reject(connection, request_id, "provider fields are required")
                continue
            try:
                provider = await provider_store.save(
                    provider_id,
                    name,
                    provider_type,
                    base_url,
                )
            except ProviderError as error:
                reject(connection, request_id, str(error))
                continue
            respond(connection, request_id, provider.to_dict())
            continue
        if method == "providers/delete":
            params = message.get("params")
            provider_id = params.get("id") if isinstance(params, dict) else None
            if not isinstance(provider_id, str):
                reject(connection, request_id, "provider ID is required")
                continue
            try:
                await provider_store.delete(provider_id)
            except ProviderError as error:
                reject(connection, request_id, str(error))
                continue
            if await model_store.clear_provider(provider_id):
                selection = None
                if runtime:
                    runtime.set_model(None)
                    connection.send(
                        {"method": "agent/updated", "params": runtime.agent_info()}
                    )
            respond(connection, request_id, {"deleted": provider_id})
            continue
        if method == "providers/models":
            params = message.get("params")
            provider_id = params.get("id") if isinstance(params, dict) else None
            if not isinstance(provider_id, str):
                reject(connection, request_id, "provider ID is required")
                continue
            try:
                provider = await provider_store.get(provider_id)
                api_key = await provider_secret(provider_id) or ""
                models = await fetch_models(provider, api_key)
            except (ProtocolError, ProviderError) as error:
                reject(connection, request_id, str(error))
                continue
            respond(
                connection,
                request_id,
                [model.to_dict() for model in models],
            )
            continue
        if method == "model/get":
            respond(
                connection,
                request_id,
                selection.to_dict() if selection else None,
            )
            continue
        if method == "model/set":
            params = message.get("params")
            provider_id = (
                params.get("provider_id") if isinstance(params, dict) else None
            )
            model_id = params.get("model_id") if isinstance(params, dict) else None
            if not isinstance(provider_id, str) or not isinstance(model_id, str):
                reject(connection, request_id, "provider and model are required")
                continue
            try:
                await provider_store.get(provider_id)
                selection = await model_store.save(provider_id, model_id)
            except (ModelError, ProviderError) as error:
                reject(connection, request_id, str(error))
                continue
            respond(connection, request_id, selection.to_dict())
            if runtime:
                runtime.set_model(selection.model_id)
                connection.send(
                    {"method": "agent/updated", "params": runtime.agent_info()}
                )
            continue
        if method == RUNTIME_SHUTDOWN:
            respond(connection, request_id, {"stopping": True})
            return
        reject(connection, request_id, f"unknown method: {method}")


def main() -> None:
    asyncio.run(serve())


if __name__ == "__main__":
    main()
