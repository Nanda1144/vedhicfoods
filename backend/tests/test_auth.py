def test_register_success(client):
    """Test successful user registration returns safe user info and JWT."""
    res = client.post(
        "/api/auth/register",
        json={
            "full_name": "Priya Patel",
            "email": "priya@example.com",
            "phone": "+919123456780",
            "password": "StrongPassword1",
        },
    )
    assert res.status_code == 201
    data = res.get_json()
    assert data["success"] is True
    assert "access_token" in data["data"]
    user = data["data"]["user"]
    assert user["email"] == "priya@example.com"
    assert user["full_name"] == "Priya Patel"
    assert "password_hash" not in user


def test_register_duplicate_email(client):
    """Test registering with an existing email returns 409 conflict."""
    payload = {
        "full_name": "Priya Patel",
        "email": "duplicate@example.com",
        "password": "StrongPassword1",
    }
    res1 = client.post("/api/auth/register", json=payload)
    assert res1.status_code == 201

    res2 = client.post("/api/auth/register", json=payload)
    assert res2.status_code == 409
    data = res2.get_json()
    assert data["success"] is False


def test_register_weak_password(client):
    """Test registering with a weak password fails validation (422)."""
    res = client.post(
        "/api/auth/register",
        json={
            "full_name": "Test User",
            "email": "weak@example.com",
            "password": "short",  # less than 8 chars
        },
    )
    assert res.status_code == 422
    data = res.get_json()
    assert data["success"] is False


def test_login_success(client):
    """Test login with valid credentials returns JWT token."""
    client.post(
        "/api/auth/register",
        json={
            "full_name": "Login Tester",
            "email": "logintester@example.com",
            "password": "Password123",
        },
    )

    res = client.post(
        "/api/auth/login",
        json={
            "email": "logintester@example.com",
            "password": "Password123",
        },
    )
    assert res.status_code == 200
    data = res.get_json()
    assert data["success"] is True
    assert "access_token" in data["data"]


def test_login_invalid_password(client):
    """Test login with invalid password fails with 401."""
    client.post(
        "/api/auth/register",
        json={
            "full_name": "Login Tester",
            "email": "logintester@example.com",
            "password": "Password123",
        },
    )

    res = client.post(
        "/api/auth/login",
        json={
            "email": "logintester@example.com",
            "password": "WrongPassword999",
        },
    )
    assert res.status_code == 401


def test_get_me(client, auth_headers):
    """Test GET /api/auth/me returns current user."""
    res = client.get("/api/auth/me", headers=auth_headers)
    assert res.status_code == 200
    data = res.get_json()
    assert data["success"] is True
    assert data["data"]["user"]["email"] == "customer@example.com"


def test_unauthorized_without_token(client):
    """Test protected endpoints return 401 when token is missing."""
    res = client.get("/api/auth/me")
    assert res.status_code == 401
