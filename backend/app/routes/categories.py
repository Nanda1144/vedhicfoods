from flask import Blueprint, request
from app.models.category import Category
from app.utils.response import success_response, error_response

categories_bp = Blueprint("categories", __name__, url_prefix="/api/categories")


@categories_bp.get("")
def list_categories():
    """
    List all product categories
    ---
    tags:
      - Categories
    parameters:
      - in: query
        name: is_active
        schema:
          type: boolean
        description: Filter active categories (defaults to true)
    responses:
      200:
        description: List of categories
    """
    is_active_param = request.args.get("is_active")
    query = Category.query

    if is_active_param is not None:
        is_active = is_active_param.lower() in ["true", "1", "yes"]
        query = query.filter(Category.is_active == is_active)
    else:
        # By default for public API, return active categories
        query = query.filter(Category.is_active.is_(True))

    categories = query.order_by(Category.name.asc()).all()
    return success_response(
        data=[cat.to_dict() for cat in categories],
        message="Categories retrieved successfully",
    )


@categories_bp.get("/<id_or_slug>")
def get_category(id_or_slug: str):
    """
    Get a category by ID or by Slug
    ---
    tags:
      - Categories
    parameters:
      - in: path
        name: id_or_slug
        required: true
        schema:
          type: string
        description: Category ID (integer) or unique slug
    responses:
      200:
        description: Category details
      404:
        description: Category not found
    """
    from app.extensions import db
    if id_or_slug.isdigit():
        category = db.session.get(Category, int(id_or_slug))
    else:
        category = Category.query.filter_by(slug=id_or_slug.strip().lower()).first()

    if not category:
        return error_response(message=f"Category '{id_or_slug}' not found", status_code=404)

    return success_response(data=category.to_dict(), message="Category retrieved")
