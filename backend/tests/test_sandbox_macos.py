from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

from flowent.sandboxing import (
    SandboxError,
    SandboxFailureKind,
    SandboxPolicy,
    SandboxState,
)
from flowent.sandboxing.macos import (
    SEATBELT_EXECUTABLE,
    MacOSSandboxBackend,
    SeatbeltCapabilityProbe,
)


def probe_command(args: list[str]) -> list[str]:
    return args[args.index("--") + 1 :]


def test_macos_backend_reports_available_after_capability_probe() -> None:
    observed: list[Path] = []

    def capability_probe(executable: Path) -> bool:
        observed.append(executable)
        return True

    backend = MacOSSandboxBackend(capability_probe=capability_probe)

    status = backend.status()

    assert observed == [SEATBELT_EXECUTABLE]
    assert status.state is SandboxState.AVAILABLE
    assert status.executable == SEATBELT_EXECUTABLE
    assert status.source == "system"
    assert {"filesystem", "process_tree"} <= status.capabilities


def test_macos_backend_reports_structured_unavailable_when_probe_returns_false() -> (
    None
):
    backend = MacOSSandboxBackend(capability_probe=lambda executable: False)

    status = backend.status()

    assert status.state is SandboxState.UNAVAILABLE
    assert status.failure is not None
    assert status.failure.kind is SandboxFailureKind.BACKEND_UNAVAILABLE
    assert ("reason", "capability_probe_failed") in status.failure.details


def test_macos_backend_reports_structured_unavailable_when_probe_raises() -> None:
    def capability_probe(executable: Path) -> bool:
        raise OSError("probe failed")

    backend = MacOSSandboxBackend(capability_probe=capability_probe)

    status = backend.status()

    assert status.state is SandboxState.UNAVAILABLE
    assert status.failure is not None
    assert status.failure.kind is SandboxFailureKind.BACKEND_UNAVAILABLE
    assert ("reason", "capability_probe_error") in status.failure.details
    assert ("error", "OSError") in status.failure.details


def test_macos_backend_fails_closed_when_capability_probe_fails(
    tmp_path: Path,
) -> None:
    backend = MacOSSandboxBackend(capability_probe=lambda executable: False)

    with pytest.raises(SandboxError) as error:
        backend.prepare(["true"], SandboxPolicy(cwd=tmp_path))

    assert error.value.failure.kind is SandboxFailureKind.BACKEND_UNAVAILABLE


def test_macos_backend_builds_read_only_root_profile_with_parameterized_paths(
    tmp_path: Path,
) -> None:
    workspace = tmp_path / 'workspace-")\n(allow network*)'
    temporary = tmp_path / "temporary"
    approved = tmp_path / "approved"
    workspace.mkdir()
    temporary.mkdir()
    approved.mkdir()
    backend = MacOSSandboxBackend(capability_probe=lambda executable: True)
    policy = SandboxPolicy(
        cwd=workspace,
        writable_roots=(approved,),
        temporary_roots=(temporary,),
        allow_network=False,
    )

    prepared = backend.prepare(["python", "task.py"], policy)

    profile = prepared.args[2]
    definitions = prepared.args[3:-3]
    assert prepared.args[:2] == [str(SEATBELT_EXECUTABLE), "-p"]
    assert prepared.args[-3:] == ["--", "python", "task.py"]
    assert "(deny default)" in profile
    assert "(allow file-read*)" in profile
    assert "(allow file-write*" in profile
    assert '(path "/dev/null")' in profile
    assert "(allow sysctl-read" in profile
    assert "com.apple.system.opendirectoryd.libinfo" in profile
    assert "(allow ipc-posix-sem)" in profile
    assert "com.apple.PowerManagement.control" in profile
    assert "(allow pseudo-tty)" in profile
    assert 'literal "/dev/ptmx"' in profile
    assert profile.count('(subpath (param "WRITE_ROOT_') == 3
    assert "(allow network*)" not in profile
    assert str(workspace) not in profile
    assert definitions == [
        f"-DWRITE_ROOT_0={policy.cwd}",
        f"-DWRITE_ROOT_1={temporary.resolve()}",
        f"-DWRITE_ROOT_2={approved.resolve()}",
    ]
    assert not prepared.seccomp_available


@pytest.mark.parametrize(("allow_network", "expected"), [(False, False), (True, True)])
def test_macos_backend_applies_network_policy(
    tmp_path: Path,
    allow_network: bool,
    expected: bool,
) -> None:
    backend = MacOSSandboxBackend(capability_probe=lambda executable: True)

    prepared = backend.prepare(
        ["true"],
        SandboxPolicy(
            cwd=tmp_path,
            temporary_roots=(),
            allow_network=allow_network,
        ),
    )

    profile = prepared.args[2]
    assert ("(allow network*)" in profile) is expected
    for marker in (
        "(allow system-socket",
        "com.apple.SecurityServer",
        "com.apple.networkd",
        "com.apple.ocspd",
        "com.apple.trustd.agent",
        "com.apple.SystemConfiguration.DNSConfiguration",
        "com.apple.SystemConfiguration.configd",
    ):
        assert (marker in profile) is expected


