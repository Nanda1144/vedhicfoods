from flask import Blueprint, request
from sqlalchemy import func
from app.extensions import db
from app.middleware.auth_middleware import admin_required
from app.models.user import User
from app.models.category import Category
from app.models.product import Product
from app.models.product_image import ProductImage
from app.models.order import Order
from app.models.coupon import Coupon
from app.models.banner import Banner
from app.schemas.category import CategoryCreateSchema, CategoryUpdateSchema
from app.schemas.product import ProductCreateSchema, ProductUpdateSchema
from app.schemas.coupon import CouponCreateSchema, CouponUpdateSchema
from app.schemas.order import OrderStatusUpdateSchema
from app.schemas.banner import BannerCreateSchema, BannerUpdateSchema
from app.services.product_service import ProductService
from app.services.order_service import OrderService
from app.services.s3_service import S3Service
from app.utils.response import success_response, error_response
from app.utils.helpers import slugify, format_pagination

admin_bp = Blueprint("admin", __name__, url_prefix="/api/admin")

cat_create_schema = CategoryCreateSchema()
cat_update_schema = CategoryUpdateSchema()
prod_create_schema = ProductCreateSchema()
prod_update_schema = ProductUpdateSchema()
coupon_create_schema = CouponCreateSchema()
coupon_update_schema = CouponUpdateSchema()
order_status_schema = OrderStatusUpdateSchema()
banner_create_schema = BannerCreateSchema()
banner_update_schema = BannerUpdateSchema()


# --------------------------------------------------------------------------
# Dashboard
# --------------------------------------------------------------------------
@admin_bp.get("/dashboard")
@admin_required()
def dashboard_stats():
    """
    Get aggregate dashboard metrics and analytics
    ---
    tags:
      - Admin
    security:
      - bearerAuth: []
    """
    total_users = User.query.filter_by(role="USER").count()
    active_products = Product.query.filter_by(is_active=True).count()
    total_orders = Order.query.count()
    pending_orders = Order.query.filter(Order.order_status.in_(["PENDING", "CONFIRMED", "PACKED"])).count()
    completed_orders = Order.query.filter_by(order_status="DELIVERED").count()

    # Total revenue from paid orders
    rev_res = db.session.query(func.coalesce(func.sum(Order.total_amount), 0)).filter(
        Order.payment_status == "PAID"
    ).scalar()
    total_revenue = float(rev_res or 0.0)

    active_coupons = Coupon.query.filter_by(is_active=True).count()

    # Low stock products (stock <= 10)
    low_stock = Product.query.filter(Product.stock_quantity <= 10).all()

    # Recent orders
    recent_orders = Order.query.order_by(Order.created_at.desc()).limit(10).all()

    return success_response(
        data={
            "metrics": {
                "total_users": total_users,
                "active_products": active_products,
                "total_orders": total_orders,
                "pending_orders": pending_orders,
                "completed_orders": completed_orders,
                "total_revenue": round(total_revenue, 2),
                "active_coupons": active_coupons,
            },
            "low_stock_products": [p.to_dict() for p in low_stock],
            "recent_orders": [o.to_dict() for o in recent_orders],
        },
        message="Dashboard statistics retrieved",
    )


# --------------------------------------------------------------------------
# Categories Management
# --------------------------------------------------------------------------
@admin_bp.post("/categories")
@admin_required()
def create_category():
    """Create a new category."""
    data = cat_create_schema.load(request.get_json() or {})
    name = data["name"].strip()
    slug = data.get("slug") or slugify(name)

    if Category.query.filter((Category.name == name) | (Category.slug == slug)).first():
        return error_response(message="Category name or slug already exists", status_code=409)

    category = Category(
        name=name,
        slug=slug,
        description=data.get("description"),
        image_url=data.get("image_url"),
        is_active=data.get("is_active", True),
    )
    db.session.add(category)
    db.session.commit()
    return success_response(data=category.to_dict(), message="Category created", status_code=201)


@admin_bp.put("/categories/<int:category_id>")
@admin_required()
def update_category(category_id: int):
    """Update a category."""
    category = db.session.get(Category, category_id)
    if not category:
        return error_response(message="Category not found", status_code=404)

    data = cat_update_schema.load(request.get_json() or {})
    if "name" in data and data["name"]:
        category.name = data["name"].strip()
    if "slug" in data and data["slug"]:
        new_slug = slugify(data["slug"])
        existing = Category.query.filter(Category.slug == new_slug, Category.id != category.id).first()
        if existing:
            return error_response(message="Slug already exists", status_code=409)
        category.slug = new_slug
    if "description" in data:
        category.description = data["description"]
    if "image_url" in data:
        category.image_url = data["image_url"]
    if "is_active" in data and data["is_active"] is not None:
        category.is_active = data["is_active"]

    db.session.commit()
    return success_response(data=category.to_dict(), message="Category updated")


