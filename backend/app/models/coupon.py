from app.extensions import db
from app.utils.helpers import utc_now


class Coupon(db.Model):
    __tablename__ = "coupons"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    code = db.Column(db.String(50), unique=True, nullable=False, index=True)
    description = db.Column(db.Text, nullable=True)
    discount_type = db.Column(db.String(20), nullable=False)  # 'PERCENTAGE', 'FIXED'
    discount_value = db.Column(db.Numeric(10, 2), nullable=False)
    minimum_order_amount = db.Column(db.Numeric(10, 2), default=0.00, nullable=False)
    maximum_discount = db.Column(db.Numeric(10, 2), nullable=True)
    usage_limit = db.Column(db.Integer, nullable=True)  # Overall limit
    per_user_limit = db.Column(db.Integer, default=1, nullable=False)
    used_count = db.Column(db.Integer, default=0, nullable=False)
    start_date = db.Column(db.DateTime(timezone=True), nullable=True)
    end_date = db.Column(db.DateTime(timezone=True), nullable=True)
    is_active = db.Column(db.Boolean, default=True, nullable=False, index=True)
    created_at = db.Column(db.DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)

    # Relationships
    usages = db.relationship("CouponUsage", back_populates="coupon", cascade="all, delete-orphan", lazy="dynamic")
    orders = db.relationship("Order", back_populates="coupon", lazy="dynamic")

    def __repr__(self):
        return f"<Coupon id={self.id} code='{self.code}' type='{self.discount_type}' val={self.discount_value}>"

    def to_dict(self):
        return {
            "id": self.id,
            "code": self.code,
            "description": self.description,
            "discount_type": self.discount_type,
            "discount_value": float(self.discount_value),
            "minimum_order_amount": float(self.minimum_order_amount),
            "maximum_discount": float(self.maximum_discount) if self.maximum_discount is not None else None,
            "usage_limit": self.usage_limit,
            "per_user_limit": self.per_user_limit,
            "used_count": self.used_count,
            "start_date": self.start_date.isoformat() if self.start_date else None,
            "end_date": self.end_date.isoformat() if self.end_date else None,
            "is_active": self.is_active,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
