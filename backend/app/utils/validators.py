import re
from typing import Tuple, Optional
from werkzeug.datastructures import FileStorage


EMAIL_REGEX = re.compile(r"^[\w\.-]+@([\w\.-]+\.)+[\w-]{2,8}$")
PHONE_REGEX = re.compile(r"^\+?[0-9]{10,15}$")


def validate_email_format(email: str) -> bool:
    """Check if email matches a standard valid email pattern."""
    if not email or not isinstance(email, str):
        return False
    return bool(EMAIL_REGEX.match(email.strip()))


def validate_phone_format(phone: Optional[str]) -> bool:
    """Validate phone number (Indian 10-digit or international E.164)."""
    if not phone:
        return True  # phone is optional in some contexts
    cleaned = re.sub(r"[\s\-\(\)]", "", phone)
    return bool(PHONE_REGEX.match(cleaned))


def validate_password_strength(password: str) -> Tuple[bool, str]:
    """
    Validate that password meets security requirements:
    - At least 8 characters
    - At least one letter and at least one digit
    """
    if not password or len(password) < 8:
        return False, "Password must be at least 8 characters long"
    if not re.search(r"[A-Za-z]", password):
        return False, "Password must contain at least one letter"
    if not re.search(r"\d", password):
        return False, "Password must contain at least one digit"
    return True, ""


ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}
ALLOWED_MIMETYPES = {"image/jpeg", "image/png", "image/webp"}


def validate_uploaded_image(file: FileStorage) -> Tuple[bool, str]:
    """Validate uploaded image file type, filename, and mime type."""
    if not file or not file.filename:
        return False, "No file selected or uploaded"

    filename = file.filename
    if "." not in filename:
        return False, "Invalid file format: missing extension"

    ext = filename.rsplit(".", 1)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        return False, f"Unsupported file extension .{ext}. Allowed: {', '.join(ALLOWED_EXTENSIONS)}"

    if file.mimetype and file.mimetype.lower() not in ALLOWED_MIMETYPES:
        return False, f"Unsupported content type {file.mimetype}. Allowed: {', '.join(ALLOWED_MIMETYPES)}"

    return True, ""
