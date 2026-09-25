from marshmallow import Schema, fields, validate


class BannerCreateSchema(Schema):
    title = fields.Str(required=True, validate=validate.Length(min=2, max=150))
    description = fields.Str(required=False, allow_none=True)
    image_url = fields.Str(required=False, allow_none=True)
    link_url = fields.Str(required=False, allow_none=True)
    display_order = fields.Int(required=False, load_default=0)
    is_active = fields.Bool(required=False, load_default=True)
    start_date = fields.DateTime(required=False, allow_none=True)
    end_date = fields.DateTime(required=False, allow_none=True)


class BannerUpdateSchema(Schema):
    title = fields.Str(required=False, validate=validate.Length(min=2, max=150))
    description = fields.Str(required=False, allow_none=True)
    image_url = fields.Str(required=False, allow_none=True)
    link_url = fields.Str(required=False, allow_none=True)
    display_order = fields.Int(required=False)
    is_active = fields.Bool(required=False)
    start_date = fields.DateTime(required=False, allow_none=True)
    end_date = fields.DateTime(required=False, allow_none=True)
