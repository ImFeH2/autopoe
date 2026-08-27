import os
from pathlib import Path

from PyInstaller.utils.hooks import copy_metadata


datas = copy_metadata("pydantic-ai-slim", recursive=True)
if host_binary := os.environ.get("HUDDOL_WSL_HOST_BUILD"):
    host_path = Path(host_binary)
    if not host_path.is_file():
        raise RuntimeError("WSL host bridge binary is unavailable")
    datas.append((str(host_path), "."))


a = Analysis(
    ["src/huddol/__main__.py"],
    pathex=["."],
    binaries=[],
    datas=datas,
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="huddol",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
