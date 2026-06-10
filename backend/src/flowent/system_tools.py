from __future__ import annotations

import shutil


class SystemToolError(RuntimeError):
    pass


RIPGREP_INSTALL_HINT = (
    "Install ripgrep and try again. Debian/Ubuntu: "
    "sudo apt-get install ripgrep. Fedora: sudo dnf install ripgrep. "
    "Arch: sudo pacman -S ripgrep."
)


def ripgrep_binary() -> str | None:
    return shutil.which("rg")


def ensure_ripgrep_available() -> str:
    rg = ripgrep_binary()
    if not rg:
        raise SystemToolError(f"Search is not available. {RIPGREP_INSTALL_HINT}")
    return rg
