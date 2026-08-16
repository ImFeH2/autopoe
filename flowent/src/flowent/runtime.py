from __future__ import annotations

import logging
import time
from collections.abc import Callable
from dataclasses import dataclass
from threading import Event, Lock, Thread, current_thread
from typing import Any, Protocol

from pydantic_ai.messages import ModelMessage

from flowent.diagnostics import log_event, log_exception
from flowent.domain import OrganizationState, Reminder
from flowent.history import AgentHistory, AgentHistoryRun
from flowent.host_tools import HostToolError, HostTools


@dataclass(frozen=True)
class AgentRunContext:
    agent_id: int
    state: OrganizationState
    host_tools: HostTools
    run_id: str | None = None
    message_history: tuple[ModelMessage, ...] = ()
    history_event_sink: Callable[..., None] | None = None

    def emit_history_event(self, event_type: str, **data: Any) -> None:
        if self.history_event_sink is not None:
            self.history_event_sink(event_type, **data)

    def organization(self, action: str, **arguments: Any) -> Any:
        def operation() -> Any:
            if action == "list_members":
                return self.state.list_members()
            if action == "create_agent":
                snapshot = self.state.create_agent(name=arguments["name"])
                return snapshot["members"][-1]
            raise ValueError(f"Unknown organization action: {action}")

        return self._call_tool("organization", action, operation)

    def exec(
        self,
        argv: list[str],
        cwd: str | None = None,
        timeout_seconds: int = 60,
    ) -> dict[str, Any]:
        return self._call_tool(
            "exec",
            None,
            lambda: self.host_tools.exec(argv, cwd, timeout_seconds),
        )

    def patch(self, diff: str) -> dict[str, Any]:
        return self._call_tool("patch", None, lambda: self.host_tools.patch(diff))

    def discussion(self, action: str, **arguments: Any) -> Any:
        return self._call_tool(
            "discussion",
            action,
            lambda: self._discussion(action, arguments),
        )

    def _discussion(self, action: str, arguments: dict[str, Any]) -> Any:
        if action == "create":
            snapshot = self.state.create_discussion(
                topic=arguments["topic"],
                creator_id=self.agent_id,
                member_ids=arguments["member_ids"],
            )
            return {"discussion_id": snapshot["discussions"][-1]["id"]}
        if action == "send":
            discussion_id = arguments["discussion_id"]
            snapshot = self.state.send_message(
                discussion_id=discussion_id,
                sender_id=self.agent_id,
                body=arguments["body"],
                mention_ids=arguments.get("mention_ids", ()),
            )
            discussion = next(
                item for item in snapshot["discussions"] if item["id"] == discussion_id
            )
            message = discussion["messages"][-1]
            return {
                "discussion_id": discussion_id,
                "message_id": message["id"],
                "mention_ids": [
                    mention["member_id"] for mention in message["mentions"]
                ],
            }
        if action == "list":
            return [
                discussion_summary(discussion)
                for discussion in self.state.list_discussions(self.agent_id)
            ]
        if action == "info":
            return self.state.discussion_info(
                member_id=self.agent_id,
                discussion_id=arguments["discussion_id"],
            )
        if action == "read":
            return self.state.read_discussion(
                agent_id=self.agent_id,
                discussion_id=arguments["discussion_id"],
                start_message_id=arguments.get("start_message_id"),
                end_message_id=arguments.get("end_message_id"),
                limit=arguments.get("limit", 100),
            )
        if action == "ack":
            return self.state.ack_messages(
                agent_id=self.agent_id,
                discussion_id=arguments["discussion_id"],
                message_ids=arguments["message_ids"],
            )
        if action == "search":
            return [
                {
                    "discussion_id": result["discussion_id"],
                    "message_id": result["id"],
                    "sender_id": result["sender_id"],
                }
                for result in self.state.search_messages(
                    query=arguments["query"],
                    discussion_id=arguments.get("discussion_id"),
                    sender_id=arguments.get("sender_id"),
                    member_id=self.agent_id,
                )
            ]
        raise ValueError(f"Unknown discussion action: {action}")

    def _call_tool(
        self,
        tool_name: str,
        action: str | None,
        operation: Callable[[], Any],
    ) -> Any:
        started = time.monotonic()
        fields = {
            "agent_id": self.agent_id,
            "turn_id": self.run_id,
            "tool_name": tool_name,
            "action": action,
        }
        log_event("tool.started", **fields)
        try:
            result = operation()
        except Exception as error:
            log_exception(
                "tool.failed",
                error,
                duration_ms=round((time.monotonic() - started) * 1000),
                **fields,
            )
            raise
        result_fields: dict[str, Any] = {}
        if tool_name == "exec":
            result_fields = {
                "exit_code": result["exit_code"],
                "timed_out": result["timed_out"],
                "stdout_bytes": len(result["stdout"].encode("utf-8")),
                "stderr_bytes": len(result["stderr"].encode("utf-8")),
            }
        elif tool_name == "patch":
            result_fields = {"file_count": len(result["paths"])}
        elif isinstance(result, list):
            result_fields = {"result_count": len(result)}
        log_event(
            "tool.completed",
            duration_ms=round((time.monotonic() - started) * 1000),
            **fields,
            **result_fields,
        )
        return result


def discussion_summary(discussion: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": discussion["id"],
        "topic": discussion["topic"],
    }


@dataclass(frozen=True)
class AgentRunOutcome:
    messages: tuple[ModelMessage, ...] = ()
    usage: dict[str, Any] | None = None


class AgentRunner(Protocol):
    def run(
        self,
        reminder: Reminder,
        context: AgentRunContext,
    ) -> AgentRunOutcome | None: ...


