from __future__ import annotations

import asyncio
import os
import signal
import subprocess
from collections.abc import Mapping
from contextlib import suppress
from pathlib import Path
from typing import Protocol

from flowent.sandboxing.core import ProcessLaunchOptions, SandboxError


class RunningProcess(Protocol):
    pid: int

    @property
    def returncode(self) -> int | None: ...

    def kill(self) -> object: ...

    def terminate(self) -> object: ...


def run_process(
    args: list[str],
    *,
    cwd: Path,
    environment: Mapping[str, str],
    input_text: str | None,
    timeout: float,
    options: ProcessLaunchOptions,
) -> subprocess.CompletedProcess[str]:
    with _create_sync_process(
        args,
        cwd=cwd,
        environment=environment,
        input_enabled=input_text is not None,
        options=options,
    ) as process:
        try:
            stdout, stderr = process.communicate(input=input_text, timeout=timeout)
        except subprocess.TimeoutExpired as error:
            terminate_process_tree(process, options, force=True)
            stdout, stderr = process.communicate()
            raise subprocess.TimeoutExpired(
                args,
                timeout,
                output=stdout,
                stderr=stderr,
            ) from error
        return subprocess.CompletedProcess(
            args=args,
            returncode=process.returncode,
            stdout=stdout,
            stderr=stderr,
        )


def run_legacy_process(
    args: list[str],
    *,
    cwd: Path,
    environment: Mapping[str, str],
    input_text: str | None,
    timeout: float,
    options: ProcessLaunchOptions,
) -> subprocess.CompletedProcess[str]:
    if os.name == "nt":
        if options.pass_fds:
            raise SandboxError(
                "Windows command protection cannot inherit POSIX file descriptors."
            )
        return subprocess.run(
            args,
            check=False,
            cwd=cwd,
            env=environment,
            input=input_text,
            capture_output=True,
            text=True,
            timeout=timeout,
            creationflags=options.creationflags,
        )
    return subprocess.run(
        args,
        check=False,
        cwd=cwd,
        env=environment,
        input=input_text,
        capture_output=True,
        text=True,
        timeout=timeout,
        start_new_session=options.start_new_session,
        pass_fds=options.pass_fds,
    )


def _create_sync_process(
    args: list[str],
    *,
    cwd: Path,
    environment: Mapping[str, str],
    input_enabled: bool,
    options: ProcessLaunchOptions,
) -> subprocess.Popen[str]:
    if os.name == "nt":
        if options.pass_fds:
            raise SandboxError(
                "Windows command protection cannot inherit POSIX file descriptors."
            )
        return subprocess.Popen(
            args,
            cwd=cwd,
            env=environment,
            stdin=subprocess.PIPE if input_enabled else None,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            creationflags=options.creationflags,
        )
    return subprocess.Popen(
        args,
        cwd=cwd,
        env=environment,
        stdin=subprocess.PIPE if input_enabled else None,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=options.start_new_session,
        pass_fds=options.pass_fds,
    )


async def create_process(
    args: list[str],
    *,
    cwd: Path,
    environment: Mapping[str, str],
    input_enabled: bool,
    options: ProcessLaunchOptions,
) -> asyncio.subprocess.Process:
    if os.name == "nt":
        if options.pass_fds:
            raise SandboxError(
                "Windows command protection cannot inherit POSIX file descriptors."
            )
        return await asyncio.create_subprocess_exec(
            *args,
            cwd=cwd,
            env=environment,
            stdin=asyncio.subprocess.PIPE if input_enabled else None,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            creationflags=options.creationflags,
        )
    return await asyncio.create_subprocess_exec(
        *args,
        cwd=cwd,
        env=environment,
        stdin=asyncio.subprocess.PIPE if input_enabled else None,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        start_new_session=options.start_new_session,
        pass_fds=options.pass_fds,
    )


def terminate_process_tree(
    process: RunningProcess,
    options: ProcessLaunchOptions,
    *,
    force: bool,
) -> None:
    if process.returncode is not None:
        return
    if os.name != "nt" and options.start_new_session:
        selected_signal = signal.SIGKILL if force else signal.SIGTERM
        with suppress(ProcessLookupError):
            os.killpg(process.pid, selected_signal)
        return
    with suppress(ProcessLookupError):
        if force:
            process.kill()
        else:
            process.terminate()
