import uuid
from typing import Dict, Any, Tuple
from sqlalchemy import or_
from app.extensions import db
from app.models.product import Product
from app.models.product_image import ProductImage
from app.models.category import Category
from app.utils.helpers import slugify, format_pagination
from app.services.s3_service import S3Service


class ProductService:
    """Service layer for Product catalog management, pricing, search, and images."""

    @staticmethod
    def calculate_final_price(price: float, discount_percentage: float) -> float:
        """Enforce server-side calculated pricing."""
        p = float(price or 0.0)
        d = float(discount_percentage or 0.0)
        if d <= 0:
            return round(p, 2)
        if d >= 100:
            return 0.0
        return round(p * (1.0 - (d / 100.0)), 2)

    @classmethod
    def create_product(cls, data: Dict[str, Any]) -> Product:
        """Create a new product with verified category and calculated final_price."""
        category = db.session.get(Category, data["category_id"])
        if not category:
            raise ValueError(f"Category with ID {data['category_id']} does not exist")

        base_slug = data.get("slug") or slugify(data["name"])
        # Ensure unique slug
        slug = base_slug
        counter = 1
        while Product.query.filter_by(slug=slug).first() is not None:
            slug = f"{base_slug}-{counter}"
            counter += 1

        # Generate unique SKU if not provided
        sku = data.get("sku")
        if not sku:
            sku = f"SKU-{uuid.uuid4().hex[:8].upper()}"
        else:
            sku = sku.strip().upper()
            if Product.query.filter_by(sku=sku).first() is not None:
                raise ValueError(f"Product with SKU '{sku}' already exists")

        price = float(data["price"])
        discount_percentage = float(data.get("discount_percentage", 0.0))
        final_price = cls.calculate_final_price(price, discount_percentage)

        product = Product(
            category_id=category.id,
            name=data["name"].strip(),
            slug=slug,
            description=data.get("description"),
            price=price,
            discount_percentage=discount_percentage,
            final_price=final_price,
            stock_quantity=int(data.get("stock_quantity", 0)),
            unit=data.get("unit", "piece"),
            sku=sku,
            is_active=data.get("is_active", True),
            is_featured=data.get("is_featured", False),
        )
        db.session.add(product)
        db.session.flush()

        # Handle optional initial image URLs list
        image_urls = data.get("images", [])
        for order_idx, img_url in enumerate(image_urls):
            if img_url:
                img_record = ProductImage(
                    product_id=product.id,
                    image_url=img_url,
                    display_order=order_idx,
                )
                db.session.add(img_record)

        db.session.commit()
        return product

    @classmethod
    def update_product(cls, product: Product, data: Dict[str, Any]) -> Product:
        """Update product details and recalculate final_price if price/discount changed."""
        if "category_id" in data and data["category_id"]:
            cat = db.session.get(Category, data["category_id"])
            if not cat:
                raise ValueError(f"Category with ID {data['category_id']} does not exist")
            product.category_id = cat.id

        if "name" in data and data["name"]:
            product.name = data["name"].strip()

        if "slug" in data and data["slug"]:
            new_slug = slugify(data["slug"])
            existing = Product.query.filter(Product.slug == new_slug, Product.id != product.id).first()
            if existing:
                raise ValueError(f"Slug '{new_slug}' is already in use by another product")
            product.slug = new_slug

        if "sku" in data and data["sku"]:
            new_sku = data["sku"].strip().upper()
            existing = Product.query.filter(Product.sku == new_sku, Product.id != product.id).first()
            if existing:
                raise ValueError(f"SKU '{new_sku}' is already in use by another product")
            product.sku = new_sku

        if "description" in data:
            product.description = data["description"]
        if "stock_quantity" in data and data["stock_quantity"] is not None:
            product.stock_quantity = int(data["stock_quantity"])
        if "unit" in data and data["unit"]:
            product.unit = data["unit"]
        if "is_active" in data and data["is_active"] is not None:
            product.is_active = bool(data["is_active"])
        if "is_featured" in data and data["is_featured"] is not None:
            product.is_featured = bool(data["is_featured"])

        # Update pricing
        price_changed = "price" in data and data["price"] is not None
        discount_changed = "discount_percentage" in data and data["discount_percentage"] is not None

        if price_changed:
            product.price = float(data["price"])
        if discount_changed:
            product.discount_percentage = float(data["discount_percentage"])

        if price_changed or discount_changed:
            product.final_price = cls.calculate_final_price(
                float(product.price),
                float(product.discount_percentage),
            )

        db.session.commit()
        return product

    @staticmethod
    def delete_product(product: Product) -> None:
        """Delete product and its images."""
        for img in product.images:
            if img.s3_key:
                S3Service.delete_image(img.s3_key)
        db.session.delete(product)
        db.session.commit()

    @staticmethod
    def list_products(filters: Dict[str, Any]) -> Dict[str, Any]:
        """Query products with filtering, searching, sorting, and pagination."""
        query = Product.query

        # Active filter
        if filters.get("is_active") is not None:
            query = query.filter(Product.is_active == filters["is_active"])

        # Featured filter
        if filters.get("is_featured") is not None:
            query = query.filter(Product.is_featured == filters["is_featured"])

        # Category ID filter
        if filters.get("category_id"):
            query = query.filter(Product.category_id == filters["category_id"])

        # Category Slug filter
        if filters.get("category_slug"):
            query = query.join(Category).filter(Category.slug == filters["category_slug"].strip().lower())

        # Price range filters (applied on final_price)
        if filters.get("min_price") is not None:
            query = query.filter(Product.final_price >= filters["min_price"])
        if filters.get("max_price") is not None:
            query = query.filter(Product.final_price <= filters["max_price"])

        # Search filter (name or description)
        search = filters.get("search")
        if search:
            search_term = f"%{search.strip()}%"
            query = query.filter(
                or_(
                    Product.name.ilike(search_term),
                    Product.description.ilike(search_term),
                    Product.sku.ilike(search_term),
                )
            )

        # Sorting
        sort_by = filters.get("sort", "featured")
        if sort_by == "newest":
            query = query.order_by(Product.created_at.desc())
        elif sort_by == "price_asc":
            query = query.order_by(Product.final_price.asc())
        elif sort_by == "price_desc":
            query = query.order_by(Product.final_price.desc())
        elif sort_by == "name_asc":
            query = query.order_by(Product.name.asc())
        elif sort_by == "bestsellers":
            query = query.order_by(Product.stock_quantity.desc())
        else:  # 'featured' default
            query = query.order_by(Product.is_featured.desc(), Product.created_at.desc())

        # Pagination
        page = filters.get("page", 1)
        per_page = filters.get("per_page", 20)
        pagination = query.paginate(page=page, per_page=per_page, error_out=False)

        serialized_items = [p.to_dict() for p in pagination.items]
        return format_pagination(pagination, serialized_items)

    @staticmethod
    def add_product_image(product_id: int, image_url: str, s3_key: str = None, display_order: int = 0) -> ProductImage:
        """Attach an image to a product."""
        product = db.session.get(Product, product_id)
        if not product:
            raise ValueError(f"Product with ID {product_id} does not exist")

        img = ProductImage(
            product_id=product.id,
            image_url=image_url,
            s3_key=s3_key,
            display_order=display_order,
        )
        db.session.add(img)
        db.session.commit()
        return img

    @staticmethod
    def delete_product_image(product_id: int, image_id: int) -> bool:
        """Delete a product image by ID."""
        img = ProductImage.query.filter_by(id=image_id, product_id=product_id).first()
        if not img:
            return False

        if img.s3_key:
            S3Service.delete_image(img.s3_key)

        db.session.delete(img)
        db.session.commit()
        return True
