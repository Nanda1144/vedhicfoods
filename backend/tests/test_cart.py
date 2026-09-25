def test_cart_operations(client, auth_headers, admin_headers):
    """Test cart lifecycle: add, update, remove, and totals calculation."""
    # Create category and product
    cat_res = client.post(
        "/api/admin/categories",
        headers=admin_headers,
        json={"name": "Flours", "slug": "flours"},
    )
    cat_id = cat_res.get_json()["data"]["id"]

    prod_res = client.post(
        "/api/admin/products",
        headers=admin_headers,
        json={
            "category_id": cat_id,
            "name": "Ragi Flour",
            "price": 200.0,
            "discount_percentage": 10.0,  # final_price: 180.0
            "stock_quantity": 10,
        },
    )
    prod_id = prod_res.get_json()["data"]["id"]

    # 1. Empty cart
    cart_res = client.get("/api/cart", headers=auth_headers)
    assert cart_res.status_code == 200
    assert len(cart_res.get_json()["data"]["items"]) == 0

    # 2. Add item to cart (qty 2)
    add_res = client.post(
        "/api/cart/items",
        headers=auth_headers,
        json={"product_id": prod_id, "quantity": 2},
    )
    assert add_res.status_code == 200
    cart_data = add_res.get_json()["data"]
    assert len(cart_data["items"]) == 1
    item = cart_data["items"][0]
    assert item["quantity"] == 2
    assert item["price"] == 180.0
    assert item["subtotal"] == 360.0  # 180 * 2
    assert cart_data["totals"]["subtotal"] == 360.0
    item_id = item["id"]

    # 3. Add more than available stock (fails)
    overflow_res = client.post(
        "/api/cart/items",
        headers=auth_headers,
        json={"product_id": prod_id, "quantity": 100},
    )
    assert overflow_res.status_code == 400

    # 4. Update quantity to 3
    upd_res = client.put(
        f"/api/cart/items/{item_id}",
        headers=auth_headers,
        json={"quantity": 3},
    )
    assert upd_res.status_code == 200
    assert upd_res.get_json()["data"]["totals"]["subtotal"] == 540.0  # 180 * 3

    # 5. Remove item
    del_res = client.delete(f"/api/cart/items/{item_id}", headers=auth_headers)
    assert del_res.status_code == 200
    assert len(del_res.get_json()["data"]["items"]) == 0
