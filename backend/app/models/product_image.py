from app.extensions import db
from app.utils.helpers import utc_now


class ProductImage(db.Model):
    __tablename__ = "product_images"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    product_id = db.Column(db.Integer, db.ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True)
    image_url = db.Column(db.String(500), nullable=False)
    s3_key = db.Column(db.String(255), nullable=True)
    display_order = db.Column(db.Integer, default=0, nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=utc_now, nullable=False)

    # Relationships
    product = db.relationship("Product", back_populates="images")

    def __repr__(self):
        return f"<ProductImage id={self.id} product_id={self.product_id} order={self.display_order}>"

    def to_dict(self):
        return {
            "id": self.id,
            "product_id": self.product_id,
            "image_url": self.image_url,
            "s3_key": self.s3_key,
            "display_order": self.display_order,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
