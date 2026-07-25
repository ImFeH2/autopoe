from __future__ import annotations

import os
from collections.abc import Mapping

DEFAULT_POSIX_SHELL_PATH = (
    "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
)
CORE_SHELL_ENVIRONMENT_NAMES = {
    "APPDATA",
    "COMSPEC",
    "HOME",
    "HOMEDRIVE",
    "HOMEPATH",
    "LANG",
    "LOCALAPPDATA",
    "LOGNAME",
    "PATH",
    "PATHEXT",
    "PROGRAMDATA",
    "PROGRAMFILES",
    "PROGRAMFILES(X86)",
    "PROGRAMW6432",
    "SHELL",
    "SYSTEMDRIVE",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "TMPDIR",
    "USER",
    "USERNAME",
    "USERPROFILE",
    "WINDIR",
}


def is_core_shell_environment_variable(name: str) -> bool:
    normalized = name.upper()
    return normalized in CORE_SHELL_ENVIRONMENT_NAMES or normalized.startswith("LC_")


def default_shell_path() -> str:
    if os.name == "nt":
        return os.defpath
    return DEFAULT_POSIX_SHELL_PATH


def build_shell_environment(
    overrides: Mapping[str, str] | None = None,
) -> dict[str, str]:
    environment = {
        name: value
        for name, value in os.environ.items()
        if is_core_shell_environment_variable(name)
    }
    path_name = next(
        (name for name in environment if name.upper() == "PATH"),
        None,
    )
    if path_name is None:
        environment["PATH"] = default_shell_path()
    elif not environment[path_name]:
        environment[path_name] = default_shell_path()
    if overrides is not None:
        for name, value in overrides.items():
            if os.name == "nt":
                for existing_name in tuple(environment):
                    if existing_name.upper() == name.upper():
                        environment.pop(existing_name)
            environment[name] = value
    return environment
