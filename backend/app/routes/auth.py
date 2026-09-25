from flask import Blueprint, request
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.schemas.auth import RegisterSchema, LoginSchema
from app.services.auth_service import AuthService
from app.utils.response import success_response, error_response

auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")

register_schema = RegisterSchema()
login_schema = LoginSchema()


@auth_bp.post("/register")
def register():
    """
    Register a new user account
    ---
    tags:
      - Authentication
    requestBody:
      required: true
      content:
        application/json:
          schema:
            type: object
            required:
              - full_name
              - email
              - password
            properties:
              full_name:
                type: string
                example: "Rahul Sharma"
              email:
                type: string
                example: "rahul@example.com"
              phone:
                type: string
                example: "+919876543210"
              password:
                type: string
                example: "SecureP@ss123"
    responses:
      201:
        description: User successfully registered
      409:
        description: Email already in use
      422:
        description: Validation error
    """
    data = register_schema.load(request.get_json() or {})
    try:
        user_dict, access_token = AuthService.register_user(data)
        return success_response(
            data={"user": user_dict, "access_token": access_token},
            message="User registered successfully",
            status_code=201,
        )
    except ValueError as e:
        return error_response(message=str(e), status_code=409)


@auth_bp.post("/login")
def login():
    """
    Log in and obtain a JWT access token
    ---
    tags:
      - Authentication
    requestBody:
      required: true
      content:
        application/json:
          schema:
            type: object
            required:
              - email
              - password
            properties:
              email:
                type: string
                example: "rahul@example.com"
              password:
                type: string
                example: "SecureP@ss123"
    responses:
      200:
        description: Login successful
      401:
        description: Invalid credentials
    """
    data = login_schema.load(request.get_json() or {})
    try:
        user_dict, access_token = AuthService.login_user(
            email=data["email"],
            password=data["password"],
        )
        return success_response(
            data={"user": user_dict, "access_token": access_token},
            message="Login successful",
            status_code=200,
        )
    except ValueError as e:
        return error_response(message=str(e), status_code=401)
    except PermissionError as e:
        return error_response(message=str(e), status_code=403)


@auth_bp.get("/me")
@jwt_required()
def me():
    """
    Get current authenticated user profile
    ---
    tags:
      - Authentication
    security:
      - bearerAuth: []
    responses:
      200:
        description: Current user information
      401:
        description: Unauthorized or token expired
    """
    user_id = int(get_jwt_identity())
    user = AuthService.get_user_by_id(user_id)
    if not user:
        return error_response(message="User not found", status_code=404)
    return success_response(data={"user": user.to_dict()}, message="Profile retrieved")


@auth_bp.post("/logout")
@jwt_required()
def logout():
    """
    Log out user (JWT client-side token discard)
    ---
    tags:
      - Authentication
    security:
      - bearerAuth: []
    responses:
      200:
        description: Logout successful
    """
    return success_response(message="Logged out successfully. Please clear your local token.")
