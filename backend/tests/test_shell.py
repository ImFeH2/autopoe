import pytest

import flowent.shell as shell_module
from flowent.shell import ShellInvocation


@pytest.mark.parametrize("operating_system", ["Linux", "Darwin"])
def test_posix_shell_invocation_keeps_existing_behavior(
    operating_system, monkeypatch
) -> None:
    monkeypatch.setattr(shell_module.platform, "system", lambda: operating_system)
    monkeypatch.setattr(shell_module, "default_shell", lambda: "/bin/bash")

    invocation = shell_module.shell_invocation("printf 'ok'")

    assert invocation == ShellInvocation(
        args=["/bin/bash", "-c", "printf 'ok'"],
        env={"SHELL": "/bin/bash"},
        shell="/bin/bash",
    )
    assert shell_module.shell_invocation_description() == "/bin/bash -c"


def test_windows_shell_uses_fixed_system_powershell(monkeypatch) -> None:
    powershell = r"D:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
    candidates: list[str] = []

    def resolve(path) -> str:
        candidates.append(str(path))
        return powershell

    def unexpected_path_lookup(command: str) -> None:
        raise AssertionError(f"Unexpected PATH lookup: {command}")

    monkeypatch.setattr(shell_module.platform, "system", lambda: "Windows")
    monkeypatch.setattr(shell_module, "windows_system_directory", lambda: r"D:\Windows")
    monkeypatch.setattr(shell_module, "executable_path", resolve)
    monkeypatch.setattr(shell_module.shutil, "which", unexpected_path_lookup)
    monkeypatch.setenv("PATH", ".")
    monkeypatch.setenv("SYSTEMROOT", r"C:\untrusted")
    monkeypatch.setenv("COMSPEC", r"C:\untrusted\cmd.exe")
    monkeypatch.setenv("PROGRAMFILES", r"C:\untrusted")

    assert shell_module.default_shell() == powershell
    assert candidates == [powershell]


def test_windows_shell_falls_back_to_fixed_system_cmd(monkeypatch) -> None:
    powershell = r"D:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
    candidates: list[str] = []

    def resolve(path) -> None:
        candidates.append(str(path))
        return None

    monkeypatch.setattr(shell_module.platform, "system", lambda: "Windows")
    monkeypatch.setattr(shell_module, "windows_system_directory", lambda: r"D:\Windows")
    monkeypatch.setattr(shell_module, "executable_path", resolve)
    monkeypatch.setenv("SYSTEMROOT", r"C:\untrusted")
    monkeypatch.setenv("COMSPEC", r"C:\untrusted\cmd.exe")
    monkeypatch.setenv("PROGRAMFILES", r"C:\untrusted")

    assert shell_module.default_shell() == r"D:\Windows\System32\cmd.exe"
    assert candidates == [powershell]


def test_windows_system_directory_uses_native_api() -> None:
    directory = r"D:\Windows"
    calls: list[tuple[object | None, int]] = []

    def read_system_directory(buffer, size: int) -> int:
        calls.append((buffer, size))
        buffer.value = directory
        return len(directory)

    assert shell_module.windows_system_directory(read_system_directory) == directory
    assert calls[0][0] is not None
    assert calls[0][1] == 260


def test_windows_powershell_invocation_is_non_interactive_and_keeps_unicode(
    monkeypatch,
) -> None:
    powershell = r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
    command = "Write-Output '你好, Flowent'"
    monkeypatch.setattr(shell_module.platform, "system", lambda: "Windows")
    monkeypatch.setattr(shell_module, "default_shell", lambda: powershell)

    invocation = shell_module.shell_invocation(command)

    assert invocation == ShellInvocation(
        args=[
            powershell,
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            command,
        ],
        env={"SHELL": powershell},
        shell=powershell,
    )
    assert shell_module.shell_invocation_description() == (
        f"{powershell} -NoLogo -NoProfile -NonInteractive -Command"
    )


def test_windows_cmd_invocation_disables_autorun_and_keeps_unicode(monkeypatch) -> None:
    cmd = r"C:\Windows\System32\cmd.exe"
    command = "echo 你好, Flowent"
    monkeypatch.setattr(shell_module.platform, "system", lambda: "Windows")
    monkeypatch.setattr(shell_module, "default_shell", lambda: cmd)
    monkeypatch.setenv("SYSTEMROOT", r"C:\Windows")

    invocation = shell_module.shell_invocation(command)

    assert invocation == ShellInvocation(
        args=[cmd, "/d", "/s", "/c", command],
        env={"COMSPEC": cmd, "SHELL": cmd},
        shell=cmd,
    )
    assert shell_module.shell_invocation_description() == f"{cmd} /d /s /c"
