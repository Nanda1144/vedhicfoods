import logging
from flask import Flask, current_app
from werkzeug.exceptions import HTTPException
from marshmallow.exceptions import ValidationError
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from app.utils.response import error_response

logger = logging.getLogger(__name__)


def register_error_handlers(app: Flask) -> None:
    """Register application-wide centralized error handlers."""

    @app.errorhandler(ValidationError)
    def handle_validation_error(err: ValidationError):
        return error_response(
            message="Validation error on input data",
            error=err.messages,
            status_code=422,
        )

    @app.errorhandler(IntegrityError)
    def handle_integrity_error(err: IntegrityError):
        logger.warning(f"Database IntegrityError: {str(err.orig) if hasattr(err, 'orig') else str(err)}")
        # Check for unique constraint violation
        err_msg = str(err).lower()
        if "unique" in err_msg or "duplicate" in err_msg:
            return error_response(
                message="A record with these unique details already exists",
                error={"detail": "Duplicate entity detected"},
                status_code=409,
            )
        return error_response(
            message="Database constraint violation",
            error={"detail": "Operation violates database constraints"},
            status_code=409,
        )

    @app.errorhandler(SQLAlchemyError)
    def handle_database_error(err: SQLAlchemyError):
        logger.error(f"Database error: {str(err)}", exc_info=True)
        return error_response(
            message="A database error occurred while processing the request",
            status_code=500,
        )

    @app.errorhandler(HTTPException)
    def handle_http_exception(err: HTTPException):
        code = err.code or 500
        description = err.description or "HTTP error occurred"
        return error_response(
            message=description,
            status_code=code,
        )

    @app.errorhandler(Exception)
    def handle_generic_exception(err: Exception):
        logger.error(f"Unhandled exception: {str(err)}", exc_info=True)
        # Never leak stack traces to client
        debug = current_app.config.get("DEBUG", False)
        error_details = {"detail": str(err)} if debug else {}
        return error_response(
            message="An unexpected internal server error occurred",
            error=error_details,
            status_code=500,
        )


def register_jwt_callbacks(jwt_manager) -> None:
    """Configure JWT error handlers for standard JSON response format."""

    @jwt_manager.expired_token_loader
    def expired_token_callback(jwt_header, jwt_payload):
        return error_response(
            message="Authentication token has expired. Please log in again.",
            error={"code": "TOKEN_EXPIRED"},
            status_code=401,
        )

    @jwt_manager.invalid_token_loader
    def invalid_token_callback(error_string):
        return error_response(
            message=f"Invalid authentication token: {error_string}",
            error={"code": "TOKEN_INVALID"},
            status_code=401,
        )

    @jwt_manager.unauthorized_loader
    def missing_token_callback(error_string):
        return error_response(
            message="Authorization token is missing. Please provide a valid Bearer token.",
            error={"code": "AUTHORIZATION_REQUIRED"},
            status_code=401,
        )
