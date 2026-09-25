from typing import Tuple, Optional
from datetime import datetime, timezone
from app.extensions import db
from app.models.coupon import Coupon
from app.models.coupon_usage import CouponUsage


class CouponService:
    """Service layer for server-side coupon validation, discount calculation, and usage limits."""

    @staticmethod
    def validate_coupon(
        code: str,
        user_id: int,
        order_amount: float,
    ) -> Tuple[bool, float, Optional[str], Optional[Coupon]]:
        """
        Validate coupon conditions server-side:
        - Exists and is active
        - Valid date window (start_date <= now <= end_date)
        - Meets minimum order amount
        - Total usage limit not exceeded
        - Per-user usage limit not exceeded
        Returns: (is_valid, discount_amount, error_message, coupon)
        """
        if not code:
            return False, 0.0, "Coupon code cannot be empty", None

        normalized_code = code.strip().upper()
        coupon = Coupon.query.filter_by(code=normalized_code).first()

        if not coupon:
            return False, 0.0, f"Coupon code '{normalized_code}' is invalid", None

        if not coupon.is_active:
            return False, 0.0, "This coupon is no longer active", None

        now = datetime.now(timezone.utc)

        if coupon.start_date and coupon.start_date > now:
            return False, 0.0, "This coupon has not started yet", None

        if coupon.end_date and coupon.end_date < now:
            return False, 0.0, "This coupon has expired", None

        min_order = float(coupon.minimum_order_amount or 0.0)
        if order_amount < min_order:
            return False, 0.0, f"Minimum order amount of ₹{min_order:.2f} required for this coupon", None

        if coupon.usage_limit is not None and coupon.used_count >= coupon.usage_limit:
            return False, 0.0, "This coupon has reached its total usage limit", None

        # Check per-user limit
        user_usages = CouponUsage.query.filter_by(coupon_id=coupon.id, user_id=user_id).count()
        if user_usages >= coupon.per_user_limit:
            return False, 0.0, f"You have already redeemed this coupon the maximum number of times ({coupon.per_user_limit})", None

        # Calculate discount
        val = float(coupon.discount_value)
        if coupon.discount_type == "PERCENTAGE":
            discount = round((order_amount * val) / 100.0, 2)
            if coupon.maximum_discount is not None:
                discount = min(discount, float(coupon.maximum_discount))
        else:  # FIXED
            discount = min(round(val, 2), round(order_amount, 2))

        return True, discount, None, coupon
