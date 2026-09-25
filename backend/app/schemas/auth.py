from marshmallow import Schema, fields, validate, validates, ValidationError
from app.utils.validators import validate_password_strength, validate_phone_format


class RegisterSchema(Schema):
    full_name = fields.Str(required=True, validate=validate.Length(min=2, max=120))
    email = fields.Email(required=True)
    phone = fields.Str(required=False, allow_none=True)
    password = fields.Str(required=True, validate=validate.Length(min=8, max=100))

    @validates("phone")
    def validate_phone(self, value, **kwargs):
        if value and not validate_phone_format(value):
            raise ValidationError("Invalid phone number format.")

    @validates("password")
    def validate_password(self, value, **kwargs):
        valid, msg = validate_password_strength(value)
        if not valid:
            raise ValidationError(msg)


class LoginSchema(Schema):
    email = fields.Email(required=True)
    password = fields.Str(required=True)
