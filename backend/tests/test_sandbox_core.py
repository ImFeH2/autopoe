from __future__ import annotations

import sys
from collections.abc import Mapping
from pathlib import Path

import pytest

import flowent.sandbox as sandbox_module
from flowent.sandboxing import (
    CleanupResource,
    PreparedProcess,
    ProcessLaunchOptions,
    SandboxBackend,
    SandboxError,
    SandboxFailure,
    SandboxFailureKind,
    SandboxPolicy,
    SandboxState,
    SandboxStatus,
    UnavailableSandboxBackend,
    build_shell_environment,
)


class CloseTracker:
    def __init__(self) -> None:
        self.close_count = 0

    def close(self) -> None:
        self.close_count += 1


class PassthroughBackend(SandboxBackend):
    name = "test"

    def status(self) -> SandboxStatus:
        return SandboxStatus(
            backend=self.name,
            state=SandboxState.AVAILABLE,
            capabilities=frozenset({"filesystem"}),
        )

    def prepare(
        self,
        command: list[str],
        policy: SandboxPolicy,
        *,
        include_seccomp: bool = True,
    ) -> PreparedProcess:
        return PreparedProcess(args=command, status=self.status())


def test_sandbox_policy_normalizes_and_deduplicates_writable_roots(
    tmp_path: Path,
) -> None:
    cwd = tmp_path / "workspace"
    temporary = tmp_path / "temporary"
    extra = tmp_path / "extra"

    policy = SandboxPolicy(
        cwd=cwd / ".." / "workspace",
        writable_roots=(extra, cwd, extra / "."),
        temporary_roots=(temporary,),
        allow_network=False,
    )

    assert policy.cwd == cwd
    assert policy.writable_roots == (cwd, temporary, extra)
    assert not policy.allow_network


def test_prepared_process_closes_resources_once_in_reverse_order() -> None:
    events: list[str] = []

    class Resource:
        def __init__(self, name: str) -> None:
            self.name = name

        def close(self) -> None:
            events.append(self.name)

    prepared = PreparedProcess(
        args=["command"],
        resources=(Resource("first"), Resource("second")),
        launch_options=ProcessLaunchOptions(
            start_new_session=True,
            pass_fds=(7,),
            creationflags=8,
        ),
    )

    prepared.close()
    prepared.close()

    assert events == ["second", "first"]
    assert prepared.pass_fds == (7,)
    assert prepared.launch_options.creationflags == 8


def test_cleanup_resource_runs_callback_once() -> None:
    calls = 0

    def cleanup() -> None:
        nonlocal calls
        calls += 1

    resource = CleanupResource(cleanup)

    resource.close()
    resource.close()

    assert calls == 1


def test_sandbox_status_exposes_stable_failure_kind() -> None:
    failure = SandboxFailure(
        kind=SandboxFailureKind.BACKEND_UNAVAILABLE,
        message="Command protection is unavailable.",
        backend="test",
    )

    status = SandboxStatus(
        backend="test",
        state=SandboxState.UNAVAILABLE,
        failure=failure,
    )

    assert not status.available
    assert status.failure is not None
    assert status.failure.kind.value == "backend_unavailable"


def test_sandbox_backend_default_failure_classification() -> None:
    backend = PassthroughBackend()

    assert backend.classify_result(0, "") is None
    failure = backend.classify_result(1, "failed")

    assert failure is not None
    assert failure.kind is SandboxFailureKind.COMMAND_FAILED
    assert failure.backend == "test"


def test_runner_classifies_result_with_prepared_metadata(tmp_path: Path) -> None:
    seen: dict[str, object] = {}

    class MetadataBackend(PassthroughBackend):
        def prepare(
            self,
            command: list[str],
            policy: SandboxPolicy,
            *,
            include_seccomp: bool = True,
        ) -> PreparedProcess:
            return PreparedProcess(
                args=command,
                status=self.status(),
                metadata={"status_file": tmp_path / "status.json"},
            )

        def classify_prepared_result(
            self,
            exit_code: int,
            stderr: str,
            metadata: Mapping[str, object],
        ) -> SandboxFailure | None:
            seen.update(metadata)
            return super().classify_prepared_result(exit_code, stderr, metadata)

    runner = sandbox_module.SandboxRunner(cwd=tmp_path, backend=MetadataBackend())

    result = runner.run([sys.executable, "-c", "print('ready')"])

    assert result.exit_code == 0
    assert result.stdout.strip() == "ready"
    assert seen == {"status_file": tmp_path / "status.json"}


def test_sandbox_backend_cannot_be_created_without_required_contract() -> None:
    class IncompleteBackend(SandboxBackend):
        name = "incomplete"

    with pytest.raises(TypeError):
        IncompleteBackend()


def test_unavailable_backend_fails_closed_with_structured_reason(
    tmp_path: Path,
) -> None:
    backend = UnavailableSandboxBackend("test", reason="setup_required")

    with pytest.raises(SandboxError) as error:
        backend.prepare(["command"], SandboxPolicy(cwd=tmp_path))

    failure = error.value.failure
    assert failure.kind is SandboxFailureKind.BACKEND_UNAVAILABLE
    assert failure.details == (("reason", "setup_required"),)
    assert backend.status().state is SandboxState.SETUP_REQUIRED


def test_runner_propagates_structured_backend_unavailable_failure(
    tmp_path: Path,
) -> None:
    runner = sandbox_module.SandboxRunner(
        cwd=tmp_path,
        backend=UnavailableSandboxBackend("test"),
    )

    with pytest.raises(SandboxError) as error:
        runner.run(["command"])

    assert error.value.failure.kind is SandboxFailureKind.BACKEND_UNAVAILABLE
    assert error.value.failure.backend == "test"


def test_shell_environment_keeps_windows_runtime_variables(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("SystemRoot", "C:\\Windows")
    monkeypatch.setenv("ComSpec", "C:\\Windows\\System32\\cmd.exe")
    monkeypatch.setenv("PATHEXT", ".COM;.EXE;.BAT;.CMD")
    monkeypatch.setenv("FLOWENT_SECRET", "hidden")

    environment = build_shell_environment()
    normalized_environment = {
        name.upper(): value for name, value in environment.items()
    }

    assert normalized_environment["SYSTEMROOT"] == "C:\\Windows"
    assert normalized_environment["COMSPEC"] == "C:\\Windows\\System32\\cmd.exe"
    assert normalized_environment["PATHEXT"] == ".COM;.EXE;.BAT;.CMD"
    assert "FLOWENT_SECRET" not in normalized_environment


@pytest.mark.parametrize(
    ("platform", "backend_name"),
    [("linux", "linux"), ("darwin", "macos"), ("win32", "windows")],
)
def test_default_backend_selects_current_platform(
    platform: str,
    backend_name: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(sandbox_module.sys, "platform", platform)

    backend = sandbox_module._default_backend()

    assert backend.name == backend_name
