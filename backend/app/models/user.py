from app.extensions import db
from app.utils.helpers import utc_now


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    full_name = db.Column(db.String(120), nullable=False)
    email = db.Column(db.String(255), unique=True, nullable=False, index=True)
    phone = db.Column(db.String(20), nullable=True)
    password_hash = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(20), default="USER", nullable=False)  # 'USER', 'ADMIN'
    is_active = db.Column(db.Boolean, default=True, nullable=False)
    is_verified = db.Column(db.Boolean, default=False, nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)

    # Relationships
    cart = db.relationship("Cart", back_populates="user", uselist=False, cascade="all, delete-orphan")
    addresses = db.relationship("Address", back_populates="user", cascade="all, delete-orphan", lazy="dynamic")
    orders = db.relationship("Order", back_populates="user", lazy="dynamic")
    wishlist_items = db.relationship("Wishlist", back_populates="user", cascade="all, delete-orphan", lazy="dynamic")
    notifications = db.relationship("Notification", back_populates="user", cascade="all, delete-orphan", lazy="dynamic")
    coupon_usages = db.relationship("CouponUsage", back_populates="user", lazy="dynamic")

    def __repr__(self):
        return f"<User id={self.id} email='{self.email}' role='{self.role}'>"

    def to_dict(self, include_sensitive: bool = False):
        """Safe user serialization (never returns password_hash)."""
        data = {
            "id": self.id,
            "full_name": self.full_name,
            "email": self.email,
            "phone": self.phone,
            "role": self.role,
            "is_active": self.is_active,
            "is_verified": self.is_verified,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
        if include_sensitive:
            pass  # Even with flag, never expose password hash
        return data
