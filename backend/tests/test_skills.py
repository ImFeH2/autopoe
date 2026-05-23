from pathlib import Path

from fastapi.testclient import TestClient

from flowent.main import create_app


def configure_provider(client: TestClient) -> None:
    client.post(
        "/api/providers",
        json={
            "api_key": "sk-local",
            "base_url": "",
            "id": "provider-openai",
            "models": ["gpt-5.1"],
            "name": "OpenAI",
            "type": "openai",
        },
    )
    client.put(
        "/api/settings",
        json={
            "reasoning_effort": "default",
            "selected_model": "gpt-5.1",
            "selected_provider_id": "provider-openai",
        },
    )


def write_skill(
    directory: Path,
    slug: str,
    *,
    body: str = "Use the project checklist before answering.",
    description: str = "Use the project checklist.",
    name: str = "Checklist",
) -> Path:
    skill_dir = directory / slug
    skill_dir.mkdir(parents=True)
    skill_path = skill_dir / "SKILL.md"
    skill_path.write_text(
        f"---\nname: {name}\ndescription: {description}\n---\n\n{body}\n"
    )
    return skill_path


def skill_by_slug(skills: list[dict[str, object]], slug: str) -> dict[str, object]:
    for skill in skills:
        if skill["slug"] == slug:
            return skill
    raise AssertionError(f"Skill not found: {slug}")


def test_state_is_empty_when_no_skills_exist(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    client = TestClient(create_app(serve_frontend=False))

    response = client.get("/api/state")

    assert response.status_code == 200
    assert response.json()["skills"] == []


def test_state_lists_user_skills_from_data_directory(tmp_path, monkeypatch) -> None:
    data_dir = tmp_path / "data"
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(data_dir))
    skill_path = write_skill(
        data_dir / "skills",
        "checklist",
        description="Use the user checklist.",
        name="User Checklist",
    )
    client = TestClient(create_app(serve_frontend=False))

    response = client.get("/api/state")

    assert response.status_code == 200
    assert response.json()["skills"] == [
        {
            "description": "Use the user checklist.",
            "enabled": True,
            "error": "",
            "id": response.json()["skills"][0]["id"],
            "name": "User Checklist",
            "path": str(skill_path),
            "scope": "user",
            "slug": "user-checklist",
        }
    ]


