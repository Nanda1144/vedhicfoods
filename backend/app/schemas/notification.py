from marshmallow import Schema, fields, validate


class NotificationCreateSchema(Schema):
    user_id = fields.Int(required=True)
    title = fields.Str(required=True, validate=validate.Length(min=1, max=200))
    message = fields.Str(required=True)
    type = fields.Str(required=False, load_default="INFO")
