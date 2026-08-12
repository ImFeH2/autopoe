from __future__ import annotations

import sys
from pathlib import Path

from flowent.domain import OrganizationState
from flowent.model_runner import create_runner
from flowent.protocol import serve
from flowent.runtime import AgentRuntime


def main() -> None:
    working_directory = Path.cwd()
    state = OrganizationState(working_directory)
    runtime = AgentRuntime(state, create_runner(working_directory))
    runtime.start()
    try:
        serve(sys.stdin, sys.stdout, state)
    finally:
        runtime.stop()


if __name__ == "__main__":
    main()
