from typing import Dict, Any
from app.extensions import db
from app.models.cart import Cart
from app.models.cart_item import CartItem
from app.models.product import Product


class CartService:
    """Service layer for Cart operations: item addition, quantity modification, and stock verification."""

    @staticmethod
    def get_or_create_cart(user_id: int) -> Cart:
        """Fetch user cart or create a new one if it does not exist."""
        cart = Cart.query.filter_by(user_id=user_id).first()
        if not cart:
            cart = Cart(user_id=user_id)
            db.session.add(cart)
            db.session.commit()
        return cart

    @classmethod
    def add_item(cls, user_id: int, product_id: int, quantity: int = 1) -> Dict[str, Any]:
        """Add product to cart or increment its quantity if already present."""
        if quantity <= 0:
            raise ValueError("Item quantity must be greater than zero")

        product = db.session.get(Product, product_id)
        if not product:
            raise ValueError("Product not found")

        if not product.is_active:
            raise ValueError("This product is currently unavailable for purchase")

        cart = cls.get_or_create_cart(user_id)

        # Check existing item
        cart_item = CartItem.query.filter_by(cart_id=cart.id, product_id=product.id).first()

        new_quantity = quantity if not cart_item else cart_item.quantity + quantity
        if product.stock_quantity < new_quantity:
            raise ValueError(
                f"Insufficient stock for '{product.name}'. Available: {product.stock_quantity}, requested: {new_quantity}"
            )

        if cart_item:
            cart_item.quantity = new_quantity
        else:
            cart_item = CartItem(cart_id=cart.id, product_id=product.id, quantity=quantity)
            db.session.add(cart_item)

        db.session.commit()
        return cart.to_dict()

    @classmethod
    def update_item_quantity(cls, user_id: int, cart_item_id: int, quantity: int) -> Dict[str, Any]:
        """Update the quantity of a specific cart item."""
        if quantity <= 0:
            raise ValueError("Quantity must be at least 1. Use remove to delete.")

        cart = cls.get_or_create_cart(user_id)
        cart_item = CartItem.query.filter_by(id=cart_item_id, cart_id=cart.id).first()

        if not cart_item:
            raise ValueError("Cart item not found in your cart")

        product = cart_item.product
        if not product or not product.is_active:
            raise ValueError("This product is no longer active")

        if product.stock_quantity < quantity:
            raise ValueError(
                f"Insufficient stock for '{product.name}'. Available: {product.stock_quantity}, requested: {quantity}"
            )

        cart_item.quantity = quantity
        db.session.commit()
        return cart.to_dict()

    @classmethod
    def remove_item(cls, user_id: int, cart_item_id: int) -> Dict[str, Any]:
        """Remove a specific item from the user's cart."""
        cart = cls.get_or_create_cart(user_id)
        cart_item = CartItem.query.filter_by(id=cart_item_id, cart_id=cart.id).first()

        if not cart_item:
            raise ValueError("Cart item not found in your cart")

        db.session.delete(cart_item)
        db.session.commit()
        return cart.to_dict()

    @classmethod
    def clear_cart(cls, user_id: int) -> Dict[str, Any]:
        """Remove all items from the user's cart."""
        cart = cls.get_or_create_cart(user_id)
        CartItem.query.filter_by(cart_id=cart.id).delete()
        db.session.commit()
        return cart.to_dict()
