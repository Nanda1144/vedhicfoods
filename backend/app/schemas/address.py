from marshmallow import Schema, fields, validate, validates, ValidationError
from app.utils.validators import validate_phone_format


class AddressCreateSchema(Schema):
    full_name = fields.Str(required=True, validate=validate.Length(min=2, max=120))
    phone = fields.Str(required=True)
    address_line_1 = fields.Str(required=True, validate=validate.Length(min=3, max=255))
    address_line_2 = fields.Str(required=False, allow_none=True, validate=validate.Length(max=255))
    city = fields.Str(required=True, validate=validate.Length(min=2, max=100))
    state = fields.Str(required=True, validate=validate.Length(min=2, max=100))
    pincode = fields.Str(required=True, validate=validate.Length(min=4, max=20))
    latitude = fields.Float(required=False, allow_none=True)
    longitude = fields.Float(required=False, allow_none=True)
    is_default = fields.Bool(required=False, load_default=False)

    @validates("phone")
    def check_phone(self, value, **kwargs):
        if not validate_phone_format(value):
            raise ValidationError("Invalid phone number format.")


class AddressUpdateSchema(Schema):
    full_name = fields.Str(required=False, validate=validate.Length(min=2, max=120))
    phone = fields.Str(required=False)
    address_line_1 = fields.Str(required=False, validate=validate.Length(min=3, max=255))
    address_line_2 = fields.Str(required=False, allow_none=True, validate=validate.Length(max=255))
    city = fields.Str(required=False, validate=validate.Length(min=2, max=100))
    state = fields.Str(required=False, validate=validate.Length(min=2, max=100))
    pincode = fields.Str(required=False, validate=validate.Length(min=4, max=20))
    latitude = fields.Float(required=False, allow_none=True)
    longitude = fields.Float(required=False, allow_none=True)
    is_default = fields.Bool(required=False)

    @validates("phone")
    def check_phone(self, value, **kwargs):
        if value and not validate_phone_format(value):
            raise ValidationError("Invalid phone number format.")
