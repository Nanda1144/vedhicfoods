def test_root_endpoint(client):
    """Test GET / returns running status."""
    res = client.get("/")
    assert res.status_code == 200
    data = res.get_json()
    assert data["success"] is True
    assert data["message"] == "Vedhic Foods API is running"


def test_health_endpoint(client):
    """Test GET /api/health returns healthy service status."""
    res = client.get("/api/health")
    assert res.status_code == 200
    data = res.get_json()
    assert data["success"] is True
    assert data["service"] == "Vedhic Foods Backend"
    assert data["status"] == "healthy"
