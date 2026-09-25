from typing import Optional, Dict, Any, List
from app.extensions import db
from app.models.order import Order
from app.models.order_item import OrderItem
from app.models.cart import Cart
from app.models.cart_item import CartItem
from app.models.product import Product
from app.models.address import Address
from app.models.coupon_usage import CouponUsage
from app.utils.helpers import generate_order_number
from app.services.coupon_service import CouponService


class OrderService:
    """Service layer for atomic order creation, inventory deduction, order cancellation, and status updates."""

    @classmethod
    def create_order_from_cart(
        cls,
        user_id: int,
        address_id: int,
        coupon_code: Optional[str] = None,
        notes: Optional[str] = None,
    ) -> Order:
        """
        Create order from the user's active cart in a single atomic transaction:
        1. Verify address belongs to user.
        2. Verify cart is not empty.
        3. Row-lock product records with with_for_update() to prevent race conditions.
        4. Validate stock availability and calculate subtotal.
        5. Atomically decrement stock_quantity.
        6. Apply server-side validated coupon discount.
        7. Compute taxes and delivery fees.
        8. Store Order and OrderItem snapshots.
        9. Record CouponUsage and increment coupon.used_count if applicable.
        10. Clear user's cart and commit.
        """
        # Step 1: Validate address
        address = Address.query.filter_by(id=address_id, user_id=user_id).first()
        if not address:
            raise ValueError("Shipping address not found or does not belong to you")

        # Step 2: Fetch cart
        cart = Cart.query.filter_by(user_id=user_id).first()
        if not cart or not cart.items:
            raise ValueError("Your cart is empty. Please add items before placing an order.")

        cart_items: List[CartItem] = list(cart.items)

        # Step 3 & 4: Lock product records and validate stock
        product_ids = [item.product_id for item in cart_items]
        # Query with row-level locks
        locked_products = (
            Product.query.filter(Product.id.in_(product_ids))
            .with_for_update()
            .all()
        )
        product_map = {p.id: p for p in locked_products}

        order_line_items = []
        subtotal = 0.0

        for item in cart_items:
            product = product_map.get(item.product_id)
            if not product:
                raise ValueError(f"Product ID {item.product_id} no longer exists")

            if not product.is_active:
                raise ValueError(f"Product '{product.name}' is no longer available")

            if product.stock_quantity < item.quantity:
                raise ValueError(
                    f"Insufficient stock for '{product.name}'. Available: {product.stock_quantity}, in cart: {item.quantity}"
                )

            # Atomically decrement stock
            product.stock_quantity -= item.quantity

            unit_price = float(product.final_price)
            item_subtotal = round(unit_price * item.quantity, 2)
            subtotal += item_subtotal

            order_line_items.append({
                "product_id": product.id,
                "product_name_snapshot": product.name,
                "unit_price": unit_price,
                "quantity": item.quantity,
                "subtotal": item_subtotal,
            })

        subtotal = round(subtotal, 2)

        # Step 6: Validate and apply coupon
        discount_amount = 0.0
        applied_coupon = None

        if coupon_code:
            is_valid, discount, err_msg, coupon_obj = CouponService.validate_coupon(
                code=coupon_code,
                user_id=user_id,
                order_amount=subtotal,
            )
            if not is_valid:
                raise ValueError(f"Coupon error: {err_msg}")
            discount_amount = discount
            applied_coupon = coupon_obj

        # Delivery fee & tax calculation
        delivery_fee = 0.0 if subtotal >= 499.0 else 49.0
        tax_amount = round((subtotal - discount_amount) * 0.05, 2) if (subtotal - discount_amount) > 0 else 0.0
        total_amount = round(max(0.0, (subtotal - discount_amount) + delivery_fee + tax_amount), 2)

        # Create Order record
        order = Order(
            order_number=generate_order_number(),
            user_id=user_id,
            address_id=address.id,
            coupon_id=applied_coupon.id if applied_coupon else None,
            subtotal=subtotal,
            discount_amount=discount_amount,
            delivery_fee=delivery_fee,
            tax_amount=tax_amount,
            total_amount=total_amount,
            payment_status="PENDING",
            order_status="PENDING",
            notes=notes,
        )
        db.session.add(order)
        db.session.flush()

        # Create OrderItem snapshots
        for line_item in order_line_items:
            order_item = OrderItem(
                order_id=order.id,
                product_id=line_item["product_id"],
                product_name_snapshot=line_item["product_name_snapshot"],
                unit_price=line_item["unit_price"],
                quantity=line_item["quantity"],
                subtotal=line_item["subtotal"],
            )
            db.session.add(order_item)

        # Record CouponUsage
        if applied_coupon:
            usage = CouponUsage(
                coupon_id=applied_coupon.id,
                user_id=user_id,
                order_id=order.id,
            )
            db.session.add(usage)
            applied_coupon.used_count += 1

        # Step 10: Clear cart items
        CartItem.query.filter_by(cart_id=cart.id).delete()

        db.session.commit()
        return order

    @staticmethod
    def cancel_order(order_id: int, user_id: int, is_admin: bool = False) -> Order:
        """
        Cancel order safely within a database transaction:
        - Verify user ownership (unless admin)
        - Can only cancel PENDING or CONFIRMED orders
        - Restores stock_quantity for every order item
        - Restores coupon usage if applicable
        """
        query = Order.query.filter_by(id=order_id)
        if not is_admin:
            query = query.filter_by(user_id=user_id)

        order = query.first()
        if not order:
            raise ValueError("Order not found or you do not have permission to cancel it")

        if order.order_status in ["CANCELLED"]:
            raise ValueError("This order is already cancelled")

        if order.order_status in ["SHIPPED", "DELIVERED"]:
            raise ValueError(f"Cannot cancel order with status '{order.order_status}'. Contact customer care.")

        # Restore inventory
        for item in order.items:
            product = db.session.get(Product, item.product_id)
            if product:
                product.stock_quantity += item.quantity

        # Restore coupon usage count
        if order.coupon:
            if order.coupon.used_count > 0:
                order.coupon.used_count -= 1
            CouponUsage.query.filter_by(order_id=order.id).delete()

        order.order_status = "CANCELLED"
        if order.payment_status == "PAID":
            order.payment_status = "REFUNDED"

        db.session.commit()
        return order

    @staticmethod
    def update_order_status(
        order: Order,
        new_order_status: Optional[str] = None,
        new_payment_status: Optional[str] = None,
    ) -> Order:
        """Admin update of order status and payment status."""
        if new_order_status:
            order.order_status = new_order_status
        if new_payment_status:
            order.payment_status = new_payment_status
        db.session.commit()
        return order
