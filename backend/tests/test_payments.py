def test_payment_initiation_and_verification(client, admin_headers, auth_headers):
    """Test payment order creation, signature verification, and idempotency."""
    # 1. Setup product, address, and order
    cat_res = client.post("/api/admin/categories", headers=admin_headers, json={"name": "Oils"})
    cat_id = cat_res.get_json()["data"]["id"]

    prod_res = client.post(
        "/api/admin/products",
        headers=admin_headers,
        json={"category_id": cat_id, "name": "Cold-pressed Sesame Oil", "price": 400.0, "stock_quantity": 20},
    )
    prod_id = prod_res.get_json()["data"]["id"]

    addr_res = client.post(
        "/api/addresses",
        headers=auth_headers,
        json={
            "full_name": "Test Payer",
            "phone": "+919876543210",
            "address_line_1": "Main Road",
            "city": "Chennai",
            "state": "Tamil Nadu",
            "pincode": "600001",
        },
    )
    addr_id = addr_res.get_json()["data"]["id"]

    client.post("/api/cart/items", headers=auth_headers, json={"product_id": prod_id, "quantity": 1})
    order_res = client.post("/api/orders", headers=auth_headers, json={"address_id": addr_id})
    order_id = order_res.get_json()["data"]["id"]

    # 2. Initiate payment order
    pay_init_res = client.post(
        "/api/payments/create-order",
        headers=auth_headers,
        json={"order_id": order_id},
    )
    assert pay_init_res.status_code == 200
    pay_info = pay_init_res.get_json()["data"]
    rzp_order_id = pay_info["razorpay_order_id"]

    # 3. Test invalid signature
    bad_verify = client.post(
        "/api/payments/verify",
        headers=auth_headers,
        json={
            "order_id": order_id,
            "razorpay_order_id": rzp_order_id,
            "razorpay_payment_id": "pay_fake123",
            "razorpay_signature": "invalid_signature",
        },
    )
    assert bad_verify.status_code == 400

    # 4. Test valid signature
    good_verify = client.post(
        "/api/payments/verify",
        headers=auth_headers,
        json={
            "order_id": order_id,
            "razorpay_order_id": rzp_order_id,
            "razorpay_payment_id": "pay_test987",
            "razorpay_signature": "sig_valid_hash",
        },
    )
    assert good_verify.status_code == 200
    assert good_verify.get_json()["data"]["status"] == "SUCCESS"

    # Order should now be CONFIRMED and PAID
    order_check = client.get(f"/api/orders/{order_id}", headers=auth_headers)
    assert order_check.get_json()["data"]["payment_status"] == "PAID"
    assert order_check.get_json()["data"]["order_status"] == "CONFIRMED"

    # 5. Idempotency test: Repeat callback does not fail or duplicate
    repeat_verify = client.post(
        "/api/payments/verify",
        headers=auth_headers,
        json={
            "order_id": order_id,
            "razorpay_order_id": rzp_order_id,
            "razorpay_payment_id": "pay_test987",
            "razorpay_signature": "sig_valid_hash",
        },
    )
    assert repeat_verify.status_code == 200