class AgentRunFailure(Exception):
    def __init__(
        self,
        message: str,
        messages: tuple[ModelMessage, ...] = (),
        usage: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.messages = messages
        self.usage = usage


class AgentRuntime:
    def __init__(
        self,
        state: OrganizationState,
        runner: AgentRunner,
        host_tools: HostTools,
        history: AgentHistory | None = None,
    ) -> None:
        self._state = state
        self._runner = runner
        self._host_tools = host_tools
        self._history = history
        self._stop_event = Event()
        self._stop_lock = Lock()
        self._stop_completed = False
        self._workers_lock = Lock()
        self._workers: set[Thread] = set()
        self._scheduler = Thread(
            target=self._schedule,
            name="flowent-agent-scheduler",
            daemon=True,
        )

    def start(self) -> None:
        log_event("scheduler.started")
        self._scheduler.start()

    def stop(self) -> None:
        with self._stop_lock:
            if self._stop_completed:
                return
            if not self._stop_event.is_set():
                log_event("scheduler.stop.started")
                self._stop_event.set()
                self._state.wake()
            self._scheduler.join(timeout=5)
            self._host_tools.close()
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                with self._workers_lock:
                    workers = list(self._workers)
                if not workers:
                    self._stop_completed = True
                    log_event("scheduler.stop.completed")
                    return
                for worker in workers:
                    worker.join(timeout=max(0, deadline - time.monotonic()))
            with self._workers_lock:
                worker_count = len(self._workers)
            log_event(
                "scheduler.stop.incomplete",
                level=logging.WARNING,
                worker_count=worker_count,
            )

    def _schedule(self) -> None:
        revision = -1
        while not self._stop_event.is_set():
            reminder, revision = self._state.claim_next_reminder()
            if self._stop_event.is_set():
                if reminder is not None:
                    self._state.complete_turn(
                        reminder.agent_id,
                        "Agent runtime stopped",
                    )
                return
            if reminder is None:
                self._state.wait_for_change(revision, self._stop_event)
                continue

            log_event(
                "scheduler.reminder.claimed",
                agent_id=reminder.agent_id,
                reminder_count=len(reminder.mentions),
                new_mention_count=sum(
                    not mention.previously_reminded for mention in reminder.mentions
                ),
                previously_reminded_count=sum(
                    mention.previously_reminded for mention in reminder.mentions
                ),
            )
            worker = Thread(
                target=self._run_turn,
                args=(reminder,),
                name=f"flowent-agent-{reminder.agent_id}",
                daemon=True,
            )
            with self._workers_lock:
                self._workers.add(worker)
                worker.start()

    def _run_turn(self, reminder: Reminder) -> None:
        started = time.monotonic()
        completed = False
        error: str | None = None
        failure_type: str | None = None
        outcome = AgentRunOutcome()
        history_run: AgentHistoryRun | None = None
        try:
            if self._history is not None:
                history_run = self._history.start(reminder)
            log_event(
                "agent.turn.started",
                agent_id=reminder.agent_id,
                turn_id=history_run.run_id if history_run is not None else None,
                reminder_count=len(reminder.mentions),
                previous_message_count=(
                    len(history_run.message_history) if history_run is not None else 0
                ),
            )
            result = self._runner.run(
                reminder,
                AgentRunContext(
                    agent_id=reminder.agent_id,
                    state=self._state,
                    host_tools=self._host_tools,
                    run_id=history_run.run_id if history_run is not None else None,
                    message_history=(
                        history_run.message_history if history_run is not None else ()
                    ),
                    history_event_sink=(
                        history_run.emit if history_run is not None else None
                    ),
                ),
            )
            if result is not None:
                outcome = result
            completed = True
        except AgentRunFailure as exception:
            failure_type = type(exception).__name__
            error = str(exception)
            outcome = AgentRunOutcome(exception.messages, exception.usage)
        except HostToolError as exception:
            failure_type = type(exception).__name__
            error = str(exception)
        except (OSError, RuntimeError, TypeError, ValueError) as exception:
            failure_type = type(exception).__name__
            log_exception(
                "agent.turn.exception",
                exception,
                agent_id=reminder.agent_id,
                turn_id=history_run.run_id if history_run is not None else None,
            )
            error = "Agent run failed"
        finally:
            try:
                if history_run is not None:
                    try:
                        history_run.complete(
                            "completed" if completed else "failed",
                            outcome.messages,
                            outcome.usage,
                            error,
                        )
                    except (OSError, RuntimeError, TypeError, ValueError) as exception:
                        failure_type = type(exception).__name__
                        log_exception(
                            "history.turn.failed",
                            exception,
                            agent_id=reminder.agent_id,
                            turn_id=history_run.run_id,
                        )
                        completed = False
                        error = "Agent history could not be saved"
                execution_before = self._state.agent_execution_diagnostics(
                    reminder.agent_id
                )
                if completed:
                    self._state.complete_turn(reminder.agent_id)
                else:
                    self._state.complete_turn(
                        reminder.agent_id,
                        error or "Agent run failed",
                    )
                execution_after = self._state.agent_execution_diagnostics(
                    reminder.agent_id
                )
                log_event(
                    "agent.turn.completed" if completed else "agent.turn.failed",
                    level=logging.INFO if completed else logging.ERROR,
                    agent_id=reminder.agent_id,
                    turn_id=history_run.run_id if history_run is not None else None,
                    duration_ms=round((time.monotonic() - started) * 1000),
                    status=execution_after["status"],
                    acknowledged_count=execution_before["acknowledged_in_turn"],
                    consecutive_unproductive_turns=execution_after[
                        "consecutive_unproductive_turns"
                    ],
                    message_count=len(outcome.messages),
                    has_usage=outcome.usage is not None,
                    failure_type=failure_type,
                )
            finally:
                with self._workers_lock:
                    self._workers.discard(current_thread())
