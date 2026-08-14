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

    from pathlib import Path

    from flowent.domain import OrganizationState
    from flowent.host_tools import HostTools, ProcessWatcher
    from flowent.model_runner import create_runner
    from flowent.persistence import SQLiteStore, data_directory
    from flowent.protocol import serve
    from flowent.runtime import AgentRuntime

    if create_model_runtime is None:
        create_model_runtime = create_runner

    working_directory = Path.cwd().resolve()
    store = SQLiteStore(data_directory())
    host_tools = HostTools(working_directory)
    watcher = ProcessWatcher(host_tools.process_owner)
    state = OrganizationState(
        working_directory,
        persisted=store.load_organization(),
        on_persist=store.save_organization,
    )
    model_runtime = create_model_runtime(
        stored_config=store.load_model_config(),
        stored_observability_config=store.load_observability_config(),
        on_configure=store.save_model_config,
        on_configure_observability=store.save_observability_config,
    )
    runtime = AgentRuntime(
        state,
        model_runtime,
        host_tools,
    )
    runtime.start()
    try:
        serve(
            sys.stdin,
            sys.stdout,
            state,
            runtime.stop,
            model_runtime,
        )
    finally:
        runtime.stop()
        model_runtime.shutdown()
        watcher.close()


if __name__ == "__main__":
    main()
