from flask import Blueprint
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.extensions import db
from app.models.wishlist import Wishlist
from app.models.product import Product
from app.utils.response import success_response, error_response

wishlist_bp = Blueprint("wishlist", __name__, url_prefix="/api/wishlist")


@wishlist_bp.get("")
@jwt_required()
def get_wishlist():
    """Get all wishlist items for current user."""
    user_id = int(get_jwt_identity())
    items = Wishlist.query.filter_by(user_id=user_id).order_by(Wishlist.created_at.desc()).all()
    return success_response(data=[item.to_dict() for item in items], message="Wishlist retrieved")


@wishlist_bp.post("/<int:product_id>")
@jwt_required()
def add_to_wishlist(product_id: int):
    """Add a product to current user's wishlist."""
    user_id = int(get_jwt_identity())
    product = db.session.get(Product, product_id)
    if not product:
        return error_response(message="Product not found", status_code=404)

    existing = Wishlist.query.filter_by(user_id=user_id, product_id=product_id).first()
    if existing:
        return success_response(data=existing.to_dict(), message="Product already in wishlist")

    item = Wishlist(user_id=user_id, product_id=product_id)
    db.session.add(item)
    db.session.commit()

    return success_response(data=item.to_dict(), message="Added to wishlist", status_code=201)


@wishlist_bp.delete("/<int:product_id>")
@jwt_required()
def remove_from_wishlist(product_id: int):
    """Remove a product from current user's wishlist."""
    user_id = int(get_jwt_identity())
    item = Wishlist.query.filter_by(user_id=user_id, product_id=product_id).first()
    if not item:
        return error_response(message="Product not in wishlist", status_code=404)

    db.session.delete(item)
    db.session.commit()
    return success_response(message="Removed from wishlist")