@admin_bp.delete("/categories/<int:category_id>")
@admin_required()
def delete_category(category_id: int):
    """Delete a category."""
    category = db.session.get(Category, category_id)
    if not category:
        return error_response(message="Category not found", status_code=404)

    db.session.delete(category)
    db.session.commit()
    return success_response(message="Category deleted successfully")


# --------------------------------------------------------------------------
# Products Management
# --------------------------------------------------------------------------
@admin_bp.post("/products")
@admin_required()
def create_product():
    """Create a new product."""
    data = prod_create_schema.load(request.get_json() or {})
    try:
        product = ProductService.create_product(data)
        return success_response(data=product.to_dict(), message="Product created successfully", status_code=201)
    except ValueError as e:
        return error_response(message=str(e), status_code=400)


@admin_bp.put("/products/<int:product_id>")
@admin_required()
def update_product(product_id: int):
    """Update product details."""
    product = db.session.get(Product, product_id)
    if not product:
        return error_response(message="Product not found", status_code=404)

    data = prod_update_schema.load(request.get_json() or {})
    try:
        updated = ProductService.update_product(product, data)
        return success_response(data=updated.to_dict(), message="Product updated successfully")
    except ValueError as e:
        return error_response(message=str(e), status_code=400)


@admin_bp.delete("/products/<int:product_id>")
@admin_required()
def delete_product(product_id: int):
    """Delete product."""
    product = db.session.get(Product, product_id)
    if not product:
        return error_response(message="Product not found", status_code=404)

    ProductService.delete_product(product)
    return success_response(message="Product deleted successfully")


@admin_bp.post("/products/<int:product_id>/images")
@admin_required()
def upload_product_image(product_id: int):
    """
    Upload and attach product image to AWS S3.
    Accepts multipart/form-data with 'image' file field.
    """
    product = db.session.get(Product, product_id)
    if not product:
        return error_response(message="Product not found", status_code=404)

    if "image" not in request.files:
        return error_response(message="No 'image' file provided in request", status_code=400)

    file = request.files["image"]
    display_order = request.form.get("display_order", 0, type=int)

    try:
        upload_result = S3Service.upload_image(file=file, folder="products")
        img_record = ProductService.add_product_image(
            product_id=product.id,
            image_url=upload_result["image_url"],
            s3_key=upload_result.get("s3_key"),
            display_order=display_order,
        )
        return success_response(
            data=img_record.to_dict(),
            message="Product image uploaded successfully",
            status_code=201,
        )
    except (ValueError, RuntimeError) as e:
        return error_response(message=str(e), status_code=400)


@admin_bp.delete("/products/<int:product_id>/images/<int:image_id>")
@admin_required()
def delete_product_image(product_id: int, image_id: int):
    """Delete an image attached to a product."""
    success = ProductService.delete_product_image(product_id=product_id, image_id=image_id)
    if not success:
        return error_response(message="Image not found", status_code=404)
    return success_response(message="Product image deleted successfully")


# --------------------------------------------------------------------------
# Coupons Management
# --------------------------------------------------------------------------
@admin_bp.post("/coupons")
@admin_required()
def create_coupon():
    """Create a new discount coupon."""
    data = coupon_create_schema.load(request.get_json() or {})
    code = data["code"].strip().upper()

    if Coupon.query.filter_by(code=code).first():
        return error_response(message=f"Coupon code '{code}' already exists", status_code=409)

    coupon = Coupon(
        code=code,
        description=data.get("description"),
        discount_type=data["discount_type"],
        discount_value=data["discount_value"],
        minimum_order_amount=data.get("minimum_order_amount", 0.0),
        maximum_discount=data.get("maximum_discount"),
        usage_limit=data.get("usage_limit"),
        per_user_limit=data.get("per_user_limit", 1),
        start_date=data.get("start_date"),
        end_date=data.get("end_date"),
        is_active=data.get("is_active", True),
    )
    db.session.add(coupon)
    db.session.commit()
    return success_response(data=coupon.to_dict(), message="Coupon created successfully", status_code=201)


@admin_bp.put("/coupons/<int:coupon_id>")
@admin_required()
def update_coupon(coupon_id: int):
    """Update a discount coupon."""
    coupon = db.session.get(Coupon, coupon_id)
    if not coupon:
        return error_response(message="Coupon not found", status_code=404)

    data = coupon_update_schema.load(request.get_json() or {})
    for field in ["description", "discount_type", "discount_value", "minimum_order_amount", "maximum_discount", "usage_limit", "per_user_limit", "start_date", "end_date", "is_active"]:
        if field in data and data[field] is not None:
            setattr(coupon, field, data[field])

    db.session.commit()
    return success_response(data=coupon.to_dict(), message="Coupon updated successfully")


