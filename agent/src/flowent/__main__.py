from __future__ import annotations

import sys
from pathlib import Path

from flowent.domain import OrganizationState
from flowent.host_tools import HostTools, ProcessWatcher, watch_processes
from flowent.model_runner import create_runner
from flowent.persistence import SQLiteStore, data_directory
from flowent.protocol import serve
from flowent.runtime import AgentRuntime


def main() -> None:
    if len(sys.argv) == 3 and sys.argv[1] == "--process-watch":
        watch_processes(sys.argv[2], sys.stdin.buffer)
        return

    working_directory = Path.cwd().resolve()
    store = SQLiteStore(data_directory())
    host_tools = HostTools(working_directory)
    watcher = ProcessWatcher(host_tools.process_owner)
    state = OrganizationState(
        working_directory,
        persisted=store.load_organization(working_directory),
        on_persist=store.save_organization,
    )
    model_runtime = create_runner(
        working_directory,
        stored_config=store.load_model_config(working_directory),
        on_configure=lambda config: store.save_model_config(
            working_directory,
            config,
        ),
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
        watcher.close()


if __name__ == "__main__":
    main()
