import os

from PyInstaller.utils.hooks import copy_metadata


is_e2e = os.environ.get("FLOWENT_SIDECAR_BUILD") == "e2e"
entrypoint = "e2e_support/entrypoint.py" if is_e2e else "src/flowent/__main__.py"

a = Analysis(
    [entrypoint],
    pathex=["."],
    binaries=[],
    datas=copy_metadata("pydantic-ai-slim", recursive=True),
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
    name="flowent-agent",
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
