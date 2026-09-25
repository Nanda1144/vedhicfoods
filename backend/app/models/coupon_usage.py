from app.extensions import db
from app.utils.helpers import utc_now


class CouponUsage(db.Model):
    __tablename__ = "coupon_usages"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    coupon_id = db.Column(db.Integer, db.ForeignKey("coupons.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    order_id = db.Column(db.Integer, db.ForeignKey("orders.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at = db.Column(db.DateTime(timezone=True), default=utc_now, nullable=False)

    # Relationships
    coupon = db.relationship("Coupon", back_populates="usages")
    user = db.relationship("User", back_populates="coupon_usages")
    order = db.relationship("Order", back_populates="coupon_usage")

    def __repr__(self):
        return f"<CouponUsage id={self.id} coupon_id={self.coupon_id} user_id={self.user_id}>"

    def to_dict(self):
        return {
            "id": self.id,
            "coupon_id": self.coupon_id,
            "user_id": self.user_id,
            "order_id": self.order_id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
