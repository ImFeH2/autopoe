from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from flowent.paths import WORKDIR_ENV_VAR, resolve_workdir

HOST_ENV_VAR = "FLOWENT_HOST"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="flowent",
        description="Flowent",
    )
    subparsers = parser.add_subparsers(dest="command")
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
    return parser


def run_apply_patch(args: argparse.Namespace) -> None:
    from flowent.patch import run_apply_patch_cli

    raise SystemExit(run_apply_patch_cli(cwd=Path(args.cwd), patch=sys.stdin.read()))


def run_internal_python() -> None:
    from flowent.runtime_commands import run_python_runner

    run_python_runner()
    raise SystemExit(0)


def run_internal_command(argv: list[str]) -> None:
    command = argv[0]
    parser = argparse.ArgumentParser(prog=f"flowent {command}", add_help=False)
    if command == "apply-patch":
        parser.add_argument("--cwd", required=True)
        run_apply_patch(parser.parse_args(argv[1:]))
    parser.parse_args(argv[1:])
    run_internal_python()


def run_doctor() -> None:
    from flowent.sandbox import SandboxRunner, SandboxState
    from flowent.system_tools import (
        RuntimeFilesState,
        SystemToolState,
        ripgrep_status,
        runtime_files_status,
    )

    protection = SandboxRunner().status
    search = ripgrep_status()
    runtime_files = runtime_files_status()

    if protection.available:
        state = (
            "ready with limited features"
            if protection.state is SandboxState.DEGRADED
            else "ready"
        )
        source = _display_source(protection.source)
        detail = _source_detail(source, protection.executable)
        print(f"Command protection: {state}{detail}")
    elif protection.state is SandboxState.SETUP_REQUIRED:
        print(
            "Command protection: setup required "
            "(approve Windows command protection setup when prompted)",
            file=sys.stderr,
        )
    else:
        print("Command protection: unavailable", file=sys.stderr)

    if search.available:
        detail = _source_detail(search.source, search.executable)
        print(f"File search: ready{detail}")
    elif search.state is SystemToolState.INVALID:
        print("File search: built-in file verification failed", file=sys.stderr)
    else:
        print("File search: unavailable", file=sys.stderr)

    if runtime_files.state is RuntimeFilesState.AVAILABLE:
        noun = "file" if runtime_files.resource_count == 1 else "files"
        kind = "included" if runtime_files.source == "container" else "built-in"
        print(
            "Runtime files: ready "
            f"({runtime_files.resource_count} {kind} {noun} verified)"
        )
    elif runtime_files.state is RuntimeFilesState.DEVELOPMENT:
        print("Runtime files: ready (system files for development)")
    elif runtime_files.state is RuntimeFilesState.MISSING:
        print("Runtime files: unavailable", file=sys.stderr)
    else:
        print("Runtime files: built-in file verification failed", file=sys.stderr)

    ready = protection.available and search.available and runtime_files.available
    raise SystemExit(0 if ready else 1)


def _display_source(source: str | None) -> str | None:
    if source == "bundled":
        return "built-in"
    if source in {"built-in", "system"}:
        return source
    return None


def _source_detail(source: str | None, executable: Path | None) -> str:
    if source is not None and executable is not None:
        return f" ({source}: {executable})"
    if source is not None:
        return f" ({source})"
    if executable is not None:
        return f" ({executable})"
    return ""


def show_version() -> None:
    try:
        from importlib.metadata import version

        ver = version("flowent")
    except Exception:
        from flowent._version import __version__ as ver

    print(f"flowent {ver}")
    raise SystemExit(0)


def run_server(args: argparse.Namespace, parser: argparse.ArgumentParser) -> None:
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


def main(argv: list[str] | None = None) -> None:
    arguments = list(sys.argv[1:] if argv is None else argv)
    if arguments and arguments[0] in {"apply-patch", "_run-python"}:
        run_internal_command(arguments)
    parser = build_parser()
    args = parser.parse_args(arguments)

    if args.command == "doctor":
        run_doctor()

    if args.version:
        show_version()

    run_server(args, parser)


if __name__ == "__main__":
    main()
