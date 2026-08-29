from __future__ import annotations

import ctypes
import secrets
import subprocess
from collections.abc import Sequence
from ctypes import wintypes
from pathlib import Path
from threading import Lock

TOKEN_ACCESS = 0x0001 | 0x0002 | 0x0008 | 0x0080 | 0x0100
TOKEN_FLAGS = 0x1 | 0x4 | 0x8
DACL_SECURITY_INFORMATION = 0x4
SE_FILE_OBJECT = 1
SET_ACCESS = 2
REVOKE_ACCESS = 4
TRUSTEE_IS_SID = 0
SUB_CONTAINERS_AND_OBJECTS_INHERIT = 0x3
MODIFY_ACCESS = 0x120089 | 0x120116 | 0x1200A0 | 0x10000
STARTF_USESTDHANDLES = 0x100
HANDLE_FLAG_INHERIT = 0x1
CREATE_UNICODE_ENVIRONMENT = 0x400
INFINITE = 0xFFFFFFFF


class SidAndAttributes(ctypes.Structure):
    _fields_ = [("Sid", ctypes.c_void_p), ("Attributes", wintypes.DWORD)]


class Trustee(ctypes.Structure):
    pass


Trustee._fields_ = [
    ("pMultipleTrustee", ctypes.POINTER(Trustee)),
    ("MultipleTrusteeOperation", ctypes.c_int),
    ("TrusteeForm", ctypes.c_int),
    ("TrusteeType", ctypes.c_int),
    ("ptstrName", wintypes.LPWSTR),
]


class ExplicitAccess(ctypes.Structure):
    _fields_ = [
        ("grfAccessPermissions", wintypes.DWORD),
        ("grfAccessMode", ctypes.c_int),
        ("grfInheritance", wintypes.DWORD),
        ("Trustee", Trustee),
    ]


class StartupInfo(ctypes.Structure):
    _fields_ = [
        ("cb", wintypes.DWORD),
        ("lpReserved", wintypes.LPWSTR),
        ("lpDesktop", wintypes.LPWSTR),
        ("lpTitle", wintypes.LPWSTR),
        ("dwX", wintypes.DWORD),
        ("dwY", wintypes.DWORD),
        ("dwXSize", wintypes.DWORD),
        ("dwYSize", wintypes.DWORD),
        ("dwXCountChars", wintypes.DWORD),
        ("dwYCountChars", wintypes.DWORD),
        ("dwFillAttribute", wintypes.DWORD),
        ("dwFlags", wintypes.DWORD),
        ("wShowWindow", wintypes.WORD),
        ("cbReserved2", wintypes.WORD),
        ("lpReserved2", ctypes.POINTER(ctypes.c_ubyte)),
        ("hStdInput", wintypes.HANDLE),
        ("hStdOutput", wintypes.HANDLE),
        ("hStdError", wintypes.HANDLE),
    ]


class ProcessInformation(ctypes.Structure):
    _fields_ = [
        ("hProcess", wintypes.HANDLE),
        ("hThread", wintypes.HANDLE),
        ("dwProcessId", wintypes.DWORD),
        ("dwThreadId", wintypes.DWORD),
    ]


