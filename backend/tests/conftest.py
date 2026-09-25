import pytest
from app import create_app
from app.extensions import db
from config import TestingConfig
from app.models.user import User


@pytest.fixture(scope="session")
def app():
    """Create Flask application configured for testing."""
    application = create_app(TestingConfig)
    with application.app_context():
        db.create_all()
        yield application
        db.session.remove()
        db.drop_all()


@pytest.fixture(scope="function")
def client(app):
    """Flask test client with clean table state per test."""
    with app.app_context():
        db.session.rollback()
        from sqlalchemy import text
        tables = [
            "payments", "order_items", "orders", "coupon_usages", "coupons",
            "cart_items", "carts", "wishlists", "notifications", "addresses",
            "product_images", "products", "categories", "banners", "users"
        ]
        for t in tables:
            db.session.execute(text(f'DELETE FROM "{t}";'))
        db.session.commit()
        db.session.remove()

    yield app.test_client()

    with app.app_context():
        db.session.rollback()
        db.session.remove()


@pytest.fixture
def auth_headers(client):
    """Fixture providing a standard authenticated customer token and headers."""
    reg_res = client.post(
        "/api/auth/register",
        json={
            "full_name": "Test Customer",
            "email": "customer@example.com",
            "phone": "+919876543210",
            "password": "Password123",
        },
    )
    token = reg_res.get_json()["data"]["access_token"]
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }


@pytest.fixture
def admin_headers(client):
    """Fixture providing an authenticated administrator token and headers."""
    reg_res = client.post(
        "/api/auth/register",
        json={
            "full_name": "Test Admin",
            "email": "admin@example.com",
            "phone": "+919876543211",
            "password": "AdminPassword123",
        },
    )
    # Update role to ADMIN in DB
    with client.application.app_context():
        admin = User.query.filter_by(email="admin@example.com").first()
        admin.role = "ADMIN"
        db.session.commit()

    # Log in again to obtain JWT with ADMIN claims
    login_res = client.post(
        "/api/auth/login",
        json={
            "email": "admin@example.com",
            "password": "AdminPassword123",
        },
    )
    token = login_res.get_json()["data"]["access_token"]
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }


@pytest.fixture
def other_user_headers(client):
    """Fixture providing a second distinct user token to test cross-user isolation."""
    reg_res = client.post(
        "/api/auth/register",
        json={
            "full_name": "Other User",
            "email": "other@example.com",
            "phone": "+919876543212",
            "password": "Password123",
        },
    )
    token = reg_res.get_json()["data"]["access_token"]
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
