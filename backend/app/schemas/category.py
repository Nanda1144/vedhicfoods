from marshmallow import Schema, fields, validate


class CategoryCreateSchema(Schema):
    name = fields.Str(required=True, validate=validate.Length(min=2, max=100))
    slug = fields.Str(required=False, validate=validate.Length(min=2, max=120))
    description = fields.Str(required=False, allow_none=True)
    image_url = fields.Str(required=False, allow_none=True)
    is_active = fields.Bool(required=False, load_default=True)


class CategoryUpdateSchema(Schema):
    name = fields.Str(required=False, validate=validate.Length(min=2, max=100))
    slug = fields.Str(required=False, validate=validate.Length(min=2, max=120))
    description = fields.Str(required=False, allow_none=True)
    image_url = fields.Str(required=False, allow_none=True)
    is_active = fields.Bool(required=False)
