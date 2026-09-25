from typing import Any, Optional, Dict
from flask import jsonify, Response


def success_response(
    data: Any = None,
    message: str = "Operation successful",
    status_code: int = 200,
) -> tuple[Response, int]:
    """Format and return a standard successful JSON API response."""
    payload: Dict[str, Any] = {
        "success": True,
        "message": message,
        "data": data if data is not None else {},
    }
    return jsonify(payload), status_code


def error_response(
    message: str = "Something went wrong",
    error: Any = None,
    status_code: int = 400,
) -> tuple[Response, int]:
    """Format and return a standard error JSON API response."""
    payload: Dict[str, Any] = {
        "success": False,
        "message": message,
        "error": error if error is not None else {},
    }
    return jsonify(payload), status_code
