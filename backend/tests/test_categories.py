def test_admin_create_category(client, admin_headers):
    """Test admin can create a category."""
    res = client.post(
        "/api/admin/categories",
        headers=admin_headers,
        json={
            "name": "Millet Laddus",
            "slug": "millet-laddus",
            "description": "Slow-roasted, hand-rolled organic laddus",
        },
    )
    assert res.status_code == 201
    data = res.get_json()
    assert data["success"] is True
    assert data["data"]["slug"] == "millet-laddus"


def test_user_cannot_create_category(client, auth_headers):
    """Test normal customer gets 403 Forbidden when attempting to create category."""
    res = client.post(
        "/api/admin/categories",
        headers=auth_headers,
        json={"name": "Organic Millets"},
    )
    assert res.status_code == 403


def test_list_and_get_category(client, admin_headers):
    """Test public listing and retrieval of categories by id and slug."""
    create_res = client.post(
        "/api/admin/categories",
        headers=admin_headers,
        json={"name": "Ragi Specials", "slug": "ragi-specials"},
    )
    cat_id = create_res.get_json()["data"]["id"]

    # Public listing
    list_res = client.get("/api/categories")
    assert list_res.status_code == 200
    cats = list_res.get_json()["data"]
    assert any(c["slug"] == "ragi-specials" for c in cats)

    # Get by ID
    get_id_res = client.get(f"/api/categories/{cat_id}")
    assert get_id_res.status_code == 200
    assert get_id_res.get_json()["data"]["name"] == "Ragi Specials"

    # Get by Slug
    get_slug_res = client.get("/api/categories/ragi-specials")
    assert get_slug_res.status_code == 200
    assert get_slug_res.get_json()["data"]["id"] == cat_id
