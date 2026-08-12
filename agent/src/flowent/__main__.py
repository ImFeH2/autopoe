from __future__ import annotations

import sys
from pathlib import Path

from flowent.domain import OrganizationState
from flowent.protocol import serve


def main() -> None:
    serve(sys.stdin, sys.stdout, OrganizationState(Path.cwd()))


if __name__ == "__main__":
    main()
