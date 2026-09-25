from flask import Blueprint, request
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.services.notification_service import NotificationService
from app.utils.response import success_response, error_response

notifications_bp = Blueprint("notifications", __name__, url_prefix="/api/notifications")


@notifications_bp.get("")
@jwt_required()
def list_notifications():
    """List in-app notifications for the logged-in user."""
    user_id = int(get_jwt_identity())
    unread_only = request.args.get("unread_only", "false").lower() in ["true", "1"]
    items = NotificationService.get_user_notifications(user_id=user_id, unread_only=unread_only)
    return success_response(data=items, message="Notifications retrieved")


@notifications_bp.put("/<int:notification_id>/read")
@jwt_required()
def mark_read(notification_id: int):
    """Mark a specific notification as read."""
    user_id = int(get_jwt_identity())
    success = NotificationService.mark_as_read(notification_id=notification_id, user_id=user_id)
    if not success:
        return error_response(message="Notification not found or access denied", status_code=404)
    return success_response(message="Notification marked as read")


@notifications_bp.put("/read-all")
@jwt_required()
def mark_all_read():
    """Mark all notifications for the user as read."""
    user_id = int(get_jwt_identity())
    count = NotificationService.mark_all_as_read(user_id=user_id)
    return success_response(data={"marked_count": count}, message=f"Marked {count} notifications as read")
