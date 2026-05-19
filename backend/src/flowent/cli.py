from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="flowent",
        description="Flowent",
    )
    subparsers = parser.add_subparsers(dest="command")
    apply_patch_parser = subparsers.add_parser("apply-patch", help=argparse.SUPPRESS)
    apply_patch_parser.add_argument("--cwd", required=True)
    parser.add_argument(
        "--host",
        "--hostname",
        default=os.environ.get("HOSTNAME") or "0.0.0.0",
        help="Bind host (default: $HOSTNAME or 0.0.0.0)",
    )
    parser.add_argument(
        "--port",
        "-p",
        type=int,
        default=int(os.environ.get("PORT") or "6873"),
        help="Bind port (default: $PORT or 6873)",
    )
    parser.add_argument(
        "--version",
        "-v",
        action="store_true",
        help="Show version and exit",
    )
    parser.add_argument(
        "--app-data-dir",
        default="",
        help=argparse.SUPPRESS,
    )
    args = parser.parse_args(argv)

    if args.command == "apply-patch":
        from flowent.patch import run_apply_patch_cli

        raise SystemExit(
            run_apply_patch_cli(cwd=Path(args.cwd), patch=sys.stdin.read())
        )

    if args.version:
        try:
            from importlib.metadata import version

            ver = version("flowent")
        except Exception:
            from flowent._version import __version__ as ver

        print(f"flowent {ver}")
        sys.exit(0)

    import uvicorn

    uvicorn.run(
        "flowent.main:app",
        host=args.host,
        port=args.port,
    )


if __name__ == "__main__":
    main()
