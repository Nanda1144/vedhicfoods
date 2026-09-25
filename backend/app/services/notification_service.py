from typing import List, Dict, Any
from app.extensions import db
from app.models.notification import Notification


class NotificationService:
    """Service layer for in-app user notifications."""

    @staticmethod
    def send_notification(
        user_id: int,
        title: str,
        message: str,
        notification_type: str = "INFO",
    ) -> Notification:
        """Create and persist a new notification for a specific user."""
        notification = Notification(
            user_id=user_id,
            title=title.strip(),
            message=message.strip(),
            type=notification_type.upper(),
            is_read=False,
        )
        db.session.add(notification)
        db.session.commit()
        return notification

    @staticmethod
    def mark_as_read(notification_id: int, user_id: int) -> bool:
        """Mark a single notification as read if it belongs to the user."""
        notification = Notification.query.filter_by(id=notification_id, user_id=user_id).first()
        if not notification:
            return False
        notification.is_read = True
        db.session.commit()
        return True

    @staticmethod
    def mark_all_as_read(user_id: int) -> int:
        """Mark all unread notifications for a user as read."""
        count = Notification.query.filter_by(user_id=user_id, is_read=False).update({"is_read": True})
        db.session.commit()
        return count

    @staticmethod
    def get_user_notifications(user_id: int, unread_only: bool = False) -> List[Dict[str, Any]]:
        """Retrieve notifications for a user."""
        query = Notification.query.filter_by(user_id=user_id)
        if unread_only:
            query = query.filter_by(is_read=False)
        notifications = query.order_by(Notification.created_at.desc()).all()
        return [n.to_dict() for n in notifications]
