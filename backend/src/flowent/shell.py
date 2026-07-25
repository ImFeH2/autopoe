from __future__ import annotations

import ctypes
import os
import platform
import shutil
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path, PureWindowsPath


@dataclass(frozen=True)
class ShellInvocation:
    args: list[str]
    env: dict[str, str]
    shell: str


def executable_path(path: Path) -> str | None:
    if path.is_file() and os.access(path, os.X_OK):
        return str(path.resolve(strict=False))
    return None


def executable_command_path(command: str) -> str | None:
    resolved = shutil.which(command)
    if resolved is None:
        return None
    return executable_path(Path(resolved))


def shell_path(raw_shell: str) -> str | None:
    raw_shell = raw_shell.strip()
    if not raw_shell:
        return None
    expanded = Path(raw_shell).expanduser()
    if expanded.is_absolute():
        return executable_path(expanded)
    return executable_command_path(raw_shell)


def user_default_shell() -> str | None:
    try:
        import pwd
    except ImportError:
        return None

    try:
        shell = pwd.getpwuid(os.getuid()).pw_shell
    except (AttributeError, KeyError, OSError):
        return None
    return shell_path(shell)


def environment_shell() -> str | None:
    return shell_path(os.environ.get("SHELL", ""))


FALLBACK_SHELL_PATHS = {
    "bash": [Path("/bin/bash"), Path("/usr/bin/bash")],
    "sh": [Path("/bin/sh"), Path("/usr/bin/sh")],
}
WINDOWS_POWERSHELL_NAMES = {"powershell", "powershell.exe", "pwsh", "pwsh.exe"}
WINDOWS_POWERSHELL_ARGUMENTS = [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
]
WINDOWS_CMD_ARGUMENTS = ["/d", "/s", "/c"]
WINDOWS_DIRECTORY_BUFFER_SIZE = 260


def fallback_shell(command: str) -> str | None:
    shell = executable_command_path(command)
    if shell is not None:
        return shell
    for fallback in FALLBACK_SHELL_PATHS.get(command, []):
        shell = executable_path(fallback)
        if shell is not None:
            return shell
    return None


def native_windows_directory_reader() -> Callable[[object, int], int] | None:
    loader = getattr(ctypes, "WinDLL", None)
    if loader is None:
        return None
    try:
        reader = loader("kernel32.dll", use_last_error=True).GetSystemWindowsDirectoryW
    except (AttributeError, OSError):
        return None
    reader.argtypes = [ctypes.c_wchar_p, ctypes.c_uint]
    reader.restype = ctypes.c_uint
    return reader


def windows_system_directory(
    reader: Callable[[object, int], int] | None = None,
) -> str | None:
    read_directory = reader or native_windows_directory_reader()
    if read_directory is None:
        return None
    size = WINDOWS_DIRECTORY_BUFFER_SIZE
    buffer = ctypes.create_unicode_buffer(size)
    length = read_directory(buffer, size)
    if length >= size:
        size = length + 1
        buffer = ctypes.create_unicode_buffer(size)
        length = read_directory(buffer, size)
    if length == 0 or length >= size:
        return None
    return buffer.value or None


def windows_system_shell_paths() -> tuple[str, str]:
    directory = windows_system_directory()
    if directory is None:
        if os.name == "nt":
            raise OSError("Windows system directory is unavailable.")
        directory = "C:/Windows"
    root = PureWindowsPath(directory)
    if root.drive and not root.root and len(root.parts) == 1:
        root = PureWindowsPath(f"{root.drive}/")
    if not root.is_absolute():
        raise OSError("Windows system directory is not absolute.")
    powershell = root / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
    cmd = root / "System32" / "cmd.exe"
    return str(powershell), str(cmd)


def windows_system_cmd() -> str:
    return windows_system_shell_paths()[1]


def windows_default_shell() -> str:
    powershell, cmd = windows_system_shell_paths()
    shell = executable_path(Path(powershell))
    return shell or cmd


def is_windows() -> bool:
    return platform.system() == "Windows"


def is_powershell(shell: str) -> bool:
    return PureWindowsPath(shell).name.lower() in WINDOWS_POWERSHELL_NAMES


def default_shell() -> str:
    if is_windows():
        return windows_default_shell()
    for shell in [user_default_shell(), environment_shell()]:
        if shell is not None:
            return shell
    for command in ["bash", "sh"]:
        shell = fallback_shell(command)
        if shell is not None:
            return shell
    return "sh"


def shell_arguments(shell: str) -> list[str]:
    if not is_windows():
        return [shell, "-c"]
    if is_powershell(shell):
        return [shell, *WINDOWS_POWERSHELL_ARGUMENTS]
    return [shell, *WINDOWS_CMD_ARGUMENTS]


def shell_invocation(command: str) -> ShellInvocation:
    shell = default_shell()
    env = {"SHELL": shell}
    if is_windows() and not is_powershell(shell):
        env["COMSPEC"] = shell
    return ShellInvocation(
        args=[*shell_arguments(shell), command],
        env=env,
        shell=shell,
    )


def shell_invocation_description() -> str:
    return " ".join(shell_arguments(default_shell()))
