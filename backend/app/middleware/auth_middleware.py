from functools import wraps
from flask import g
from flask_jwt_extended import verify_jwt_in_request, get_jwt_identity
from app.utils.response import error_response


def admin_required():
    """
    Decorator to protect routes requiring ADMIN role.
    Ensures valid JWT is present and user role is 'ADMIN'.
    Never trusts role from frontend client payload.
    """
    def wrapper(fn):
        @wraps(fn)
        def decorator(*args, **kwargs):
            verify_jwt_in_request()
            user_id = get_jwt_identity()

            from app.extensions import db
            from app.models.user import User

            user = db.session.get(User, int(user_id))
            if not user:
                return error_response(
                    message="User account not found or deactivated",
                    status_code=401,
                )

            if not user.is_active:
                return error_response(
                    message="Account is deactivated. Contact support.",
                    status_code=403,
                )

            if user.role != "ADMIN":
                return error_response(
                    message="Admin privileges required for this action",
                    status_code=403,
                )

            g.current_user = user
            return fn(*args, **kwargs)
        return decorator
    return wrapper


def get_current_authenticated_user():
    """Helper to retrieve the User model instance of the currently authenticated JWT user."""
    verify_jwt_in_request()
    user_id = get_jwt_identity()
    from app.extensions import db
    from app.models.user import User
    return db.session.get(User, int(user_id))
