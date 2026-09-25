from app.extensions import db
from app.utils.helpers import utc_now


class Payment(db.Model):
    __tablename__ = "payments"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    order_id = db.Column(db.Integer, db.ForeignKey("orders.id", ondelete="RESTRICT"), nullable=False, index=True)
    provider = db.Column(db.String(50), default="razorpay", nullable=False)
    provider_order_id = db.Column(db.String(100), nullable=True, index=True)
    provider_payment_id = db.Column(db.String(100), nullable=True, index=True)
    provider_signature = db.Column(db.String(255), nullable=True)
    idempotent_key = db.Column(db.String(100), unique=True, nullable=True, index=True)
    amount = db.Column(db.Numeric(10, 2), nullable=False)
    currency = db.Column(db.String(10), default="INR", nullable=False)
    status = db.Column(db.String(20), default="PENDING", nullable=False)  # PENDING, SUCCESS, FAILED, REFUNDED
    created_at = db.Column(db.DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)

    # Relationships
    order = db.relationship("Order", back_populates="payments")

    def __repr__(self):
        return f"<Payment id={self.id} order_id={self.order_id} status='{self.status}' amt={self.amount}>"

    def to_dict(self):
        return {
            "id": self.id,
            "order_id": self.order_id,
            "provider": self.provider,
            "provider_order_id": self.provider_order_id,
            "provider_payment_id": self.provider_payment_id,
            "amount": float(self.amount),
            "currency": self.currency,
            "status": self.status,
            "idempotent_key": self.idempotent_key,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
