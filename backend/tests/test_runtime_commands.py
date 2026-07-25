import sys
from io import StringIO

import pytest

from flowent.cli import main
from flowent.runtime_commands import flowent_command, python_runner_command


def test_source_runtime_uses_python_for_internal_commands(monkeypatch) -> None:
    monkeypatch.delattr(sys, "frozen", raising=False)

    assert flowent_command("apply-patch", "--cwd", "/workspace") == [
        sys.executable,
        "-m",
        "flowent.cli",
        "apply-patch",
        "--cwd",
        "/workspace",
    ]
    command = python_runner_command()
    assert command[:3] == [sys.executable, "-I", "-c"]


def test_frozen_runtime_uses_flowent_internal_commands(monkeypatch) -> None:
    monkeypatch.setattr(sys, "frozen", True, raising=False)

    assert flowent_command("apply-patch", "--cwd", "/workspace") == [
        sys.executable,
        "apply-patch",
        "--cwd",
        "/workspace",
    ]
    assert python_runner_command() == [sys.executable, "_run-python"]


def test_internal_python_runner_executes_workflow_code(monkeypatch, capsys) -> None:
    monkeypatch.setattr(
        sys,
        "stdin",
        StringIO('{"code":"output = input.upper()","input":"ready","inputs":[]}'),
    )

    with pytest.raises(SystemExit) as error:
        main(["_run-python"])

    assert error.value.code == 0
    assert capsys.readouterr().out == "READY"


def test_public_help_does_not_list_internal_commands(capsys) -> None:
    with pytest.raises(SystemExit) as error:
        main(["--help"])

    assert error.value.code == 0
    output = capsys.readouterr().out
    assert "doctor" in output
    assert "apply-patch" not in output
    assert "_run-python" not in output
    assert "SUPPRESS" not in output


@pytest.mark.parametrize("command", ["apply-patch", "_run-python"])
def test_internal_commands_reject_unexpected_arguments(command: str, capsys) -> None:
    arguments = [command, "unexpected"]
    if command == "apply-patch":
        arguments[1:1] = ["--cwd", "/workspace"]

    with pytest.raises(SystemExit) as error:
        main(arguments)

    assert error.value.code == 2
    assert "unrecognized arguments: unexpected" in capsys.readouterr().err
