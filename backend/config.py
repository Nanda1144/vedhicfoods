import os
from datetime import timedelta
from dotenv import load_dotenv

# Load .env file
load_dotenv()


class Config:
    """Base configuration."""
    SECRET_KEY = os.getenv("SECRET_KEY", "vedhic-foods-dev-fallback-secret-key-32chars")
    JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "vedhic-foods-jwt-dev-fallback-secret-key-32")
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(minutes=int(os.getenv("JWT_ACCESS_TOKEN_EXPIRES_MINUTES", "1440")))
    JWT_TOKEN_LOCATION = ["headers"]
    JWT_HEADER_NAME = "Authorization"
    JWT_HEADER_TYPE = "Bearer"

    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_DATABASE_URI = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/vedhicfoods")

    # AWS S3 Settings
    AWS_REGION = os.getenv("AWS_REGION", "ap-south-1")
    AWS_S3_BUCKET = os.getenv("AWS_S3_BUCKET", "")
    AWS_ACCESS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID", "")
    AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY", "")

    # Razorpay Settings
    RAZORPAY_KEY_ID = os.getenv("RAZORPAY_KEY_ID", "")
    RAZORPAY_KEY_SECRET = os.getenv("RAZORPAY_KEY_SECRET", "")

    # Frontend Origin & CORS
    FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")
    CORS_ORIGINS = [
        os.getenv("FRONTEND_URL", "http://localhost:5173"),
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

    # File Uploads
    MAX_CONTENT_LENGTH = 5 * 1024 * 1024  # 5 MB max upload
    UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")
    ALLOWED_IMAGE_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}
    ALLOWED_IMAGE_MIMETYPES = {"image/jpeg", "image/png", "image/webp"}

    # Flasgger Swagger configuration
    SWAGGER = {
        "title": "Vedhic Foods API",
        "uiversion": 3,
        "openapi": "3.0.2",
        "description": "Production REST API for Vedhic Foods Marketplace",
        "version": "1.0.0",
        "termsOfService": "",
        "specs_route": "/api/docs/",
    }


class DevelopmentConfig(Config):
    """Development configuration."""
    DEBUG = True
    TESTING = False


class TestingConfig(Config):
    """Testing configuration."""
    DEBUG = False
    TESTING = True
    # Test database or fallback
    SQLALCHEMY_DATABASE_URI = os.getenv(
        "TEST_DATABASE_URL",
        os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/vedhicfoods_test")
    )
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(minutes=60)


class ProductionConfig(Config):
    """Production configuration."""
    DEBUG = False
    TESTING = False
    # In production, strict origin from FRONTEND_URL
    CORS_ORIGINS = [os.getenv("FRONTEND_URL")] if os.getenv("FRONTEND_URL") else []


config_by_name = {
    "development": DevelopmentConfig,
    "testing": TestingConfig,
    "production": ProductionConfig,
    "default": DevelopmentConfig,
}