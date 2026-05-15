from fastapi.testclient import TestClient

from flowent.main import create_app


def test_health_endpoint() -> None:
    client = TestClient(create_app(serve_frontend=False))

    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