def test_state_lists_project_skills_from_project_directory(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    skill_path = write_skill(
        tmp_path / ".flowent" / "skills",
        "review",
        description="Review project changes.",
        name="Project Review",
    )
    client = TestClient(create_app(serve_frontend=False))

    response = client.get("/api/state")

    assert response.status_code == 200
    assert response.json()["skills"] == [
        {
            "description": "Review project changes.",
            "enabled": True,
            "error": "",
            "id": response.json()["skills"][0]["id"],
            "name": "Project Review",
            "path": str(skill_path),
            "scope": "project",
            "slug": "project-review",
        }
    ]


def test_skill_reload_reflects_filesystem_changes(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    client = TestClient(create_app(serve_frontend=False))

    initial_response = client.get("/api/state")
    write_skill(
        tmp_path / ".flowent" / "skills",
        "release",
        description="Prepare release notes.",
        name="Release Notes",
    )
    reload_response = client.post("/api/skills/reload")

    assert initial_response.json()["skills"] == []
    assert reload_response.status_code == 200
    assert skill_by_slug(reload_response.json(), "release-notes")["name"] == (
        "Release Notes"
    )


def test_invalid_skill_reports_error(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    skill_dir = tmp_path / ".flowent" / "skills" / "broken"
    skill_dir.mkdir(parents=True)
    skill_path = skill_dir / "SKILL.md"
    skill_path.write_text("---\nname: Broken Skill\n---\n\nMissing description.\n")
    client = TestClient(create_app(serve_frontend=False))

    response = client.get("/api/state")

    assert response.status_code == 200
    skill = response.json()["skills"][0]
    assert skill == {
        "description": "",
        "enabled": True,
        "error": "Skill needs a name and description.",
        "id": skill["id"],
        "name": "Broken Skill",
        "path": str(skill_path),
        "scope": "project",
        "slug": "broken-skill",
    }


def test_skill_enabled_state_persists_across_app_instances(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    write_skill(
        tmp_path / ".flowent" / "skills",
        "review",
        description="Review project changes.",
        name="Project Review",
    )
    client = TestClient(create_app(serve_frontend=False))
    skill = skill_by_slug(client.get("/api/state").json()["skills"], "project-review")

    response = client.put(f"/api/skills/{skill['id']}", json={"enabled": False})
    restarted_client = TestClient(create_app(serve_frontend=False))
    restarted_skill = skill_by_slug(
        restarted_client.get("/api/state").json()["skills"],
        "project-review",
    )

    assert response.status_code == 200
    assert response.json()["enabled"] is False
    assert restarted_skill["enabled"] is False


def test_workspace_response_injects_explicit_skill_instruction(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    write_skill(
        tmp_path / ".flowent" / "skills",
        "review",
        body="Full only instruction: review every changed file before answering.",
        description="Review project changes.",
        name="Project Review",
    )
    captured_request: dict[str, object] = {}

    async def fake_completion(**request: object) -> object:
        captured_request.update(request)

        async def chunks() -> object:
            yield {"choices": [{"delta": {"content": "Done."}}]}

        return chunks()

    client = TestClient(
        create_app(serve_frontend=False, chat_completion=fake_completion)
    )
    configure_provider(client)

    response = client.post(
        "/api/workspace/respond",
        json={"content": "$project-review Please inspect the changes."},
    )

    assert response.status_code == 200
    contents = [str(message["content"]) for message in captured_request["messages"]]
    assert any(
        "Full only instruction: review every changed file before answering." in content
        for content in contents
    )
    assert captured_request["messages"][-1] == {
        "role": "user",
        "content": "$project-review Please inspect the changes.",
    }


def test_workspace_response_injects_multiple_explicit_skill_instructions(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    write_skill(
        tmp_path / ".flowent" / "skills",
        "review",
        body="Full only instruction: inspect changes.",
        description="Review project changes.",
        name="Project Review",
    )
    write_skill(
        tmp_path / ".flowent" / "skills",
        "release",
        body="Full only instruction: write release notes.",
        description="Prepare release notes.",
        name="Release Notes",
    )
    captured_request: dict[str, object] = {}

    async def fake_completion(**request: object) -> object:
        captured_request.update(request)

        async def chunks() -> object:
            yield {"choices": [{"delta": {"content": "Done."}}]}

        return chunks()

    client = TestClient(
        create_app(serve_frontend=False, chat_completion=fake_completion)
    )
    configure_provider(client)

    response = client.post(
        "/api/workspace/respond",
        json={"content": "$project-review $release-notes Draft the summary."},
    )

    assert response.status_code == 200
    contents = "\n".join(
        str(message["content"]) for message in captured_request["messages"]
    )
    assert "Full only instruction: inspect changes." in contents
    assert "Full only instruction: write release notes." in contents


def test_workspace_response_treats_unknown_skill_reference_as_text(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    write_skill(
        tmp_path / ".flowent" / "skills",
        "review",
        body="Full only instruction: inspect changes.",
        description="Review project changes.",
        name="Project Review",
    )
    captured_request: dict[str, object] = {}

    async def fake_completion(**request: object) -> object:
        captured_request.update(request)

        async def chunks() -> object:
            yield {"choices": [{"delta": {"content": "Done."}}]}

        return chunks()

    client = TestClient(
        create_app(serve_frontend=False, chat_completion=fake_completion)
    )
    configure_provider(client)

    response = client.post(
        "/api/workspace/respond",
        json={"content": "$missing Keep this as text."},
    )

    assert response.status_code == 200
    contents = "\n".join(
        str(message["content"]) for message in captured_request["messages"]
    )
    assert "Full only instruction: inspect changes." not in contents
    assert captured_request["messages"][-1] == {
        "role": "user",
        "content": "$missing Keep this as text.",
    }


def test_workspace_response_does_not_inject_disabled_skill(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    write_skill(
        tmp_path / ".flowent" / "skills",
        "review",
        body="Full only instruction: inspect changes.",
        description="Review project changes.",
        name="Project Review",
    )
    captured_request: dict[str, object] = {}

    async def fake_completion(**request: object) -> object:
        captured_request.update(request)

        async def chunks() -> object:
            yield {"choices": [{"delta": {"content": "Done."}}]}

        return chunks()

    client = TestClient(
        create_app(serve_frontend=False, chat_completion=fake_completion)
    )
    skill = skill_by_slug(client.get("/api/state").json()["skills"], "project-review")
    client.put(f"/api/skills/{skill['id']}", json={"enabled": False})
    configure_provider(client)

    response = client.post(
        "/api/workspace/respond",
        json={"content": "$project-review Please inspect the changes."},
    )

    assert response.status_code == 200
    contents = "\n".join(
        str(message["content"]) for message in captured_request["messages"]
    )
    assert "Full only instruction: inspect changes." not in contents
