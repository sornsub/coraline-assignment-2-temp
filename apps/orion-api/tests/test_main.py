from fastapi.testclient import TestClient
from app.main import app


client = TestClient(app)


def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_sources_have_no_secret_values():
    response = client.get("/api/v1/sources")
    assert response.status_code == 200
    body = response.json()
    assert len(body["sources"]) == 3
    assert "password" not in str(body).lower()
