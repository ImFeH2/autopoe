from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from flowent.paths import WORKDIR_ENV_VAR, resolve_workdir

HOST_ENV_VAR = "FLOWENT_HOST"


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="flowent",
        description="Flowent",
    )
    subparsers = parser.add_subparsers(dest="command")
    apply_patch_parser = subparsers.add_parser("apply-patch", help=argparse.SUPPRESS)
    apply_patch_parser.add_argument("--cwd", required=True)
    subparsers.add_parser("doctor", help="Check system requirements")
    parser.add_argument(
        "--host",
        "--hostname",
        default=os.environ.get(HOST_ENV_VAR) or "127.0.0.1",
        help="Bind host (default: $FLOWENT_HOST or 127.0.0.1)",
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
    parser.add_argument(
        "--workdir",
        default="",
        help="Agent working directory (default: $FLOWENT_WORKDIR or current directory)",
    )
    args = parser.parse_args(argv)

    if args.command == "apply-patch":
        from flowent.patch import run_apply_patch_cli

        raise SystemExit(
            run_apply_patch_cli(cwd=Path(args.cwd), patch=sys.stdin.read())
        )

    if args.command == "doctor":
        from flowent.sandbox import SANDBOX_INSTALL_HINT, sandbox_binary
        from flowent.system_tools import RIPGREP_INSTALL_HINT, ripgrep_binary

        bwrap = sandbox_binary()
        rg = ripgrep_binary()

        if bwrap:
            print(f"Sandbox: {bwrap}")
        else:
            print(f"Sandbox: missing. {SANDBOX_INSTALL_HINT}", file=sys.stderr)

        if rg:
            print(f"Search: {rg}")
        else:
            print(f"Search: missing. {RIPGREP_INSTALL_HINT}", file=sys.stderr)

        raise SystemExit(0 if bwrap and rg else 1)

    if args.version:
        try:
            from importlib.metadata import version

            ver = version("flowent")
        except Exception:
            from flowent._version import __version__ as ver

        print(f"flowent {ver}")
        sys.exit(0)

    from flowent.logging import configure_logging

    configure_logging()
    try:
        workdir = resolve_workdir(args.workdir or None)
    except ValueError as error:
        parser.error(str(error))
    os.environ[WORKDIR_ENV_VAR] = str(workdir)

    import logging

    logger = logging.getLogger("flowent.cli")
    logger.info("Starting Flowent on %s:%s", args.host, args.port)

    import uvicorn

    uvicorn.run(
        "flowent.app:app",
        host=args.host,
        port=args.port,
    )


if __name__ == "__main__":
    main()
