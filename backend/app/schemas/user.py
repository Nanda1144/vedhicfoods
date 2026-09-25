from marshmallow import Schema, fields, validate, validates, ValidationError
from app.utils.validators import validate_password_strength, validate_phone_format


class UserProfileUpdateSchema(Schema):
    full_name = fields.Str(required=False, validate=validate.Length(min=2, max=120))
    phone = fields.Str(required=False, allow_none=True)

    @validates("phone")
    def validate_phone(self, value, **kwargs):
        if value and not validate_phone_format(value):
            raise ValidationError("Invalid phone number format.")


class ChangePasswordSchema(Schema):
    current_password = fields.Str(required=True)
    new_password = fields.Str(required=True, validate=validate.Length(min=8, max=100))

    @validates("new_password")
    def validate_new_pwd(self, value, **kwargs):
        valid, msg = validate_password_strength(value)
        if not valid:
            raise ValidationError(msg)
