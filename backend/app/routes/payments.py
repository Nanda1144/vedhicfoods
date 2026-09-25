from flask import Blueprint, request
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.models.payment import Payment
from app.schemas.payment import PaymentCreateOrderSchema, PaymentVerifySchema
from app.services.payment_service import PaymentService
from app.utils.response import success_response, error_response

payments_bp = Blueprint("payments", __name__, url_prefix="/api/payments")

create_order_schema = PaymentCreateOrderSchema()
verify_payment_schema = PaymentVerifySchema()


@payments_bp.post("/create-order")
@jwt_required()
def create_payment_order():
    """
    Initialize Razorpay payment order for an existing order
    ---
    tags:
      - Payments
    security:
      - bearerAuth: []
    requestBody:
      required: true
      content:
        application/json:
          schema:
            type: object
            required:
              - order_id
            properties:
              order_id:
                type: integer
    responses:
      200:
        description: Razorpay order details with order_id and amount
    """
    user_id = int(get_jwt_identity())
    data = create_order_schema.load(request.get_json() or {})
    try:
        payment_info = PaymentService.create_payment_order(
            order_id=data["order_id"],
            user_id=user_id,
        )
        return success_response(data=payment_info, message="Payment order initiated")
    except (ValueError, RuntimeError) as e:
        return error_response(message=str(e), status_code=400)


@payments_bp.post("/verify")
@jwt_required()
def verify_payment():
    """
    Verify Razorpay payment signature server-side.
    Idempotent: Duplicate calls for completed payments return success without duplicating records.
    ---
    tags:
      - Payments
    security:
      - bearerAuth: []
    requestBody:
      required: true
      content:
        application/json:
          schema:
            type: object
            required:
              - order_id
              - razorpay_order_id
              - razorpay_payment_id
              - razorpay_signature
    responses:
      200:
        description: Payment verified successfully and order confirmed
      400:
        description: Signature verification failed
    """
    data = verify_payment_schema.load(request.get_json() or {})
    try:
        is_valid, msg, payment_data = PaymentService.verify_payment(
            order_id=data["order_id"],
            razorpay_order_id=data["razorpay_order_id"],
            razorpay_payment_id=data["razorpay_payment_id"],
            razorpay_signature=data["razorpay_signature"],
        )
        if not is_valid:
            return error_response(message=msg, error=payment_data, status_code=400)

        return success_response(data=payment_data, message=msg)
    except ValueError as e:
        return error_response(message=str(e), status_code=400)


@payments_bp.get("/<int:payment_id>")
@jwt_required()
def get_payment(payment_id: int):
    """Get payment status details."""
    user_id = int(get_jwt_identity())
    payment = db.session.get(Payment, payment_id)
    if not payment:
        return error_response(message="Payment record not found", status_code=404)

    # Check that payment belongs to current user's order
    if payment.order and payment.order.user_id != user_id:
        return error_response(message="Access denied", status_code=403)

    return success_response(data=payment.to_dict(), message="Payment details retrieved")