_advapi = ctypes.WinDLL("advapi32", use_last_error=True)
_kernel = ctypes.WinDLL("kernel32", use_last_error=True)
_kernel.GetCurrentProcess.restype = wintypes.HANDLE
_kernel.GetStdHandle.argtypes = [wintypes.DWORD]
_kernel.GetStdHandle.restype = wintypes.HANDLE
_kernel.SetHandleInformation.argtypes = [
    wintypes.HANDLE,
    wintypes.DWORD,
    wintypes.DWORD,
]
_kernel.SetHandleInformation.restype = wintypes.BOOL
_kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
_kernel.WaitForSingleObject.restype = wintypes.DWORD
_kernel.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
_kernel.GetExitCodeProcess.restype = wintypes.BOOL
_kernel.CloseHandle.argtypes = [wintypes.HANDLE]
_kernel.CloseHandle.restype = wintypes.BOOL
_kernel.LocalFree.argtypes = [ctypes.c_void_p]
_kernel.LocalFree.restype = ctypes.c_void_p
_advapi.ConvertStringSidToSidW.argtypes = [
    wintypes.LPCWSTR,
    ctypes.POINTER(ctypes.c_void_p),
]
_advapi.ConvertStringSidToSidW.restype = wintypes.BOOL
_advapi.GetNamedSecurityInfoW.argtypes = [
    wintypes.LPWSTR,
    ctypes.c_int,
    wintypes.DWORD,
    ctypes.c_void_p,
    ctypes.c_void_p,
    ctypes.POINTER(ctypes.c_void_p),
    ctypes.c_void_p,
    ctypes.POINTER(ctypes.c_void_p),
]
_advapi.GetNamedSecurityInfoW.restype = wintypes.DWORD
_advapi.SetEntriesInAclW.argtypes = [
    wintypes.ULONG,
    ctypes.POINTER(ExplicitAccess),
    ctypes.c_void_p,
    ctypes.POINTER(ctypes.c_void_p),
]
_advapi.SetEntriesInAclW.restype = wintypes.DWORD
_advapi.SetNamedSecurityInfoW.argtypes = [
    wintypes.LPWSTR,
    ctypes.c_int,
    wintypes.DWORD,
    ctypes.c_void_p,
    ctypes.c_void_p,
    ctypes.c_void_p,
    ctypes.c_void_p,
]
_advapi.SetNamedSecurityInfoW.restype = wintypes.DWORD
_advapi.OpenProcessToken.argtypes = [
    wintypes.HANDLE,
    wintypes.DWORD,
    ctypes.POINTER(wintypes.HANDLE),
]
_advapi.OpenProcessToken.restype = wintypes.BOOL
_advapi.CreateRestrictedToken.argtypes = [
    wintypes.HANDLE,
    wintypes.DWORD,
    wintypes.DWORD,
    ctypes.c_void_p,
    wintypes.DWORD,
    ctypes.c_void_p,
    wintypes.DWORD,
    ctypes.POINTER(SidAndAttributes),
    ctypes.POINTER(wintypes.HANDLE),
]
_advapi.CreateRestrictedToken.restype = wintypes.BOOL
_advapi.CreateProcessAsUserW.argtypes = [
    wintypes.HANDLE,
    wintypes.LPCWSTR,
    wintypes.LPWSTR,
    ctypes.c_void_p,
    ctypes.c_void_p,
    wintypes.BOOL,
    wintypes.DWORD,
    ctypes.c_void_p,
    wintypes.LPCWSTR,
    ctypes.POINTER(StartupInfo),
    ctypes.POINTER(ProcessInformation),
]
_advapi.CreateProcessAsUserW.restype = wintypes.BOOL


def _raise_if_error(code: int) -> None:
    if code:
        raise ctypes.WinError(code)


def _require(value: int) -> None:
    if not value:
        raise ctypes.WinError(ctypes.get_last_error())


def _sid_pointer(value: str) -> ctypes.c_void_p:
    sid = ctypes.c_void_p()
    _require(_advapi.ConvertStringSidToSidW(value, ctypes.byref(sid)))
    return sid


def _change_ace(path: Path, sid: ctypes.c_void_p, mode: int) -> None:
    old_acl = ctypes.c_void_p()
    descriptor = ctypes.c_void_p()
    new_acl = ctypes.c_void_p()
    _raise_if_error(
        _advapi.GetNamedSecurityInfoW(
            str(path),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            None,
            None,
            ctypes.byref(old_acl),
            None,
            ctypes.byref(descriptor),
        )
    )
    try:
        trustee = Trustee(
            None,
            0,
            TRUSTEE_IS_SID,
            0,
            ctypes.cast(sid, wintypes.LPWSTR),
        )
        access = ExplicitAccess(
            MODIFY_ACCESS if mode == SET_ACCESS else 0,
            mode,
            SUB_CONTAINERS_AND_OBJECTS_INHERIT,
            trustee,
        )
        _raise_if_error(
            _advapi.SetEntriesInAclW(
                1,
                ctypes.byref(access),
                old_acl,
                ctypes.byref(new_acl),
            )
        )
        _raise_if_error(
            _advapi.SetNamedSecurityInfoW(
                str(path),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION,
                None,
                None,
                new_acl,
                None,
            )
        )
    finally:
        if new_acl:
            _kernel.LocalFree(new_acl)
        if descriptor:
            _kernel.LocalFree(descriptor)


