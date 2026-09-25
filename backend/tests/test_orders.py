def test_order_creation_inventory_and_cancellation(client, admin_headers, auth_headers):
    """Test full order lifecycle: place order, stock deduction, cart clearing, and cancel with inventory restoration."""
    # 1. Setup category, product with stock 10, address
    cat_res = client.post("/api/admin/categories", headers=admin_headers, json={"name": "Grains"})
    cat_id = cat_res.get_json()["data"]["id"]

    prod_res = client.post(
        "/api/admin/products",
        headers=admin_headers,
        json={
            "category_id": cat_id,
            "name": "Kodo Millet",
            "price": 300.0,
            "stock_quantity": 10,
        },
    )
    prod_id = prod_res.get_json()["data"]["id"]

    addr_res = client.post(
        "/api/addresses",
        headers=auth_headers,
        json={
            "full_name": "Kavita Rao",
            "phone": "+919876543210",
            "address_line_1": "123 Heritage Lane",
            "city": "Hyderabad",
            "state": "Telangana",
            "pincode": "500001",
        },
    )
    addr_id = addr_res.get_json()["data"]["id"]

    # 2. Add 4 items to cart
    client.post("/api/cart/items", headers=auth_headers, json={"product_id": prod_id, "quantity": 4})

    # 3. Place order
    order_res = client.post(
        "/api/orders",
        headers=auth_headers,
        json={"address_id": addr_id, "notes": "Please deliver in the morning"},
    )
    assert order_res.status_code == 201
    order = order_res.get_json()["data"]
    order_id = order["id"]
    assert order["order_status"] == "PENDING"
    assert order["subtotal"] == 1200.0  # 300 * 4

    # 4. Verify inventory was decremented: 10 - 4 = 6
    prod_check = client.get(f"/api/products/{prod_id}")
    assert prod_check.get_json()["data"]["stock_quantity"] == 6

    # 5. Verify cart is now empty
    cart_check = client.get("/api/cart", headers=auth_headers)
    assert len(cart_check.get_json()["data"]["items"]) == 0

    # 6. Cancel order and verify stock is restored: 6 + 4 = 10
    cancel_res = client.post(f"/api/orders/{order_id}/cancel", headers=auth_headers)
    assert cancel_res.status_code == 200
    assert cancel_res.get_json()["data"]["order_status"] == "CANCELLED"

    prod_restored = client.get(f"/api/products/{prod_id}")
    assert prod_restored.get_json()["data"]["stock_quantity"] == 10
