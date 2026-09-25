from app.extensions import db
from app.utils.helpers import utc_now


class Order(db.Model):
    __tablename__ = "orders"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    order_number = db.Column(db.String(50), unique=True, nullable=False, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True)
    address_id = db.Column(db.Integer, db.ForeignKey("addresses.id", ondelete="SET NULL"), nullable=True)
    coupon_id = db.Column(db.Integer, db.ForeignKey("coupons.id", ondelete="SET NULL"), nullable=True)

    subtotal = db.Column(db.Numeric(10, 2), nullable=False)
    discount_amount = db.Column(db.Numeric(10, 2), default=0.00, nullable=False)
    delivery_fee = db.Column(db.Numeric(10, 2), default=0.00, nullable=False)
    tax_amount = db.Column(db.Numeric(10, 2), default=0.00, nullable=False)
    total_amount = db.Column(db.Numeric(10, 2), nullable=False)

    payment_status = db.Column(db.String(20), default="PENDING", nullable=False)  # PENDING, PAID, FAILED, REFUNDED
    order_status = db.Column(db.String(20), default="PENDING", nullable=False)    # PENDING, CONFIRMED, PACKED, SHIPPED, DELIVERED, CANCELLED
    notes = db.Column(db.Text, nullable=True)

    created_at = db.Column(db.DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)

    # Relationships
    user = db.relationship("User", back_populates="orders")
    address = db.relationship("Address", back_populates="orders")
    coupon = db.relationship("Coupon", back_populates="orders")
    items = db.relationship("OrderItem", back_populates="order", cascade="all, delete-orphan", lazy="joined")
    payments = db.relationship("Payment", back_populates="order", lazy="dynamic")
    coupon_usage = db.relationship("CouponUsage", back_populates="order", uselist=False)

    def __repr__(self):
        return f"<Order id={self.id} number='{self.order_number}' status='{self.order_status}'>"

    def to_dict(self):
        return {
            "id": self.id,
            "order_number": self.order_number,
            "user_id": self.user_id,
            "customer_name": self.user.full_name if self.user else None,
            "customer_email": self.user.email if self.user else None,
            "address": self.address.to_dict() if self.address else None,
            "coupon_code": self.coupon.code if self.coupon else None,
            "subtotal": float(self.subtotal),
            "discount_amount": float(self.discount_amount),
            "delivery_fee": float(self.delivery_fee),
            "tax_amount": float(self.tax_amount),
            "total_amount": float(self.total_amount),
            "payment_status": self.payment_status,
            "order_status": self.order_status,
            "notes": self.notes,
            "items": [item.to_dict() for item in self.items] if self.items else [],
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
