from flask import Blueprint, request
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.models.order import Order
from app.schemas.order import OrderCreateSchema
from app.services.order_service import OrderService
from app.utils.response import success_response, error_response
from app.utils.helpers import format_pagination

orders_bp = Blueprint("orders", __name__, url_prefix="/api/orders")

create_order_schema = OrderCreateSchema()


@orders_bp.post("")
@jwt_required()
def place_order():
    """
    Create a new order from current cart items with atomic inventory deduction
    ---
    tags:
      - Orders
    security:
      - bearerAuth: []
    requestBody:
      required: true
      content:
        application/json:
          schema:
            type: object
            required:
              - address_id
            properties:
              address_id:
                type: integer
              coupon_code:
                type: string
              notes:
                type: string
    responses:
      201:
        description: Order created with status PENDING
      400:
        description: Empty cart, insufficient stock, or invalid coupon
    """
    user_id = int(get_jwt_identity())
    data = create_order_schema.load(request.get_json() or {})
    try:
        order = OrderService.create_order_from_cart(
            user_id=user_id,
            address_id=data["address_id"],
            coupon_code=data.get("coupon_code"),
            notes=data.get("notes"),
        )
        return success_response(
            data=order.to_dict(),
            message="Order placed successfully",
            status_code=201,
        )
    except ValueError as e:
        return error_response(message=str(e), status_code=400)


@orders_bp.get("")
@jwt_required()
def list_orders():
    """
    List orders belonging to current user with pagination
    ---
    tags:
      - Orders
    security:
      - bearerAuth: []
    """
    user_id = int(get_jwt_identity())
    page = request.args.get("page", 1, type=int)
    per_page = request.args.get("per_page", 10, type=int)

    pagination = (
        Order.query.filter_by(user_id=user_id)
        .order_by(Order.created_at.desc())
        .paginate(page=page, per_page=per_page, error_out=False)
    )

    items = [o.to_dict() for o in pagination.items]
    return success_response(data=format_pagination(pagination, items), message="Orders retrieved")


@orders_bp.get("/<int:order_id>")
@jwt_required()
def get_order(order_id: int):
    """
    Get detailed order information (ownership enforced)
    ---
    tags:
      - Orders
    security:
      - bearerAuth: []
    """
    user_id = int(get_jwt_identity())
    order = Order.query.filter_by(id=order_id, user_id=user_id).first()
    if not order:
        return error_response(message="Order not found or access denied", status_code=404)

    return success_response(data=order.to_dict(), message="Order details retrieved")


@orders_bp.post("/<int:order_id>/cancel")
@jwt_required()
def cancel_order(order_id: int):
    """
    Cancel an order and safely restore stock quantity in database
    ---
    tags:
      - Orders
    security:
      - bearerAuth: []
    """
    user_id = int(get_jwt_identity())
    try:
        cancelled_order = OrderService.cancel_order(order_id=order_id, user_id=user_id, is_admin=False)
        return success_response(data=cancelled_order.to_dict(), message="Order cancelled successfully")
    except ValueError as e:
        return error_response(message=str(e), status_code=400)
