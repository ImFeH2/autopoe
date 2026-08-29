from __future__ import annotations

import sys
from collections.abc import Callable
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from huddol.model_runner import ModelRuntime


def main(
    create_model_runtime: Callable[..., ModelRuntime] | None = None,
) -> None:
    if len(sys.argv) == 3 and sys.argv[1] == "--process-watch":
        from huddol.host_tools import watch_processes

        watch_processes(sys.argv[2], sys.stdin.buffer)
        return
    if (
        len(sys.argv) >= 5
        and sys.argv[1] == "--windows-write-sandbox"
        and sys.argv[3] == "--"
    ):
        from pathlib import Path

        from huddol.windows_write_access import run_restricted_command

        raise SystemExit(
            run_restricted_command(sys.argv[2], sys.argv[4:], str(Path.cwd()))
        )

    sys.stdin.reconfigure(encoding="utf-8", errors="strict")
    sys.stdout.reconfigure(encoding="utf-8", errors="strict")

    from huddol.diagnostics import (
        configure_diagnostics,
        log_event,
        log_exception,
        shutdown_diagnostics,
    )
    from huddol.domain import OrganizationState
    from huddol.history import AgentHistory
    from huddol.host_tools import AgentHostTools, ProcessWatcher
    from huddol.memory import AgentMemory
    from huddol.model_runner import create_runner
    from huddol.operations import OrganizationOperations
    from huddol.persistence import SQLiteStore, data_directory
    from huddol.protocol import JsonLineWriter, serve
    from huddol.runtime import AgentRuntime
    from huddol.todos import AgentTodos
    from huddol.wsl_host_tools import create_host_tools

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
        store = SQLiteStore(storage_directory)
        execution_backend, write_directories = store.load_execution_settings()
        host_tools, execution_settings = create_host_tools(
            execution_backend,
            write_directories,
            store.save_execution_settings,
        )
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
            current_human_member_id=1,
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
        operations = OrganizationOperations(
            state,
            store,
            history=history,
            todos=todos,
            memories=memories,
        )
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
            execution_settings,
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
