def test_product_creation_and_pricing(client, admin_headers):
    """Test product creation calculates final_price server-side."""
    # Create category first
    cat_res = client.post(
        "/api/admin/categories",
        headers=admin_headers,
        json={"name": "Organic Millets", "slug": "organic-millets"},
    )
    cat_id = cat_res.get_json()["data"]["id"]

    # Create product with price 500 and 20% discount
    prod_res = client.post(
        "/api/admin/products",
        headers=admin_headers,
        json={
            "category_id": cat_id,
            "name": "Foxtail Millet",
            "slug": "foxtail-millet-500g",
            "price": 500.0,
            "discount_percentage": 20.0,
            "stock_quantity": 50,
            "unit": "500 g",
            "sku": "FOX-500G",
            "is_featured": True,
        },
    )
    assert prod_res.status_code == 201
    prod = prod_res.get_json()["data"]
    assert prod["price"] == 500.0
    assert prod["discount_percentage"] == 20.0
    # Server-side final_price calculation: 500 * (1 - 0.20) = 400.0
    assert prod["final_price"] == 400.0
    assert prod["sku"] == "FOX-500G"


def test_product_listing_and_filtering(client, admin_headers):
    """Test product filtering by category, search, and pricing."""
    cat_res = client.post(
        "/api/admin/categories",
        headers=admin_headers,
        json={"name": "Heritage Grains", "slug": "heritage-grains"},
    )
    cat_id = cat_res.get_json()["data"]["id"]

    client.post(
        "/api/admin/products",
        headers=admin_headers,
        json={
            "category_id": cat_id,
            "name": "Red Rice",
            "price": 250.0,
            "stock_quantity": 30,
        },
    )
    client.post(
        "/api/admin/products",
        headers=admin_headers,
        json={
            "category_id": cat_id,
            "name": "Black Rice",
            "price": 450.0,
            "stock_quantity": 15,
        },
    )

    # Search filter
    search_res = client.get("/api/products?search=Red")
    assert search_res.status_code == 200
    items = search_res.get_json()["data"]["items"]
    assert len(items) == 1
    assert items[0]["name"] == "Red Rice"

    # Price filter
    price_res = client.get("/api/products?max_price=300")
    items = price_res.get_json()["data"]["items"]
    assert all(i["final_price"] <= 300 for i in items)


def test_customer_cannot_modify_product(client, auth_headers, admin_headers):
    """Test customer gets 403 when trying to modify products."""
    cat_res = client.post(
        "/api/admin/categories",
        headers=admin_headers,
        json={"name": "Traditional Sweets", "slug": "traditional-sweets"},
    )
    cat_id = cat_res.get_json()["data"]["id"]

    prod_res = client.post(
        "/api/admin/products",
        headers=admin_headers,
        json={"category_id": cat_id, "name": "Besan Laddu", "price": 300.0},
    )
    prod_id = prod_res.get_json()["data"]["id"]

    # Customer attempt to update
    update_res = client.put(
        f"/api/admin/products/{prod_id}",
        headers=auth_headers,
        json={"price": 10.0},
    )
    assert update_res.status_code == 403
