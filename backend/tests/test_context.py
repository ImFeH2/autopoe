from flowent.context import environment_context_message


class UserRecord:
    def __init__(self, pw_shell: str) -> None:
        self.pw_shell = pw_shell


def test_environment_context_includes_shell_command_invocation(
    tmp_path, monkeypatch, make_executable_file
) -> None:
    shell = make_executable_file(tmp_path / "user-shell")
    monkeypatch.setenv("SHELL", str(shell))
    monkeypatch.setattr("pwd.getpwuid", lambda _uid: UserRecord(str(shell)))

    message = environment_context_message(tmp_path)

    assert f"  <shell>{shell} -c</shell>" in message.content
