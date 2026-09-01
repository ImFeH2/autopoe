from __future__ import annotations

from typing import Any

from huddol.adapters.jsonl.protocol import Dispatcher
from huddol.adapters.model.config import ModelConfig
from huddol.core.errors import DomainError
from huddol.core.turn import idle_streak
from huddol.runtime.scheduler import Scheduler
from huddol.tools import AgentTools
from huddol.tools.authorize import Actor

HUMAN_ID = 1


class Api:
    def __init__(self, scheduler: Scheduler, dispatcher: Dispatcher) -> None:
        self._scheduler = scheduler
        self._dispatcher = dispatcher
        self._register()

    def _human(self) -> AgentTools:
        return self._scheduler.tools_for_actor(Actor(HUMAN_ID, False))

    def _changed(self, event: str, payload: dict[str, Any]) -> None:
        self._dispatcher.emit(event, payload)
        self._scheduler.wake()

    def _register(self) -> None:
        register = self._dispatcher.register
        store = self._scheduler.store
        settings = self._scheduler.settings

        def organization_get(params: dict[str, Any]) -> Any:
            del params
            members = self._human().list_members()
            for member in members:
                if member["type"] != "agent":
                    continue
                usage = self._scheduler.history.usage_total(int(member["id"]))
                member["tokens"] = usage["total_tokens"]
            return {
                "id": 1,
                "members": members,
                "human_id": HUMAN_ID,
                "token_limit": self._scheduler.token_limit(),
            }

        def create_agent(params: dict[str, Any]) -> Any:
            result = self._human().create_agent(str(params.get("name", "")))
            self._changed("member.created", result)
            return result

        def rename_member(params: dict[str, Any]) -> Any:
            result = self._human().rename_member(
                int(params["member_id"]), str(params.get("name", ""))
            )
            self._changed("member.updated", result)
            return result

        def pause_agent(params: dict[str, Any]) -> Any:
            result = self._human().pause_agent(int(params["agent_id"]))
            self._changed("member.updated", result)
            return result

        def resume_agent(params: dict[str, Any]) -> Any:
            result = self._human().resume_agent(int(params["agent_id"]))
            self._changed("member.updated", result)
            return result

        def delete_agent(params: dict[str, Any]) -> Any:
            result = self._human().delete_agent(int(params["agent_id"]))
            self._changed("member.deleted", result)
            return result

        def discussion_create(params: dict[str, Any]) -> Any:
            result = self._human().create_discussion(
                str(params.get("topic", "")), list(params.get("member_ids", []))
            )
            self._changed("discussion.created", result)
            return result

        def discussion_list(params: dict[str, Any]) -> Any:
            return self._human().list_discussions(
                bool(params.get("include_archived", False))
            )

        def discussion_read(params: dict[str, Any]) -> Any:
            message_id = params.get("message_id")
            return self._human().read_discussion(
                int(params["discussion_id"]),
                int(message_id) if message_id is not None else None,
                params.get("limit"),
            )

        def discussion_send(params: dict[str, Any]) -> Any:
            result = self._human().send_message(
                int(params["discussion_id"]), str(params.get("body", ""))
            )
            self._changed("message.created", result)
            return result

        def discussion_ack(params: dict[str, Any]) -> Any:
            result = self._human().ack(
                int(params["discussion_id"]), list(params.get("message_ids", []))
            )
            self._changed("mention.acked", result)
            return result

        def discussion_revoke_ack(params: dict[str, Any]) -> Any:
            discussion_id = int(params["discussion_id"])
            count = store.revoke_ack(
                discussion_id, list(params.get("message_ids", [])), HUMAN_ID
            )
            result = {"discussion_id": discussion_id, "revoked": count}
            self._changed("mention.revoked", result)
            return result

        def discussion_members(params: dict[str, Any]) -> Any:
            discussion_id = int(params["discussion_id"])
            current = store.get_discussion(discussion_id)
            if current is None:
                raise DomainError("not_found", f"Discussion {discussion_id} not found")
            updated = store.set_discussion_members(
                discussion_id, list(params.get("member_ids", []))
            )
            result = {"id": updated.id, "member_ids": sorted(updated.member_ids)}
            self._changed("discussion.updated", result)
            return result

        def discussion_archive(params: dict[str, Any]) -> Any:
            discussion_id = int(params["discussion_id"])
            store.set_archived(discussion_id, bool(params.get("archived", True)))
            result = {
                "id": discussion_id,
                "archived": bool(params.get("archived", True)),
            }
            self._changed("discussion.updated", result)
            return result

        def discussion_delete(params: dict[str, Any]) -> Any:
            discussion_id = int(params["discussion_id"])
            store.delete_discussion(discussion_id)
            result = {"id": discussion_id, "deleted": True}
            self._changed("discussion.deleted", result)
            return result

        def discussion_search(params: dict[str, Any]) -> Any:
            return self._human().search_messages(str(params.get("query", "")))

        def library_list(params: dict[str, Any]) -> Any:
            return self._human().list_library(params.get("path"))

        def library_read(params: dict[str, Any]) -> Any:
            return self._human().read_library(str(params["path"]))

        def library_write(params: dict[str, Any]) -> Any:
            result = self._human().write_library(
                str(params["path"]),
                str(params.get("content", "")),
                params.get("expected_hash"),
            )
            self._changed("library.updated", result)
            return result

        def library_delete(params: dict[str, Any]) -> Any:
            result = self._human().delete_library(str(params["path"]))
            self._changed("library.updated", result)
            return result

        def library_move(params: dict[str, Any]) -> Any:
            result = self._human().move_library(
                str(params["path"]), str(params["destination"])
            )
            self._changed("library.updated", result)
            return result

        def agent_detail(params: dict[str, Any]) -> Any:
            agent_id = int(params["agent_id"])
            tools = self._scheduler.tools_for_actor(Actor(agent_id, True))
            runs = self._scheduler.history.runs(agent_id, limit=30)
            effects = self._scheduler.history.effects(
                agent_id, sequences=[run.sequence for run in runs]
            )
            produced: dict[int, list[dict[str, Any]]] = {}
            for effect in effects:
                produced.setdefault(effect.sequence, []).append(
                    {"tool": effect.tool, "summary": effect.summary}
                )
            return {
                "id": agent_id,
                "todos": tools.list_todos(),
                "memory": tools.list_memory(),
                "usage": self._scheduler.history.usage_total(agent_id),
                "token_limit": self._scheduler.token_limit(),
                "over_token_limit": self._scheduler.over_token_limit(agent_id),
                "idle_streak": idle_streak(
                    [
                        (
                            run.status,
                            [item["tool"] for item in produced.get(run.sequence, [])],
                        )
                        for run in runs
                    ]
                ),
                "runs": [
                    {
                        "sequence": run.sequence,
                        "status": run.status,
                        "started_at": run.started_at,
                        "completed_at": run.completed_at,
                        "usage": run.usage_json,
                        "error": run.error,
                        "effects": produced.get(run.sequence, []),
                    }
                    for run in runs
                ],
            }

        def settings_get(params: dict[str, Any]) -> Any:
            section = str(params.get("section", "model"))
            values = settings.get_settings(section) or {}
            if section == "model":
                config = ModelConfig.restore(values)
                return config.redacted() if config else {"api_key_set": False}
            if section == "observability":
                return {
                    key: value
                    for key, value in values.items()
                    if key not in ("secret_key", "public_key")
                } | {"keys_set": bool(values.get("secret_key"))}
            if section == "execution":
                return {
                    **values,
                    "write_directories": list(settings.write_directories()),
                }
            return values

        def settings_update(params: dict[str, Any]) -> Any:
            section = str(params.get("section", "model"))
            values = dict(params.get("values", {}))
            if section == "execution":
                directories = values.pop("write_directories", None)
                if directories is not None:
                    self._scheduler.reconfigure_sandbox(list(directories))
                    settings.set_write_directories(
                        list(self._scheduler.sandbox.write_directories)
                    )
            merged = {**(settings.get_settings(section) or {}), **values}
            settings.set_settings(section, merged)
            self._dispatcher.emit("settings.updated", {"section": section})
            return settings_get({"section": section})

        register("organization.get", organization_get)
        register("organization.create_agent", create_agent)
        register("organization.rename_member", rename_member)
        register("organization.pause_agent", pause_agent)
        register("organization.resume_agent", resume_agent)
        register("organization.delete_agent", delete_agent)
        register("discussion.create", discussion_create)
        register("discussion.list", discussion_list)
        register("discussion.read", discussion_read)
        register("discussion.send", discussion_send)
        register("discussion.ack", discussion_ack)
        register("discussion.revoke_ack", discussion_revoke_ack)
        register("discussion.set_members", discussion_members)
        register("discussion.archive", discussion_archive)
        register("discussion.delete", discussion_delete)
        register("discussion.search", discussion_search)
        register("library.list", library_list)
        register("library.read", library_read)
        register("library.write", library_write)
        register("library.delete", library_delete)
        register("library.move", library_move)
        register("agent.detail", agent_detail)
        register("settings.get", settings_get)
        register("settings.update", settings_update)
