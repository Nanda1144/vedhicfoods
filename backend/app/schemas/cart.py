from marshmallow import Schema, fields, validate


class CartItemAddSchema(Schema):
    product_id = fields.Int(required=True)
    quantity = fields.Int(required=False, load_default=1, validate=validate.Range(min=1))


class CartItemUpdateSchema(Schema):
    quantity = fields.Int(required=True, validate=validate.Range(min=1))
