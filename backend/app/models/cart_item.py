from app.extensions import db
from app.utils.helpers import utc_now


class CartItem(db.Model):
    __tablename__ = "cart_items"
    __table_args__ = (
        db.UniqueConstraint("cart_id", "product_id", name="uq_cart_product"),
    )

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    cart_id = db.Column(db.Integer, db.ForeignKey("carts.id", ondelete="CASCADE"), nullable=False, index=True)
    product_id = db.Column(db.Integer, db.ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True)
    quantity = db.Column(db.Integer, default=1, nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)

    # Relationships
    cart = db.relationship("Cart", back_populates="items")
    product = db.relationship("Product", back_populates="cart_items")

    def __repr__(self):
        return f"<CartItem id={self.id} cart_id={self.cart_id} product_id={self.product_id} qty={self.quantity}>"

    def to_dict(self):
        prod = self.product
        price = float(prod.final_price) if prod else 0.0
        mrp = float(prod.price) if prod else 0.0
        primary_image = prod.images[0].image_url if prod and prod.images else None

        return {
            "id": self.id,
            "cart_id": self.cart_id,
            "product_id": self.product_id,
            "name": prod.name if prod else "Unknown Product",
            "slug": prod.slug if prod else "",
            "image": primary_image,
            "unit": prod.unit if prod else "",
            "price": price,
            "mrp": mrp,
            "quantity": self.quantity,
            "stock": prod.stock_quantity if prod else 0,
            "subtotal": round(price * self.quantity, 2),
            "mrp_subtotal": round(mrp * self.quantity, 2),
            "is_active": prod.is_active if prod else False,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
