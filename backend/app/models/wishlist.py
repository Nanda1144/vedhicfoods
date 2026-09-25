from app.extensions import db
from app.utils.helpers import utc_now


class Wishlist(db.Model):
    __tablename__ = "wishlists"
    __table_args__ = (
        db.UniqueConstraint("user_id", "product_id", name="uq_user_wishlist_product"),
    )

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    product_id = db.Column(db.Integer, db.ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = db.Column(db.DateTime(timezone=True), default=utc_now, nullable=False)

    # Relationships
    user = db.relationship("User", back_populates="wishlist_items")
    product = db.relationship("Product", back_populates="wishlist_items")

    def __repr__(self):
        return f"<Wishlist id={self.id} user_id={self.user_id} product_id={self.product_id}>"

    def to_dict(self):
        return {
            "id": self.id,
            "user_id": self.user_id,
            "product_id": self.product_id,
            "product": self.product.to_dict() if self.product else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
