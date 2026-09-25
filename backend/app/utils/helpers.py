import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict


def utc_now() -> datetime:
    """Return the current time in UTC with timezone awareness."""
    return datetime.now(timezone.utc)


def slugify(text: str) -> str:
    """Convert text to a clean URL-friendly slug."""
    text = text.strip().lower()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_-]+", "-", text)
    text = re.sub(r"^-+|-+$", "", text)
    return text or "item"


def generate_order_number() -> str:
    """Generate a unique human-readable order number."""
    now = datetime.now(timezone.utc)
    date_str = now.strftime("%Y%m%d")
    unique_suffix = uuid.uuid4().hex[:6].upper()
    return f"VED-{date_str}-{unique_suffix}"


def format_pagination(pagination_obj: Any, items_serialized: list) -> Dict[str, Any]:
    """Format SQLAlchemy pagination object into a structured dict."""
    return {
        "items": items_serialized,
        "pagination": {
            "page": pagination_obj.page,
            "per_page": pagination_obj.per_page,
            "total_items": pagination_obj.total,
            "total_pages": pagination_obj.pages,
            "has_next": pagination_obj.has_next,
            "has_prev": pagination_obj.has_prev,
        }
    }
