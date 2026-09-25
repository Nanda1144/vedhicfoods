from flask import Blueprint, request
from app.models.product import Product
from app.schemas.product import ProductQuerySchema
from app.services.product_service import ProductService
from app.utils.response import success_response, error_response

products_bp = Blueprint("products", __name__, url_prefix="/api/products")

query_schema = ProductQuerySchema()


@products_bp.get("")
def list_products():
    """
    List products with pagination, search, category filtering, and sorting
    ---
    tags:
      - Products
    parameters:
      - in: query
        name: page
        schema:
          type: integer
          default: 1
      - in: query
        name: per_page
        schema:
          type: integer
          default: 20
      - in: query
        name: category_id
        schema:
          type: integer
      - in: query
        name: category_slug
        schema:
          type: string
      - in: query
        name: search
        schema:
          type: string
      - in: query
        name: min_price
        schema:
          type: number
      - in: query
        name: max_price
        schema:
          type: number
      - in: query
        name: is_featured
        schema:
          type: boolean
      - in: query
        name: sort
        schema:
          type: string
          enum: [featured, newest, price_asc, price_desc, name_asc, bestsellers]
    responses:
      200:
        description: Paginated product results
    """
    # Load and validate query parameters
    args_dict = request.args.to_dict()
    # Cast boolean strings if present
    if "is_featured" in args_dict:
        args_dict["is_featured"] = args_dict["is_featured"].lower() in ["true", "1", "yes"]
    if "is_active" in args_dict:
        args_dict["is_active"] = args_dict["is_active"].lower() in ["true", "1", "yes"]
    else:
        # Default public API to active products only
        args_dict["is_active"] = True

    filters = query_schema.load(args_dict)
    results = ProductService.list_products(filters)
    return success_response(data=results, message="Products retrieved successfully")


@products_bp.get("/<id_or_slug>")
def get_product(id_or_slug: str):
    """
    Get single product by ID or Slug
    ---
    tags:
      - Products
    parameters:
      - in: path
        name: id_or_slug
        required: true
        schema:
          type: string
    responses:
      200:
        description: Product details with images and category info
      404:
        description: Product not found
    """
    from app.extensions import db
    if id_or_slug.isdigit():
        product = db.session.get(Product, int(id_or_slug))
    else:
        product = Product.query.filter_by(slug=id_or_slug.strip().lower()).first()

    if not product:
        return error_response(message=f"Product '{id_or_slug}' not found", status_code=404)

    return success_response(data=product.to_dict(), message="Product retrieved")
