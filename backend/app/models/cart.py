from app.extensions import db
from app.utils.helpers import utc_now


class Cart(db.Model):
    __tablename__ = "carts"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False, index=True)
    created_at = db.Column(db.DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)

    # Relationships
    user = db.relationship("User", back_populates="cart")
    items = db.relationship("CartItem", back_populates="cart", cascade="all, delete-orphan", lazy="joined")

    def __repr__(self):
        return f"<Cart id={self.id} user_id={self.user_id}>"

    def to_dict(self):
        # Calculate subtotal, total from current DB items
        items_data = []
        subtotal = 0.0
        savings = 0.0
        total_items = 0

        for item in self.items:
            item_dict = item.to_dict()
            items_data.append(item_dict)
            subtotal += item_dict["subtotal"]
            savings += (item_dict["mrp_subtotal"] - item_dict["subtotal"])
            total_items += item.quantity

        return {
            "id": self.id,
            "user_id": self.user_id,
            "items": items_data,
            "totals": {
                "subtotal": round(subtotal, 2),
                "savings": round(max(0.0, savings), 2),
                "total": round(subtotal, 2),
                "item_count": total_items,
            },
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