@admin_bp.delete("/coupons/<int:coupon_id>")
@admin_required()
def delete_coupon(coupon_id: int):
    """Delete a coupon."""
    coupon = db.session.get(Coupon, coupon_id)
    if not coupon:
        return error_response(message="Coupon not found", status_code=404)

    db.session.delete(coupon)
    db.session.commit()
    return success_response(message="Coupon deleted successfully")


# --------------------------------------------------------------------------
# Orders Management
# --------------------------------------------------------------------------
@admin_bp.get("/orders")
@admin_required()
def list_admin_orders():
    """List all customer orders with filtering and pagination."""
    page = request.args.get("page", 1, type=int)
    per_page = request.args.get("per_page", 20, type=int)
    status = request.args.get("status")
    search = request.args.get("search")

    query = Order.query

    if status:
        query = query.filter(Order.order_status == status.upper())

    if search:
        search_term = f"%{search.strip()}%"
        query = query.filter(Order.order_number.ilike(search_term))

    pagination = query.order_by(Order.created_at.desc()).paginate(page=page, per_page=per_page, error_out=False)
    items = [o.to_dict() for o in pagination.items]
    return success_response(data=format_pagination(pagination, items), message="Admin orders retrieved")


@admin_bp.put("/orders/<int:order_id>/status")
@admin_required()
def update_order_status(order_id: int):
    """Update order status or payment status."""
    order = db.session.get(Order, order_id)
    if not order:
        return error_response(message="Order not found", status_code=404)

    data = order_status_schema.load(request.get_json() or {})
    updated = OrderService.update_order_status(
        order=order,
        new_order_status=data.get("order_status"),
        new_payment_status=data.get("payment_status"),
    )
    return success_response(data=updated.to_dict(), message="Order status updated")


# --------------------------------------------------------------------------
# Banners Management
# --------------------------------------------------------------------------
@admin_bp.post("/banners")
@admin_required()
def create_banner():
    """
    Create a new promotional banner.
    Supports either image file upload or image_url.
    """
    image_url = None
    s3_key = None

    if "image" in request.files:
        file = request.files["image"]
        try:
            upload_res = S3Service.upload_image(file=file, folder="banners")
            image_url = upload_res["image_url"]
            s3_key = upload_res.get("s3_key")
        except (ValueError, RuntimeError) as e:
            return error_response(message=str(e), status_code=400)

    # May receive json or form data
    raw_data = request.form.to_dict() if request.form else (request.get_json() or {})
    if image_url:
        raw_data["image_url"] = image_url

    data = banner_create_schema.load(raw_data)
    if not data.get("image_url"):
        return error_response(message="An image file or image_url is required", status_code=400)

    banner = Banner(
        title=data["title"].strip(),
        description=data.get("description"),
        image_url=data["image_url"],
        s3_key=s3_key,
        link_url=data.get("link_url"),
        display_order=data.get("display_order", 0),
        is_active=data.get("is_active", True),
        start_date=data.get("start_date"),
        end_date=data.get("end_date"),
    )
    db.session.add(banner)
    db.session.commit()
    return success_response(data=banner.to_dict(), message="Banner created successfully", status_code=201)


@admin_bp.put("/banners/<int:banner_id>")
@admin_required()
def update_banner(banner_id: int):
    """Update a promotional banner."""
    banner = db.session.get(Banner, banner_id)
    if not banner:
        return error_response(message="Banner not found", status_code=404)

    raw_data = request.form.to_dict() if request.form else (request.get_json() or {})
    if "image" in request.files:
        file = request.files["image"]
        try:
            upload_res = S3Service.upload_image(file=file, folder="banners")
            banner.image_url = upload_res["image_url"]
            banner.s3_key = upload_res.get("s3_key")
        except (ValueError, RuntimeError) as e:
            return error_response(message=str(e), status_code=400)

    data = banner_update_schema.load(raw_data)
    for field in ["title", "description", "image_url", "link_url", "display_order", "is_active", "start_date", "end_date"]:
        if field in data and data[field] is not None:
            setattr(banner, field, data[field])

    db.session.commit()
    return success_response(data=banner.to_dict(), message="Banner updated")


@admin_bp.delete("/banners/<int:banner_id>")
@admin_required()
def delete_banner(banner_id: int):
    """Delete a promotional banner."""
    banner = db.session.get(Banner, banner_id)
    if not banner:
        return error_response(message="Banner not found", status_code=404)

    if banner.s3_key:
        S3Service.delete_image(banner.s3_key)

    db.session.delete(banner)
    db.session.commit()
    return success_response(message="Banner deleted successfully")
