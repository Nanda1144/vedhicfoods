from app.extensions import db
from app.utils.helpers import utc_now


class Product(db.Model):
    __tablename__ = "products"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    category_id = db.Column(db.Integer, db.ForeignKey("categories.id", ondelete="CASCADE"), nullable=False, index=True)
    name = db.Column(db.String(200), nullable=False)
    slug = db.Column(db.String(220), unique=True, nullable=False, index=True)
    description = db.Column(db.Text, nullable=True)
    price = db.Column(db.Numeric(10, 2), nullable=False)
    discount_percentage = db.Column(db.Numeric(5, 2), default=0.00, nullable=False)
    final_price = db.Column(db.Numeric(10, 2), nullable=False)
    stock_quantity = db.Column(db.Integer, default=0, nullable=False)
    unit = db.Column(db.String(50), default="piece", nullable=False)
    sku = db.Column(db.String(100), unique=True, nullable=False, index=True)
    is_active = db.Column(db.Boolean, default=True, nullable=False, index=True)
    is_featured = db.Column(db.Boolean, default=False, nullable=False, index=True)
    created_at = db.Column(db.DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)

    # Relationships
    category = db.relationship("Category", back_populates="products")
    images = db.relationship(
        "ProductImage",
        back_populates="product",
        cascade="all, delete-orphan",
        order_by="ProductImage.display_order",
        lazy="select",
    )
    cart_items = db.relationship("CartItem", back_populates="product", cascade="all, delete-orphan", lazy="dynamic")
    order_items = db.relationship("OrderItem", back_populates="product", lazy="dynamic")
    wishlist_items = db.relationship("Wishlist", back_populates="product", cascade="all, delete-orphan", lazy="dynamic")

    def __repr__(self):
        return f"<Product id={self.id} sku='{self.sku}' name='{self.name}'>"

    def calculate_final_price(self) -> float:
        """Calculate server-side final price based on price and discount_percentage."""
        p = float(self.price or 0.0)
        d = float(self.discount_percentage or 0.0)
        if d <= 0:
            return round(p, 2)
        if d >= 100:
            return 0.0
        return round(p * (1.0 - (d / 100.0)), 2)

    def to_dict(self):
        return {
            "id": self.id,
            "category_id": self.category_id,
            "category_name": self.category.name if self.category else None,
            "category_slug": self.category.slug if self.category else None,
            "name": self.name,
            "slug": self.slug,
            "description": self.description,
            "price": float(self.price),
            "discount_percentage": float(self.discount_percentage),
            "final_price": float(self.final_price),
            "stock_quantity": self.stock_quantity,
            "unit": self.unit,
            "sku": self.sku,
            "is_active": self.is_active,
            "is_featured": self.is_featured,
            "images": [img.to_dict() for img in self.images] if self.images else [],
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
