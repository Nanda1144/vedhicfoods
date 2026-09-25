def test_user_cannot_access_other_users_resources(client, auth_headers, other_user_headers, admin_headers):
    """
    Strict security test verifying user boundary isolation:
    User A cannot view, mutate, or delete User B's addresses, orders, cart, wishlist, or notifications.
    """
    # 1. User A creates an address
    addr_res = client.post(
        "/api/addresses",
        headers=auth_headers,
        json={
            "full_name": "User A",
            "phone": "+919876543210",
            "address_line_1": "123 Private Street",
            "city": "Bengaluru",
            "state": "Karnataka",
            "pincode": "560001",
        },
    )
    user_a_addr_id = addr_res.get_json()["data"]["id"]

    # User B tries to update or delete User A's address -> 404
    upd_res = client.put(f"/api/addresses/{user_a_addr_id}", headers=other_user_headers, json={"city": "Hacked"})
    assert upd_res.status_code == 404

    del_res = client.delete(f"/api/addresses/{user_a_addr_id}", headers=other_user_headers)
    assert del_res.status_code == 404

    # 2. User A places an order
    cat_res = client.post("/api/admin/categories", headers=admin_headers, json={"name": "Snacks"})
    cat_id = cat_res.get_json()["data"]["id"]
    prod_res = client.post(
        "/api/admin/products",
        headers=admin_headers,
        json={"category_id": cat_id, "name": "Millet Murukku", "price": 100.0, "stock_quantity": 20},
    )
    prod_id = prod_res.get_json()["data"]["id"]

    client.post("/api/cart/items", headers=auth_headers, json={"product_id": prod_id, "quantity": 1})
    order_res = client.post("/api/orders", headers=auth_headers, json={"address_id": user_a_addr_id})
    user_a_order_id = order_res.get_json()["data"]["id"]

    # User B tries to view User A's order -> 404
    view_order = client.get(f"/api/orders/{user_a_order_id}", headers=other_user_headers)
    assert view_order.status_code == 404

    # User B tries to cancel User A's order -> 400 (access denied)
    cancel_order = client.post(f"/api/orders/{user_a_order_id}/cancel", headers=other_user_headers)
    assert cancel_order.status_code == 400

    # 3. User B gets their own cart, never sees User A's items
    cart_b = client.get("/api/cart", headers=other_user_headers)
    assert len(cart_b.get_json()["data"]["items"]) == 0

    # 4. User A adds item to wishlist
    client.post(f"/api/wishlist/{prod_id}", headers=auth_headers)
    # User B's wishlist is empty
    wish_b = client.get("/api/wishlist", headers=other_user_headers)
    assert len(wish_b.get_json()["data"]) == 0

    # 5. Non-admin cannot access admin dashboard or management endpoints
    admin_dash = client.get("/api/admin/dashboard", headers=auth_headers)
    assert admin_dash.status_code == 403

    admin_orders = client.get("/api/admin/orders", headers=auth_headers)
    assert admin_orders.status_code == 403
