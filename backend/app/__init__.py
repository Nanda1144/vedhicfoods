import os
from flask import Flask, send_from_directory
from config import config_by_name, DevelopmentConfig
from app.extensions import db, migrate, jwt, bcrypt, cors, swagger
from app.routes import register_routes
from app.middleware import register_error_handlers, register_jwt_callbacks
# Import all models so Flask-Migrate and SQLAlchemy know about them
import app.models  # noqa: F401


def create_app(config_class=None) -> Flask:
    """
    Flask Application Factory.
    Initializes configuration, database extensions, JWT, CORS, Swagger, routes, and security headers.
    """
    app = Flask(__name__)

    # Select configuration
    if config_class is None:
        env_name = os.getenv("FLASK_ENV", "development").lower()
        config_class = config_by_name.get(env_name, DevelopmentConfig)

    app.config.from_object(config_class)

    # Initialize extensions
    db.init_app(app)
    migrate.init_app(app, db)
    jwt.init_app(app)
    bcrypt.init_app(app)

    # CORS configuration
    cors_origins = app.config.get("CORS_ORIGINS", ["*"])
    cors.init_app(
        app,
        origins=cors_origins,
        supports_credentials=True,
        allow_headers=["Content-Type", "Authorization", "X-Requested-With"],
        methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    )

    # Flasgger Swagger configuration
    swagger.template = {
        "openapi": "3.0.2",
        "info": {
            "title": "Vedhic Foods API",
            "description": "Production REST API for Vedhic Foods - Indian food and agriculture e-commerce marketplace.",
            "version": "1.0.0",
        },
        "components": {
            "securitySchemes": {
                "bearerAuth": {
                    "type": "http",
                    "scheme": "bearer",
                    "bearerFormat": "JWT",
                }
            }
        },
    }
    swagger.init_app(app)

    # Register error handlers and JWT callbacks
    register_error_handlers(app)
    register_jwt_callbacks(jwt)

    # Register all API blueprints
    register_routes(app)

    # Root endpoint
    @app.get("/")
    def index():
        return {
            "success": True,
            "message": "Vedhic Foods API is running"
        }, 200

    # Health check endpoint
    @app.get("/api/health")
    def health_check():
        return {
            "success": True,
            "service": "Vedhic Foods Backend",
            "status": "healthy"
        }, 200

    # Local uploads static file route for development/fallback
    @app.get("/uploads/<path:filename>")
    def uploaded_file(filename):
        upload_folder = app.config.get("UPLOAD_FOLDER", os.path.join(os.getcwd(), "uploads"))
        return send_from_directory(upload_folder, filename)

    # Security headers
    @app.after_request
    def set_security_headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "SAMEORIGIN"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        return response

    return app