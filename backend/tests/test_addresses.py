def test_address_management(client, auth_headers):
    """Test creating, listing, setting default, updating, and deleting addresses."""
    # 1. Create first address (should automatically become default)
    res1 = client.post(
        "/api/addresses",
        headers=auth_headers,
        json={
            "full_name": "Manil Kumar",
            "phone": "+919876543210",
            "address_line_1": "Flat 402, Green Meadows",
            "city": "Bengaluru",
            "state": "Karnataka",
            "pincode": "560001",
        },
    )
    assert res1.status_code == 201
    addr1 = res1.get_json()["data"]
    assert addr1["is_default"] is True
    addr1_id = addr1["id"]

    # 2. Create second address (non-default)
    res2 = client.post(
        "/api/addresses",
        headers=auth_headers,
        json={
            "full_name": "Manil Kumar Office",
            "phone": "+919876543210",
            "address_line_1": "Tech Park, Whitefield",
            "city": "Bengaluru",
            "state": "Karnataka",
            "pincode": "560066",
            "is_default": False,
        },
    )
    assert res2.status_code == 201
    addr2 = res2.get_json()["data"]
    assert addr2["is_default"] is False
    addr2_id = addr2["id"]

    # 3. Promote second address to default
    def_res = client.post(f"/api/addresses/{addr2_id}/default", headers=auth_headers)
    assert def_res.status_code == 200
    assert def_res.get_json()["data"]["is_default"] is True

    # Check that first address is no longer default
    list_res = client.get("/api/addresses", headers=auth_headers)
    addrs = list_res.get_json()["data"]
    addr1_refreshed = next(a for a in addrs if a["id"] == addr1_id)
    assert addr1_refreshed["is_default"] is False

    # 4. Delete address
    del_res = client.delete(f"/api/addresses/{addr2_id}", headers=auth_headers)
    assert del_res.status_code == 200
