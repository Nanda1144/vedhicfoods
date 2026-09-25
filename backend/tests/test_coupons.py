def test_coupon_creation_and_validation(client, admin_headers, auth_headers):
    """Test coupon creation, percentage discount calculation, minimum spend, and max cap."""
    # 1. Admin creates 20% discount coupon, min order 500, max discount 150
    create_res = client.post(
        "/api/admin/coupons",
        headers=admin_headers,
        json={
            "code": "FESTIVE20",
            "description": "20% off up to ₹150",
            "discount_type": "PERCENTAGE",
            "discount_value": 20.0,
            "minimum_order_amount": 500.0,
            "maximum_discount": 150.0,
        },
    )
    assert create_res.status_code == 201

    # 2. Validate below minimum order amount (order ₹400 < ₹500) -> fails
    val_fail = client.post(
        "/api/coupons/validate",
        headers=auth_headers,
        json={"code": "FESTIVE20", "order_amount": 400.0},
    )
    assert val_fail.status_code == 400
    assert "Minimum order amount" in val_fail.get_json()["message"]

    # 3. Validate at ₹600 (20% of 600 = 120 < 150 max cap) -> ₹120 discount
    val_ok = client.post(
        "/api/coupons/validate",
        headers=auth_headers,
        json={"code": "FESTIVE20", "order_amount": 600.0},
    )
    assert val_ok.status_code == 200
    assert val_ok.get_json()["data"]["discount_amount"] == 120.0

    # 4. Validate at ₹1000 (20% of 1000 = 200 > 150 max cap) -> capped at ₹150
    val_capped = client.post(
        "/api/coupons/validate",
        headers=auth_headers,
        json={"code": "FESTIVE20", "order_amount": 1000.0},
    )
    assert val_capped.status_code == 200
    assert val_capped.get_json()["data"]["discount_amount"] == 150.0