class WindowsWriteAccess:
    def __init__(self, roots: Sequence[Path]) -> None:
        values = [secrets.randbits(30) + 1 for _ in range(4)]
        self.sid = "S-1-5-21-" + "-".join(str(value) for value in values)
        self._sid = _sid_pointer(self.sid)
        self._roots: tuple[Path, ...] = ()
        self._lock = Lock()
        self.configure(roots)

    def configure(self, roots: Sequence[Path]) -> None:
        updated = tuple(roots)
        with self._lock:
            added = tuple(path for path in updated if path not in self._roots)
            removed = tuple(path for path in self._roots if path not in updated)
            granted: list[Path] = []
            try:
                for path in added:
                    if path.is_dir():
                        _change_ace(path, self._sid, SET_ACCESS)
                        granted.append(path)
                for path in removed:
                    if path.exists():
                        _change_ace(path, self._sid, REVOKE_ACCESS)
            except OSError:
                for path in granted:
                    try:
                        _change_ace(path, self._sid, REVOKE_ACCESS)
                    except OSError:
                        pass
                raise
            self._roots = updated

    def close(self) -> None:
        with self._lock:
            roots = self._roots
            self._roots = ()
            sid = self._sid
            self._sid = ctypes.c_void_p()
        for path in roots:
            if path.exists():
                try:
                    _change_ace(path, sid, REVOKE_ACCESS)
                except OSError:
                    pass
        if sid:
            _kernel.LocalFree(sid)


def run_restricted_command(sid_text: str, argv: list[str], cwd: str) -> int:
    if not argv:
        raise ValueError("Sandbox command is required")
    sid = _sid_pointer(sid_text)
    everyone_sid = _sid_pointer("S-1-1-0")
    base_token = wintypes.HANDLE()
    restricted_token = wintypes.HANDLE()
    process = ProcessInformation()
    try:
        _require(
            _advapi.OpenProcessToken(
                _kernel.GetCurrentProcess(),
                TOKEN_ACCESS,
                ctypes.byref(base_token),
            )
        )
        restricting = (SidAndAttributes * 2)(
            SidAndAttributes(sid, 0),
            SidAndAttributes(everyone_sid, 0),
        )
        _require(
            _advapi.CreateRestrictedToken(
                base_token,
                TOKEN_FLAGS,
                0,
                None,
                0,
                None,
                2,
                restricting,
                ctypes.byref(restricted_token),
            )
        )
        startup = StartupInfo()
        startup.cb = ctypes.sizeof(startup)
        startup.dwFlags = STARTF_USESTDHANDLES
        startup.lpDesktop = "Winsta0\\Default"
        startup.hStdInput = _kernel.GetStdHandle(-10 & 0xFFFFFFFF)
        startup.hStdOutput = _kernel.GetStdHandle(-11 & 0xFFFFFFFF)
        startup.hStdError = _kernel.GetStdHandle(-12 & 0xFFFFFFFF)
        for handle in (
            startup.hStdInput,
            startup.hStdOutput,
            startup.hStdError,
        ):
            if handle:
                _require(
                    _kernel.SetHandleInformation(
                        handle,
                        HANDLE_FLAG_INHERIT,
                        HANDLE_FLAG_INHERIT,
                    )
                )
        command = ctypes.create_unicode_buffer(subprocess.list2cmdline(argv))
        _require(
            _advapi.CreateProcessAsUserW(
                restricted_token,
                None,
                command,
                None,
                None,
                True,
                CREATE_UNICODE_ENVIRONMENT,
                None,
                cwd,
                ctypes.byref(startup),
                ctypes.byref(process),
            )
        )
        if _kernel.WaitForSingleObject(process.hProcess, INFINITE) != 0:
            raise ctypes.WinError(ctypes.get_last_error())
        exit_code = wintypes.DWORD()
        _require(
            _kernel.GetExitCodeProcess(
                process.hProcess,
                ctypes.byref(exit_code),
            )
        )
        return exit_code.value
    finally:
        for handle in (
            process.hThread,
            process.hProcess,
            restricted_token,
            base_token,
        ):
            if handle:
                _kernel.CloseHandle(handle)
        if everyone_sid:
            _kernel.LocalFree(everyone_sid)
        if sid:
            _kernel.LocalFree(sid)
