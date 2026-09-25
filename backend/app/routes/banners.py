from flask import Blueprint
from datetime import datetime, timezone
from app.models.banner import Banner
from app.utils.response import success_response

banners_bp = Blueprint("banners", __name__, url_prefix="/api/banners")


@banners_bp.get("")
def list_active_banners():
    """List all active banners for homepage/promotions."""
    now = datetime.now(timezone.utc)
    banners = (
        Banner.query.filter(Banner.is_active.is_(True))
        .filter((Banner.start_date.is_(None)) | (Banner.start_date <= now))
        .filter((Banner.end_date.is_(None)) | (Banner.end_date >= now))
        .order_by(Banner.display_order.asc(), Banner.created_at.desc())
        .all()
    )
    return success_response(data=[b.to_dict() for b in banners], message="Banners retrieved")
