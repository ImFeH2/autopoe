from __future__ import annotations

import sys
from pathlib import Path

from flowent.domain import OrganizationState
from flowent.host_tools import HostTools, ProcessWatcher, watch_processes
from flowent.model_runner import create_runner
from flowent.protocol import serve
from flowent.runtime import AgentRuntime


def main() -> None:
    if len(sys.argv) == 3 and sys.argv[1] == "--process-watch":
        watch_processes(sys.argv[2], sys.stdin.buffer)
        return

    working_directory = Path.cwd()
    host_tools = HostTools(working_directory)
    watcher = ProcessWatcher(host_tools.process_owner)
    state = OrganizationState(working_directory)
    runtime = AgentRuntime(
        state,
        create_runner(working_directory),
        host_tools,
    )
    runtime.start()
    try:
        serve(sys.stdin, sys.stdout, state, runtime.stop)
    finally:
        runtime.stop()
        watcher.close()


if __name__ == "__main__":
    main()
