from marshmallow import Schema, fields, validate


class OrderCreateSchema(Schema):
    address_id = fields.Int(required=True)
    coupon_code = fields.Str(required=False, allow_none=True)
    notes = fields.Str(required=False, allow_none=True, validate=validate.Length(max=500))


class OrderStatusUpdateSchema(Schema):
    order_status = fields.Str(
        required=False,
        validate=validate.OneOf(["PENDING", "CONFIRMED", "PACKED", "SHIPPED", "DELIVERED", "CANCELLED"]),
    )
    payment_status = fields.Str(
        required=False,
        validate=validate.OneOf(["PENDING", "PAID", "FAILED", "REFUNDED"]),
    )
