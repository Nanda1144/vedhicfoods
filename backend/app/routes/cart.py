from flask import Blueprint, request
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.schemas.cart import CartItemAddSchema, CartItemUpdateSchema
from app.services.cart_service import CartService
from app.utils.response import success_response, error_response

cart_bp = Blueprint("cart", __name__, url_prefix="/api/cart")

add_item_schema = CartItemAddSchema()
update_item_schema = CartItemUpdateSchema()


@cart_bp.get("")
@jwt_required()
def get_cart():
    """
    Get current user's cart and calculated totals
    ---
    tags:
      - Cart
    security:
      - bearerAuth: []
    responses:
      200:
        description: Cart items and live database-calculated totals
    """
    user_id = int(get_jwt_identity())
    cart = CartService.get_or_create_cart(user_id)
    return success_response(data=cart.to_dict(), message="Cart retrieved")


@cart_bp.post("/items")
@jwt_required()
def add_cart_item():
    """
    Add a product to cart or increment quantity
    ---
    tags:
      - Cart
    security:
      - bearerAuth: []
    requestBody:
      required: true
      content:
        application/json:
          schema:
            type: object
            required:
              - product_id
            properties:
              product_id:
                type: integer
              quantity:
                type: integer
                default: 1
    responses:
      200:
        description: Updated cart state
      400:
        description: Out of stock or invalid quantity
    """
    user_id = int(get_jwt_identity())
    data = add_item_schema.load(request.get_json() or {})
    try:
        updated_cart = CartService.add_item(
            user_id=user_id,
            product_id=data["product_id"],
            quantity=data.get("quantity", 1),
        )
        return success_response(data=updated_cart, message="Item added to cart")
    except ValueError as e:
        return error_response(message=str(e), status_code=400)


@cart_bp.put("/items/<int:item_id>")
@jwt_required()
def update_cart_item(item_id: int):
    """
    Update quantity of a cart item
    ---
    tags:
      - Cart
    security:
      - bearerAuth: []
    parameters:
      - in: path
        name: item_id
        required: true
        schema:
          type: integer
    requestBody:
      required: true
      content:
        application/json:
          schema:
            type: object
            required:
              - quantity
            properties:
              quantity:
                type: integer
    responses:
      200:
        description: Updated cart state
      400:
        description: Insufficient stock
    """
    user_id = int(get_jwt_identity())
    data = update_item_schema.load(request.get_json() or {})
    try:
        updated_cart = CartService.update_item_quantity(
            user_id=user_id,
            cart_item_id=item_id,
            quantity=data["quantity"],
        )
        return success_response(data=updated_cart, message="Cart item updated")
    except ValueError as e:
        return error_response(message=str(e), status_code=400)


@cart_bp.delete("/items/<int:item_id>")
@jwt_required()
def remove_cart_item(item_id: int):
    """
    Remove an item from cart
    ---
    tags:
      - Cart
    security:
      - bearerAuth: []
    parameters:
      - in: path
        name: item_id
        required: true
        schema:
          type: integer
    responses:
      200:
        description: Updated cart state
    """
    user_id = int(get_jwt_identity())
    try:
        updated_cart = CartService.remove_item(user_id=user_id, cart_item_id=item_id)
        return success_response(data=updated_cart, message="Item removed from cart")
    except ValueError as e:
        return error_response(message=str(e), status_code=400)


@cart_bp.delete("")
@jwt_required()
def clear_cart():
    """
    Clear all items from user cart
    ---
    tags:
      - Cart
    security:
      - bearerAuth: []
    responses:
      200:
        description: Empty cart state
    """
    user_id = int(get_jwt_identity())
    empty_cart = CartService.clear_cart(user_id=user_id)
    return success_response(data=empty_cart, message="Cart cleared successfully")