def test_macos_backend_adds_darwin_user_temporary_root(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = tmp_path / "workspace"
    darwin_temporary = tmp_path / "darwin-temporary"
    workspace.mkdir()
    darwin_temporary.mkdir()
    monkeypatch.setattr(
        "flowent.sandboxing.macos.tempfile.gettempdir",
        lambda: str(darwin_temporary),
    )
    backend = MacOSSandboxBackend(capability_probe=lambda executable: True)

    prepared = backend.prepare(["true"], SandboxPolicy(cwd=workspace))

    assert f"-DWRITE_ROOT_2={darwin_temporary.resolve()}" in prepared.args


def test_macos_backend_canonicalizes_symlinked_writable_roots(
    tmp_path: Path,
) -> None:
    workspace = tmp_path / "workspace"
    target = tmp_path / "target"
    alias = tmp_path / "alias"
    workspace.mkdir()
    target.mkdir()
    alias.symlink_to(target, target_is_directory=True)
    backend = MacOSSandboxBackend(capability_probe=lambda executable: True)
    policy = SandboxPolicy(
        cwd=workspace,
        writable_roots=(alias,),
        temporary_roots=(),
    )

    prepared = backend.prepare(["true"], policy)

    assert f"-DWRITE_ROOT_1={target.resolve()}" in prepared.args
    assert all(str(alias) not in argument for argument in prepared.args)


def test_seatbelt_capability_probe_checks_allowed_and_symlink_escape_writes(
    tmp_path: Path,
) -> None:
    executable = tmp_path / "sandbox-exec"
    executable.touch()
    calls = 0
    profiles: list[str] = []

    def runner(args: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        nonlocal calls
        calls += 1
        profiles.append(args[2])
        command = probe_command(args)
        assert command[:3] == [sys.executable, "-I", "-c"]
        payload = json.loads(str(kwargs["input"]))
        assert "platform.machine()" in payload["code"]
        assert "os.openpty()" in payload["code"]
        Path(payload["inputs"][0]).write_text("allowed")
        return subprocess.CompletedProcess(args, 0, "", "")

    probe = SeatbeltCapabilityProbe(cache={}, runner=runner)

    assert probe.supports(executable)
    assert probe.supports(executable)
    assert calls == 2
    assert "(allow network*)" not in profiles[0]
    assert "(allow network*)" in profiles[1]


def test_seatbelt_capability_probe_rejects_escaped_write(
    tmp_path: Path,
) -> None:
    executable = tmp_path / "sandbox-exec"
    executable.touch()

    def runner(args: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        payload = json.loads(str(kwargs["input"]))
        Path(payload["inputs"][0]).write_text("allowed")
        Path(payload["inputs"][1]).write_text("escaped")
        return subprocess.CompletedProcess(args, 0, "", "")

    probe = SeatbeltCapabilityProbe(cache={}, runner=runner)

    assert not probe.supports(executable)


def test_seatbelt_capability_probe_rejects_unusable_network_policy(
    tmp_path: Path,
) -> None:
    executable = tmp_path / "sandbox-exec"
    executable.touch()
    calls = 0

    def runner(args: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        nonlocal calls
        calls += 1
        payload = json.loads(str(kwargs["input"]))
        Path(payload["inputs"][0]).write_text("allowed")
        return subprocess.CompletedProcess(args, 0 if calls == 1 else 1, "", "")

    probe = SeatbeltCapabilityProbe(cache={}, runner=runner)

    assert not probe.supports(executable)


def test_seatbelt_capability_probe_uses_frozen_runtime_entrypoint(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    executable = tmp_path / "sandbox-exec"
    executable.touch()
    commands: list[list[str]] = []
    monkeypatch.setattr(sys, "frozen", True, raising=False)

    def runner(args: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        commands.append(probe_command(args))
        payload = json.loads(str(kwargs["input"]))
        Path(payload["inputs"][0]).write_text("allowed")
        return subprocess.CompletedProcess(args, 0, "", "")

    probe = SeatbeltCapabilityProbe(cache={}, runner=runner)

    assert probe.supports(executable)
    assert commands == [[sys.executable, "_run-python"]] * 2


def test_macos_backend_rejects_empty_command(tmp_path: Path) -> None:
    backend = MacOSSandboxBackend(capability_probe=lambda executable: True)

    with pytest.raises(SandboxError) as error:
        backend.prepare([], SandboxPolicy(cwd=tmp_path))

    assert error.value.failure.kind is SandboxFailureKind.PREPARATION_FAILED


def test_macos_backend_classifies_policy_denial() -> None:
    backend = MacOSSandboxBackend(capability_probe=lambda executable: True)

    failure = backend.classify_result(1, "write: Operation not permitted")

    assert failure is not None
    assert failure.kind is SandboxFailureKind.POLICY_DENIED
