import asyncio
import hashlib
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class WorkspaceConfiguration(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str = Field(min_length=1)
    mode: Literal["direct", "worktree"] = "worktree"
    base_ref: str = Field(default="HEAD", min_length=1, max_length=240)


class WorkspaceInfo(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str
    source_path: str
    mode: Literal["direct", "worktree"]
    base_ref: str
    is_git: bool


@dataclass
class Workspace:
    root: Path
    source_root: Path
    mode: Literal["direct", "worktree"]
    base_ref: str
    is_git: bool
    write_lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    @property
    def info(self) -> WorkspaceInfo:
        return WorkspaceInfo(
            path=str(self.root),
            source_path=str(self.source_root),
            mode=self.mode,
            base_ref=self.base_ref,
            is_git=self.is_git,
        )

    def resolve_path(self, relative_path: str) -> Path:
        candidate = Path(relative_path)
        if candidate.is_absolute():
            raise ValueError("Workspace paths must be relative")
        resolved = (self.root / candidate).resolve()
        if not resolved.is_relative_to(self.root):
            raise ValueError("Path is outside the workspace")
        return resolved

    async def git_status(self) -> str:
        self.require_git()
        return await run_process(
            ["git", "status", "--short", "--branch"],
            self.root,
            30,
        )

    async def git_diff(self, staged: bool = False) -> str:
        self.require_git()
        command = ["git", "diff", "--no-ext-diff", "--no-textconv"]
        if staged:
            command.append("--staged")
        return await run_process(command, self.root, 30)

    def require_git(self) -> None:
        if not self.is_git:
            raise ValueError("Workspace is not a Git repository")


class WorkspaceManager:
    def __init__(self, data_dir: Path) -> None:
        self.root = data_dir / "worktrees"

    async def prepare(
        self,
        run_id: str,
        configuration: WorkspaceConfiguration,
    ) -> Workspace:
        source = Path(configuration.path).expanduser().resolve()
        if not source.is_dir():
            raise ValueError(f"Workspace does not exist: {source}")
        git_root = await discover_git_root(source)
        if configuration.mode == "direct":
            return Workspace(
                root=source,
                source_root=git_root or source,
                mode="direct",
                base_ref=configuration.base_ref,
                is_git=git_root is not None,
            )
        if git_root is None:
            raise ValueError("Worktree mode requires a Git repository")
        digest = hashlib.sha256(run_id.encode()).hexdigest()[:20]
        destination = (self.root / digest).resolve()
        if destination.exists():
            raise ValueError(f"Workflow worktree already exists: {destination}")
        destination.parent.mkdir(parents=True, exist_ok=True)
        await run_process(
            [
                "git",
                "-C",
                str(git_root),
                "worktree",
                "add",
                "--detach",
                str(destination),
                configuration.base_ref,
            ],
            git_root,
            60,
        )
        return Workspace(
            root=destination,
            source_root=git_root,
            mode="worktree",
            base_ref=configuration.base_ref,
            is_git=True,
        )

    async def open_direct(self, path: str) -> Workspace:
        return await self.prepare(
            f"direct:{path}",
            WorkspaceConfiguration(path=path, mode="direct"),
        )


async def discover_git_root(path: Path) -> Path | None:
    process = await asyncio.create_subprocess_exec(
        "git",
        "-C",
        str(path),
        "rev-parse",
        "--show-toplevel",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
        env=sanitized_environment(),
    )
    stdout, _ = await process.communicate()
    if process.returncode != 0:
        return None
    return Path(stdout.decode(errors="replace").strip()).resolve()


async def run_process(
    command: list[str],
    cwd: Path,
    timeout_seconds: float,
) -> str:
    process = await asyncio.create_subprocess_exec(
        *command,
        cwd=cwd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        env=sanitized_environment(),
    )
    try:
        async with asyncio.timeout(timeout_seconds):
            stdout, _ = await process.communicate()
    except TimeoutError:
        process.kill()
        await process.wait()
        raise RuntimeError(f"Command timed out: {command[0]}") from None
    output = stdout.decode(errors="replace")
    if process.returncode != 0:
        message = (
            output.strip() or f"Command failed with exit code {process.returncode}"
        )
        raise RuntimeError(message)
    return output


def sanitized_environment() -> dict[str, str]:
    exact = {
        "CARGO_HOME",
        "COMSPEC",
        "GIT_CONFIG_GLOBAL",
        "GIT_CONFIG_NOSYSTEM",
        "HOME",
        "LANG",
        "NPM_CONFIG_USERCONFIG",
        "PATH",
        "PATHEXT",
        "PNPM_HOME",
        "RUSTUP_HOME",
        "SHELL",
        "SYSTEMROOT",
        "TEMP",
        "TERM",
        "TMP",
        "TMPDIR",
        "USER",
        "USERNAME",
        "UV_CACHE_DIR",
    }
    return {
        key: value
        for key, value in os.environ.items()
        if key in exact or key.startswith("LC_")
    }
