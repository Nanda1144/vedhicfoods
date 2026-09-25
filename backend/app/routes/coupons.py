from flask import Blueprint, request
from flask_jwt_extended import jwt_required, get_jwt_identity
from datetime import datetime, timezone
from app.models.coupon import Coupon
from app.schemas.coupon import CouponValidateSchema
from app.services.coupon_service import CouponService
from app.services.cart_service import CartService
from app.utils.response import success_response, error_response

coupons_bp = Blueprint("coupons", __name__, url_prefix="/api/coupons")

validate_schema = CouponValidateSchema()


@coupons_bp.get("")
def list_coupons():
    """List currently active, non-expired public coupons."""
    now = datetime.now(timezone.utc)
    coupons = (
        Coupon.query.filter(Coupon.is_active.is_(True))
        .filter((Coupon.start_date.is_(None)) | (Coupon.start_date <= now))
        .filter((Coupon.end_date.is_(None)) | (Coupon.end_date >= now))
        .order_by(Coupon.created_at.desc())
        .all()
    )
    return success_response(
        data=[c.to_dict() for c in coupons],
        message="Active coupons retrieved",
    )


@coupons_bp.post("/validate")
@jwt_required()
def validate_coupon():
    """
    Validate a coupon code server-side against cart or order amount.
    Never trusts client-supplied discount values.
    """
    user_id = int(get_jwt_identity())
    data = validate_schema.load(request.get_json() or {})
    code = data["code"]

    order_amount = data.get("order_amount")
    if order_amount is None:
        # Calculate from user's current cart subtotal
        cart = CartService.get_or_create_cart(user_id)
        order_amount = cart.to_dict()["totals"]["subtotal"]

    is_valid, discount_amount, err_msg, coupon_obj = CouponService.validate_coupon(
        code=code,
        user_id=user_id,
        order_amount=float(order_amount),
    )

    if not is_valid:
        return error_response(
            message=err_msg or "Coupon validation failed",
            error={"code": "COUPON_INVALID"},
            status_code=400,
        )

    return success_response(
        data={
            "valid": True,
            "coupon_code": coupon_obj.code,
            "discount_type": coupon_obj.discount_type,
            "discount_amount": discount_amount,
            "minimum_order_amount": float(coupon_obj.minimum_order_amount),
            "description": coupon_obj.description,
        },
        message="Coupon is valid and applied",
    )
