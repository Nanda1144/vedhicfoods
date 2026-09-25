from typing import Dict, Any, Tuple
from flask_jwt_extended import create_access_token
from app.extensions import db, bcrypt
from app.models.user import User
from app.models.cart import Cart


class AuthService:
    """Service layer for User authentication, registration, and credential verification."""

    @staticmethod
    def register_user(data: Dict[str, Any]) -> Tuple[Dict[str, Any], str]:
        """
        Register a new user:
        - Normalize email
        - Check duplicate
        - Hash password with Bcrypt
        - Create User and initialize empty Cart
        - Generate JWT access token
        """
        email = data["email"].strip().lower()

        # Check existing user
        existing_user = User.query.filter_by(email=email).first()
        if existing_user:
            raise ValueError("An account with this email address already exists")

        # Bcrypt password hash
        raw_password = data["password"]
        password_hash = bcrypt.generate_password_hash(raw_password).decode("utf-8")

        # Create user
        role = data.get("role", "USER").upper()
        if role not in ["USER", "ADMIN"]:
            role = "USER"

        user = User(
            full_name=data["full_name"].strip(),
            email=email,
            phone=data.get("phone", "").strip() if data.get("phone") else None,
            password_hash=password_hash,
            role=role,
            is_active=True,
            is_verified=False,
        )
        db.session.add(user)
        db.session.flush()  # generates user.id

        # Automatically create cart for the new user
        cart = Cart(user_id=user.id)
        db.session.add(cart)

        db.session.commit()

        # Create JWT access token
        access_token = create_access_token(
            identity=str(user.id),
            additional_claims={"role": user.role, "email": user.email},
        )
        return user.to_dict(), access_token

    @staticmethod
    def login_user(email: str, password: str) -> Tuple[Dict[str, Any], str]:
        """
        Authenticate user credentials:
        - Check user exists and active
        - Verify Bcrypt hash
        - Generate JWT access token
        """
        normalized_email = email.strip().lower()
        user = User.query.filter_by(email=normalized_email).first()

        if not user or not bcrypt.check_password_hash(user.password_hash, password):
            raise ValueError("Invalid email or password")

        if not user.is_active:
            raise PermissionError("Account is inactive. Please contact support.")

        access_token = create_access_token(
            identity=str(user.id),
            additional_claims={"role": user.role, "email": user.email},
        )
        return user.to_dict(), access_token

    @staticmethod
    def get_user_by_id(user_id: int) -> User | None:
        """Fetch user by primary key."""
        return db.session.get(User, user_id)

    @staticmethod
    def update_profile(user: User, data: Dict[str, Any]) -> Dict[str, Any]:
        """Update user profile information."""
        if "full_name" in data and data["full_name"]:
            user.full_name = data["full_name"].strip()
        if "phone" in data:
            user.phone = data["phone"].strip() if data["phone"] else None
        db.session.commit()
        return user.to_dict()

    @staticmethod
    def change_password(user: User, current_pwd: str, new_pwd: str) -> bool:
        """Verify current password and set new hashed password."""
        if not bcrypt.check_password_hash(user.password_hash, current_pwd):
            raise ValueError("Current password is incorrect")
        user.password_hash = bcrypt.generate_password_hash(new_pwd).decode("utf-8")
        db.session.commit()
        return True
