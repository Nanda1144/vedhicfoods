from marshmallow import Schema, fields, validate, validates, ValidationError


class CouponCreateSchema(Schema):
    code = fields.Str(required=True, validate=validate.Length(min=2, max=50))
    description = fields.Str(required=False, allow_none=True)
    discount_type = fields.Str(required=True, validate=validate.OneOf(["PERCENTAGE", "FIXED"]))
    discount_value = fields.Float(required=True, validate=validate.Range(min=0.01))
    minimum_order_amount = fields.Float(required=False, load_default=0.0, validate=validate.Range(min=0))
    maximum_discount = fields.Float(required=False, allow_none=True, validate=validate.Range(min=0))
    usage_limit = fields.Int(required=False, allow_none=True, validate=validate.Range(min=1))
    per_user_limit = fields.Int(required=False, load_default=1, validate=validate.Range(min=1))
    start_date = fields.DateTime(required=False, allow_none=True)
    end_date = fields.DateTime(required=False, allow_none=True)
    is_active = fields.Bool(required=False, load_default=True)

    @validates("discount_type")
    def validate_discount_value(self, value, **kwargs):
        # Additional checks can be applied if discount_type is PERCENTAGE
        pass


class CouponUpdateSchema(Schema):
    description = fields.Str(required=False, allow_none=True)
    discount_type = fields.Str(required=False, validate=validate.OneOf(["PERCENTAGE", "FIXED"]))
    discount_value = fields.Float(required=False, validate=validate.Range(min=0.01))
    minimum_order_amount = fields.Float(required=False, validate=validate.Range(min=0))
    maximum_discount = fields.Float(required=False, allow_none=True, validate=validate.Range(min=0))
    usage_limit = fields.Int(required=False, allow_none=True, validate=validate.Range(min=1))
    per_user_limit = fields.Int(required=False, validate=validate.Range(min=1))
    start_date = fields.DateTime(required=False, allow_none=True)
    end_date = fields.DateTime(required=False, allow_none=True)
    is_active = fields.Bool(required=False)


class CouponValidateSchema(Schema):
    code = fields.Str(required=True)
    order_amount = fields.Float(required=False, validate=validate.Range(min=0))
