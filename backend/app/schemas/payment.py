from marshmallow import Schema, fields, validate


class PaymentCreateOrderSchema(Schema):
    order_id = fields.Int(required=True)


class PaymentVerifySchema(Schema):
    order_id = fields.Int(required=True)
    razorpay_order_id = fields.Str(required=True)
    razorpay_payment_id = fields.Str(required=True)
    razorpay_signature = fields.Str(required=True)
