import os

import pytest

from flowent.access import is_access_configured, set_access_code, verify_access_code
from flowent.cli import APP_DATA_DIR_ENV_VAR, main


def test_access_refresh_command_generates_new_persisted_access_code(
    monkeypatch, tmp_path, capsys
):
    import flowent.settings as settings_module

    settings_file = tmp_path / "settings.json"
    monkeypatch.setattr(settings_module, "_SETTINGS_FILE", settings_file)
    monkeypatch.setattr(settings_module, "_cached_settings", None)

    settings = settings_module.Settings()
    set_access_code(settings, "OLD-ACCESS-CODE")
    settings_module.save_settings(settings)
    monkeypatch.setattr(settings_module, "_cached_settings", None)

    main(["access", "refresh"])

    output = capsys.readouterr().out.strip()
    reloaded_settings = settings_module.load_settings()

    assert output.startswith("Generated new access code: ")
    next_code = output.removeprefix("Generated new access code: ").strip()
    assert next_code
    assert reloaded_settings.access.code == next_code
    assert verify_access_code(reloaded_settings.access, next_code)
    assert not verify_access_code(reloaded_settings.access, "OLD-ACCESS-CODE")


def test_access_reset_command_clears_persisted_access_code(
    monkeypatch, tmp_path, capsys
):
    import flowent.settings as settings_module

    settings_file = tmp_path / "settings.json"
    monkeypatch.setattr(settings_module, "_SETTINGS_FILE", settings_file)
    monkeypatch.setattr(settings_module, "_cached_settings", None)

    settings = settings_module.Settings()
    set_access_code(settings, "TEST-ACCESS-CODE")
    settings_module.save_settings(settings)
    monkeypatch.setattr(settings_module, "_cached_settings", None)

    main(["access", "reset"])

    output = capsys.readouterr().out.strip()
    reloaded_settings = settings_module.load_settings()

    assert output == (
        "Access configuration cleared. Restart Flowent to generate a new access code."
    )
    assert reloaded_settings.access.code == ""
    assert not is_access_configured(reloaded_settings.access)


def test_version_short_option_matches_version_output(capsys):
    with pytest.raises(SystemExit) as exc:
        main(["-v"])

    assert exc.value.code == 0
    assert capsys.readouterr().out.startswith("flowent ")


def test_server_options_accept_npm_wrapper_aliases(monkeypatch):
    called: dict[str, object] = {}

    monkeypatch.setattr(
        "uvicorn.run",
        lambda app, *, host, port: called.update(
            {"app": app, "host": host, "port": port}
        ),
    )

    main(["--hostname", "127.0.0.1", "-p", "7000"])

    assert called == {
        "app": "flowent.main:app",
        "host": "127.0.0.1",
        "port": 7000,
    }


def test_cli_sets_app_data_dir_env_before_dispatch(monkeypatch, tmp_path, capsys):
    monkeypatch.delenv(APP_DATA_DIR_ENV_VAR, raising=False)
    called: list[str] = []

    monkeypatch.setattr(
        "flowent.access.refresh_local_access",
        lambda: called.append("refresh") or "Generated new access code: TEST",
    )

    main(["--app-data-dir", str(tmp_path), "access", "refresh"])

    assert called == ["refresh"]
    assert os.environ[APP_DATA_DIR_ENV_VAR] == str(tmp_path)
    assert capsys.readouterr().out.strip() == "Generated new access code: TEST"
