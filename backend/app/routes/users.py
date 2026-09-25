from flask import Blueprint, request
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.schemas.user import UserProfileUpdateSchema, ChangePasswordSchema
from app.services.auth_service import AuthService
from app.utils.response import success_response, error_response

users_bp = Blueprint("users", __name__, url_prefix="/api/users")

profile_update_schema = UserProfileUpdateSchema()
change_pwd_schema = ChangePasswordSchema()


@users_bp.get("/profile")
@jwt_required()
def get_profile():
    """Get current user details."""
    user_id = int(get_jwt_identity())
    user = AuthService.get_user_by_id(user_id)
    if not user:
        return error_response(message="User not found", status_code=404)
    return success_response(data=user.to_dict(), message="User profile retrieved")


@users_bp.put("/profile")
@jwt_required()
def update_profile():
    """Update current user profile information."""
    user_id = int(get_jwt_identity())
    user = AuthService.get_user_by_id(user_id)
    if not user:
        return error_response(message="User not found", status_code=404)

    data = profile_update_schema.load(request.get_json() or {})
    updated = AuthService.update_profile(user, data)
    return success_response(data=updated, message="Profile updated successfully")


@users_bp.put("/change-password")
@jwt_required()
def change_password():
    """Change current user password."""
    user_id = int(get_jwt_identity())
    user = AuthService.get_user_by_id(user_id)
    if not user:
        return error_response(message="User not found", status_code=404)

    data = change_pwd_schema.load(request.get_json() or {})
    try:
        AuthService.change_password(
            user=user,
            current_pwd=data["current_password"],
            new_pwd=data["new_password"],
        )
        return success_response(message="Password changed successfully")
    except ValueError as e:
        return error_response(message=str(e), status_code=400)
