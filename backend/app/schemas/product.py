from marshmallow import Schema, fields, validate


class ProductCreateSchema(Schema):
    category_id = fields.Int(required=True)
    name = fields.Str(required=True, validate=validate.Length(min=2, max=200))
    slug = fields.Str(required=False, validate=validate.Length(min=2, max=220))
    description = fields.Str(required=False, allow_none=True)
    price = fields.Float(required=True, validate=validate.Range(min=0.01))
    discount_percentage = fields.Float(required=False, load_default=0.0, validate=validate.Range(min=0.0, max=100.0))
    stock_quantity = fields.Int(required=False, load_default=0, validate=validate.Range(min=0))
    unit = fields.Str(required=False, load_default="piece", validate=validate.Length(max=50))
    sku = fields.Str(required=False, validate=validate.Length(min=2, max=100))
    is_active = fields.Bool(required=False, load_default=True)
    is_featured = fields.Bool(required=False, load_default=False)
    images = fields.List(fields.Str(), required=False)


class ProductUpdateSchema(Schema):
    category_id = fields.Int(required=False)
    name = fields.Str(required=False, validate=validate.Length(min=2, max=200))
    slug = fields.Str(required=False, validate=validate.Length(min=2, max=220))
    description = fields.Str(required=False, allow_none=True)
    price = fields.Float(required=False, validate=validate.Range(min=0.01))
    discount_percentage = fields.Float(required=False, validate=validate.Range(min=0.0, max=100.0))
    stock_quantity = fields.Int(required=False, validate=validate.Range(min=0))
    unit = fields.Str(required=False, validate=validate.Length(max=50))
    sku = fields.Str(required=False, validate=validate.Length(min=2, max=100))
    is_active = fields.Bool(required=False)
    is_featured = fields.Bool(required=False)


class ProductQuerySchema(Schema):
    page = fields.Int(required=False, load_default=1, validate=validate.Range(min=1))
    per_page = fields.Int(required=False, load_default=20, validate=validate.Range(min=1, max=100))
    category_id = fields.Int(required=False)
    category_slug = fields.Str(required=False)
    search = fields.Str(required=False)
    min_price = fields.Float(required=False, validate=validate.Range(min=0))
    max_price = fields.Float(required=False, validate=validate.Range(min=0))
    is_featured = fields.Bool(required=False)
    is_active = fields.Bool(required=False)
    sort = fields.Str(
        required=False,
        load_default="featured",
        validate=validate.OneOf(["featured", "newest", "price_asc", "price_desc", "name_asc", "bestsellers"]),
    )
