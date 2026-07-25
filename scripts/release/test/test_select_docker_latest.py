from scripts.release.select_docker_latest import should_update_latest


def test_highest_stable_version_updates_latest() -> None:
    assert should_update_latest(
        "v0.3.10",
        ["v0.3.9", "v0.3.10", "v0.4.0-rc.1", "not-a-version"],
    )


def test_older_stable_version_does_not_update_latest() -> None:
    assert not should_update_latest("v0.3.9", ["v0.3.9", "v0.3.10"])


def test_prerelease_does_not_update_latest() -> None:
    assert not should_update_latest("v0.4.0-rc.1", ["v0.3.10", "v0.4.0-rc.1"])
