from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from flowent.sandbox import SandboxError
from flowent.sandboxing import (
    ExecutableResolver,
    ResourceResolutionError,
    ResourceSource,
    SandboxFailureKind,
    SandboxPolicy,
    SandboxState,
)
from flowent.sandboxing.linux import (
    SANDBOX_INSTALL_HINT,
    LinuxSandboxBackend,
    ProcMountProbe,
)


def executable(path: Path) -> Path:
    path.write_text("#!/bin/sh\nexit 0\n")
    path.chmod(0o700)
    return path


def test_executable_resolver_prefers_system_binary(tmp_path: Path) -> None:
    system = executable(tmp_path / "system-bwrap")
    bundled = executable(tmp_path / "bundled-bwrap")
    bundled_called = False

    def bundled_provider() -> Path:
        nonlocal bundled_called
        bundled_called = True
        return bundled

    resolver = ExecutableResolver(
        system_names=("bwrap", "bubblewrap"),
        bundled_provider=bundled_provider,
        which=lambda name: str(system) if name == "bwrap" else None,
    )

    result = resolver.resolve()

    assert result is not None
    assert result.path == system.resolve()
    assert result.source is ResourceSource.SYSTEM
    assert not bundled_called


def test_executable_resolver_uses_bundled_binary_when_system_is_missing(
    tmp_path: Path,
) -> None:
    bundled = executable(tmp_path / "bundled-bwrap")
    resolver = ExecutableResolver(
        system_names=("bwrap", "bubblewrap"),
        bundled_provider=lambda: bundled,
        which=lambda name: None,
    )

    result = resolver.resolve()

    assert result is not None
    assert result.path == bundled.resolve()
    assert result.source is ResourceSource.BUNDLED


def test_executable_resolver_rejects_invalid_bundled_binary(tmp_path: Path) -> None:
    bundled = tmp_path / "bundled-bwrap"
    bundled.write_text("not executable")
    resolver = ExecutableResolver(
        system_names=("bwrap",),
        bundled_provider=lambda: bundled,
        which=lambda name: None,
    )

    with pytest.raises(ResourceResolutionError):
        resolver.resolve()


def test_linux_backend_reports_structured_unavailable_status() -> None:
    resolver = ExecutableResolver(
        system_names=("bwrap",),
        bundled_provider=lambda: None,
        which=lambda name: None,
    )
    backend = LinuxSandboxBackend(resolver=resolver)

    status = backend.status()

    assert status.state is SandboxState.UNAVAILABLE
    assert status.failure is not None
    assert status.failure.kind is SandboxFailureKind.BACKEND_UNAVAILABLE
    assert SANDBOX_INSTALL_HINT in status.failure.message


def test_linux_backend_reports_bundled_executable_source(tmp_path: Path) -> None:
    bundled = executable(tmp_path / "bundled-bwrap")
    backend = LinuxSandboxBackend(
        resolver=ExecutableResolver(
            system_names=("bwrap",),
            bundled_provider=lambda: bundled,
            which=lambda name: None,
        )
    )

    status = backend.status()

    assert status.state is SandboxState.AVAILABLE
    assert status.executable == bundled.resolve()
    assert status.source == ResourceSource.BUNDLED.value


def test_linux_backend_reports_unavailable_when_capability_probe_fails(
    tmp_path: Path,
) -> None:
    bwrap = executable(tmp_path / "bwrap")

    def probe(path: Path) -> bool:
        raise OSError("User namespaces are unavailable")

    backend = LinuxSandboxBackend(
        resolver=ExecutableResolver(
            system_names=("bwrap",),
            bundled_provider=lambda: None,
            which=lambda name: str(bwrap),
        ),
        proc_mount_probe=probe,
    )

    status = backend.status()

    assert status.state is SandboxState.UNAVAILABLE
    assert status.failure is not None
    assert status.failure.kind is SandboxFailureKind.BACKEND_UNAVAILABLE
    assert status.failure.details == (("reason", "capability_probe_failed"),)


def test_linux_backend_uses_bundled_binary_when_system_probe_fails(
    tmp_path: Path,
) -> None:
    system = executable(tmp_path / "system-bwrap")
    bundled = executable(tmp_path / "bundled-bwrap")
    probed: list[Path] = []

    def probe(path: Path) -> bool:
        probed.append(path)
        if path == system.resolve():
            raise OSError("System Bubblewrap cannot create a namespace")
        return True

    backend = LinuxSandboxBackend(
        resolver=ExecutableResolver(
            system_names=("bwrap",),
            bundled_provider=lambda: bundled,
            which=lambda name: str(system),
        ),
        proc_mount_probe=probe,
    )

    status = backend.status()

    assert status.state is SandboxState.AVAILABLE
    assert status.executable == bundled.resolve()
    assert status.source == ResourceSource.BUNDLED.value
    assert probed == [system.resolve(), bundled.resolve()]


def test_linux_backend_fails_closed_when_resource_is_missing(tmp_path: Path) -> None:
    resolver = ExecutableResolver(
        system_names=("bwrap",),
        bundled_provider=lambda: None,
        which=lambda name: None,
    )
    backend = LinuxSandboxBackend(resolver=resolver)

    with pytest.raises(SandboxError) as error:
        backend.prepare(["true"], SandboxPolicy(cwd=tmp_path))

    assert error.value.failure.kind is SandboxFailureKind.BACKEND_UNAVAILABLE


