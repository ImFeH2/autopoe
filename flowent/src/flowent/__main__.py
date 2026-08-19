from __future__ import annotations

import sys
from collections.abc import Callable
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from flowent.model_runner import ModelRuntime


def main(
    create_model_runtime: Callable[..., ModelRuntime] | None = None,
) -> None:
    if len(sys.argv) == 3 and sys.argv[1] == "--process-watch":
        from flowent.host_tools import watch_processes

        watch_processes(sys.argv[2], sys.stdin.buffer)
        return

    sys.stdin.reconfigure(encoding="utf-8", errors="strict")
    sys.stdout.reconfigure(encoding="utf-8", errors="strict")

    from flowent.diagnostics import (
        configure_diagnostics,
        log_event,
        log_exception,
        shutdown_diagnostics,
    )
    from flowent.domain import OrganizationState
    from flowent.history import AgentHistory
    from flowent.host_tools import AgentHostTools, ProcessWatcher
    from flowent.memory import AgentMemory
    from flowent.model_runner import create_runner
    from flowent.operations import OrganizationOperations
    from flowent.persistence import SQLiteStore, data_directory
    from flowent.protocol import JsonLineWriter, serve
    from flowent.runtime import AgentRuntime
    from flowent.todos import AgentTodos
    from flowent.wsl_host_tools import create_host_tools

    if create_model_runtime is None:
        create_model_runtime = create_runner

    storage_directory = data_directory()
    configure_diagnostics(storage_directory)
    runtime: AgentRuntime | None = None
    model_runtime: ModelRuntime | None = None
    host_tools: AgentHostTools | None = None
    watcher: ProcessWatcher | None = None
    stop_reason = "startup_failure"
    try:
        host_tools = create_host_tools()
        working_directory = host_tools.working_directory
        log_event(
            "process.started",
            python_version=(
                f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
            ),
            working_directory=working_directory,
            host_backend=host_tools.execution_backend,
            data_directory=str(storage_directory),
            frozen=bool(getattr(sys, "frozen", False)),
        )
        store = SQLiteStore(storage_directory)
        writer = JsonLineWriter(sys.stdout)
        history = AgentHistory(
            store,
            lambda event: writer.write_event("agent.history.updated", event),
        )
        todos = AgentTodos(store)
        memories = AgentMemory(storage_directory)
        watcher = ProcessWatcher(host_tools.process_owner)
        state = OrganizationState(
            working_directory,
            persisted=store.load_organization(),
            on_persist=store.save_organization,
        )
        memories.remove_orphans(
            {
                member["id"]
                for member in state.snapshot()["members"]
                if member["type"] == "agent"
            }
        )
        model_runtime = create_model_runtime(
            stored_config=store.load_model_config(),
            stored_observability_config=store.load_observability_config(),
            on_configure=store.save_model_config,
            on_configure_observability=store.save_observability_config,
        )
        operations = OrganizationOperations(state, history, todos, memories)
        runtime = AgentRuntime(
            state,
            model_runtime,
            host_tools,
            history,
            todos,
            memories,
            operations,
        )
        runtime.start()
        stop_reason = serve(
            sys.stdin,
            sys.stdout,
            state,
            lambda: runtime.stop(reason="system_shutdown"),
            model_runtime,
            history,
            writer,
            todos,
            memories,
            operations,
        )
    except BaseException as error:
        stop_reason = "exception"
        log_exception("process.failed", error)
        raise
    finally:
        log_event(
            "process.stopping",
            reason=stop_reason,
            runtime_started=runtime is not None,
            model_runtime_started=model_runtime is not None,
            host_tools_started=host_tools is not None,
        )
        if runtime is not None:
            runtime.stop(reason=stop_reason)
        elif host_tools is not None:
            host_tools.close()
        if model_runtime is not None:
            model_runtime.shutdown()
        if watcher is not None:
            watcher.close()
        log_event("process.stopped", reason=stop_reason)
        shutdown_diagnostics()


if __name__ == "__main__":
    main()
