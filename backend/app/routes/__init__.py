from flask import Flask
from app.routes.auth import auth_bp
from app.routes.users import users_bp
from app.routes.categories import categories_bp
from app.routes.products import products_bp
from app.routes.cart import cart_bp
from app.routes.addresses import addresses_bp
from app.routes.coupons import coupons_bp
from app.routes.orders import orders_bp
from app.routes.payments import payments_bp
from app.routes.wishlist import wishlist_bp
from app.routes.notifications import notifications_bp
from app.routes.banners import banners_bp
from app.routes.admin import admin_bp


def register_routes(app: Flask) -> None:
    """Register all REST API blueprints with the Flask application."""
    app.register_blueprint(auth_bp)
    app.register_blueprint(users_bp)
    app.register_blueprint(categories_bp)
    app.register_blueprint(products_bp)
    app.register_blueprint(cart_bp)
    app.register_blueprint(addresses_bp)
    app.register_blueprint(coupons_bp)
    app.register_blueprint(orders_bp)
    app.register_blueprint(payments_bp)
    app.register_blueprint(wishlist_bp)
    app.register_blueprint(notifications_bp)
    app.register_blueprint(banners_bp)
    app.register_blueprint(admin_bp)