def test_linux_backend_builds_policy_and_registers_seccomp_resource(
    tmp_path: Path,
) -> None:
    bwrap = executable(tmp_path / "bwrap")
    workspace = tmp_path / "workspace"
    temporary = tmp_path / "temporary"
    writable = tmp_path / "writable"
    workspace.mkdir()
    temporary.mkdir()
    writable.mkdir()
    seccomp_file = CloseTrackingFile(51)
    backend = LinuxSandboxBackend(
        resolver=ExecutableResolver(
            system_names=("bwrap",),
            bundled_provider=lambda: None,
            which=lambda name: str(bwrap),
        ),
        proc_mount_probe=lambda path: True,
        seccomp_exporter=lambda: seccomp_file,
    )
    policy = SandboxPolicy(
        cwd=workspace,
        writable_roots=(writable,),
        temporary_roots=(temporary,),
        allow_network=False,
    )

    prepared = backend.prepare(["python", "task.py"], policy)

    assert prepared.args[0] == str(bwrap.resolve())
    assert prepared.args[6:8] == ["--proc", "/proc"]
    assert ["--bind", str(workspace), str(workspace)] in triplets(prepared.args)
    assert ["--bind", str(temporary), str(temporary)] in triplets(prepared.args)
    assert ["--bind", str(writable), str(writable)] in triplets(prepared.args)
    assert "--unshare-net" in prepared.args
    assert prepared.args[-3:] == ["--", "python", "task.py"]
    assert prepared.seccomp_available
    assert prepared.pass_fds == (51,)

    prepared.close()
    prepared.close()

    assert seccomp_file.close_count == 1


def test_linux_backend_omits_proc_and_missing_writable_root(tmp_path: Path) -> None:
    bwrap = executable(tmp_path / "bwrap")
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    missing = tmp_path / "missing"
    backend = LinuxSandboxBackend(
        resolver=ExecutableResolver(
            system_names=("bwrap",),
            bundled_provider=lambda: None,
            which=lambda name: str(bwrap),
        ),
        proc_mount_probe=lambda path: False,
        seccomp_exporter=lambda: None,
    )

    prepared = backend.prepare(
        ["true"],
        SandboxPolicy(
            cwd=workspace,
            writable_roots=(missing,),
            temporary_roots=(),
        ),
    )

    assert "--proc" not in prepared.args
    assert str(missing) not in prepared.args
    assert not missing.exists()
    assert not prepared.seccomp_available


def test_linux_backend_closes_seccomp_resource_when_preparation_fails(
    tmp_path: Path,
) -> None:
    bwrap = executable(tmp_path / "bwrap")
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    seccomp_file = BrokenDescriptorFile()
    backend = LinuxSandboxBackend(
        resolver=ExecutableResolver(
            system_names=("bwrap",),
            bundled_provider=lambda: None,
            which=lambda name: str(bwrap),
        ),
        proc_mount_probe=lambda path: False,
        seccomp_exporter=lambda: seccomp_file,
    )

    with pytest.raises(OSError):
        backend.prepare(
            ["true"],
            SandboxPolicy(cwd=workspace, temporary_roots=()),
        )

    assert seccomp_file.close_count == 1


def test_proc_mount_probe_caches_result_per_executable(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    bwrap = executable(tmp_path / "bwrap")
    calls = 0

    def fake_run(*args: object, **kwargs: object) -> subprocess.CompletedProcess[str]:
        nonlocal calls
        calls += 1
        return subprocess.CompletedProcess(
            args=[],
            returncode=1,
            stdout="",
            stderr="bwrap: Can't mount proc on /newroot/proc: Operation not permitted",
        )

    monkeypatch.setattr(subprocess, "run", fake_run)
    probe = ProcMountProbe()

    assert not probe.supports(bwrap, {})
    assert not probe.supports(bwrap, {})
    assert calls == 1


def test_proc_mount_probe_rejects_non_proc_startup_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    bwrap = executable(tmp_path / "bwrap")

    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *args, **kwargs: subprocess.CompletedProcess(
            args=[],
            returncode=1,
            stdout="",
            stderr="bwrap: No permissions to create new namespace",
        ),
    )

    with pytest.raises(OSError, match="could not start"):
        ProcMountProbe().supports(bwrap, {})


def test_linux_backend_classifies_policy_denial() -> None:
    backend = LinuxSandboxBackend(
        resolver=ExecutableResolver(
            system_names=("bwrap",),
            bundled_provider=lambda: None,
            which=lambda name: None,
        )
    )

    failure = backend.classify_result(1, "cannot create file: Read-only file system")

    assert failure is not None
    assert failure.kind is SandboxFailureKind.POLICY_DENIED


class CloseTrackingFile:
    def __init__(self, descriptor: int) -> None:
        self.descriptor = descriptor
        self.close_count = 0

    def fileno(self) -> int:
        return self.descriptor

    def close(self) -> None:
        self.close_count += 1


class BrokenDescriptorFile:
    def __init__(self) -> None:
        self.close_count = 0

    def fileno(self) -> int:
        raise OSError("descriptor unavailable")

    def close(self) -> None:
        self.close_count += 1


def triplets(args: list[str]) -> list[list[str]]:
    return [args[index : index + 3] for index in range(len(args) - 2)]
