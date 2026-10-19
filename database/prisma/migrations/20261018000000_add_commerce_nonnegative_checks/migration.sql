-- Reject invalid monetary and stock values at PostgreSQL itself, including
-- writes that bypass API and frontend validation. Check existing rows first
-- so a legacy violation fails before any constraint is installed.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "products"
    WHERE "price" < 0 OR "mrp" < 0 OR "stock" < 0 OR "netWeight" < 0 OR "discount" < 0
  ) THEN
    RAISE EXCEPTION 'Cannot add commerce checks: products contain negative price, stock, weight, or discount values';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "inventories"
    WHERE "availableQuantity" < 0 OR "reservedQuantity" < 0 OR "soldQuantity" < 0 OR "reorderThreshold" < 0
  ) THEN
    RAISE EXCEPTION 'Cannot add commerce checks: inventories contain negative quantities';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "orders"
    WHERE "subtotal" < 0 OR "savings" < 0 OR "shipping" < 0 OR "tax" < 0 OR "discount" < 0 OR "total" < 0
  ) THEN
    RAISE EXCEPTION 'Cannot add commerce checks: orders contain negative monetary values';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "order_items"
    WHERE "price" < 0 OR "quantity" <= 0 OR "subtotal" < 0 OR "discount" < 0 OR "tax" < 0
       OR ("total" IS NOT NULL AND "total" < 0) OR ("unitPrice" IS NOT NULL AND "unitPrice" < 0)
  ) THEN
    RAISE EXCEPTION 'Cannot add commerce checks: order items contain invalid price, quantity, or total values';
  END IF;

  IF EXISTS (SELECT 1 FROM "payments" WHERE "amount" < 0) THEN
    RAISE EXCEPTION 'Cannot add commerce checks: payments contain negative amounts';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "invoices"
    WHERE "subtotal" < 0 OR "discount" < 0 OR "shipping" < 0 OR "tax" < 0 OR "total" < 0
  ) THEN
    RAISE EXCEPTION 'Cannot add commerce checks: invoices contain negative monetary values';
  END IF;
END $$;

ALTER TABLE "products"
  ADD CONSTRAINT "products_price_nonnegative_check" CHECK ("price" >= 0),
  ADD CONSTRAINT "products_mrp_nonnegative_check" CHECK ("mrp" >= 0),
  ADD CONSTRAINT "products_stock_nonnegative_check" CHECK ("stock" >= 0),
  ADD CONSTRAINT "products_netWeight_nonnegative_check" CHECK ("netWeight" >= 0),
  ADD CONSTRAINT "products_discount_nonnegative_check" CHECK ("discount" >= 0);

ALTER TABLE "inventories"
  ADD CONSTRAINT "inventories_availableQuantity_nonnegative_check" CHECK ("availableQuantity" >= 0),
  ADD CONSTRAINT "inventories_reservedQuantity_nonnegative_check" CHECK ("reservedQuantity" >= 0),
  ADD CONSTRAINT "inventories_soldQuantity_nonnegative_check" CHECK ("soldQuantity" >= 0),
  ADD CONSTRAINT "inventories_reorderThreshold_nonnegative_check" CHECK ("reorderThreshold" >= 0);

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_subtotal_nonnegative_check" CHECK ("subtotal" >= 0),
  ADD CONSTRAINT "orders_savings_nonnegative_check" CHECK ("savings" >= 0),
  ADD CONSTRAINT "orders_shipping_nonnegative_check" CHECK ("shipping" >= 0),
  ADD CONSTRAINT "orders_tax_nonnegative_check" CHECK ("tax" >= 0),
  ADD CONSTRAINT "orders_discount_nonnegative_check" CHECK ("discount" >= 0),
  ADD CONSTRAINT "orders_total_nonnegative_check" CHECK ("total" >= 0);

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_price_nonnegative_check" CHECK ("price" >= 0),
  ADD CONSTRAINT "order_items_quantity_positive_check" CHECK ("quantity" > 0),
  ADD CONSTRAINT "order_items_subtotal_nonnegative_check" CHECK ("subtotal" >= 0),
  ADD CONSTRAINT "order_items_discount_nonnegative_check" CHECK ("discount" >= 0),
  ADD CONSTRAINT "order_items_tax_nonnegative_check" CHECK ("tax" >= 0),
  ADD CONSTRAINT "order_items_total_nonnegative_check" CHECK ("total" IS NULL OR "total" >= 0),
  ADD CONSTRAINT "order_items_unitPrice_nonnegative_check" CHECK ("unitPrice" IS NULL OR "unitPrice" >= 0);

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_nonnegative_check" CHECK ("amount" >= 0);

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_subtotal_nonnegative_check" CHECK ("subtotal" >= 0),
  ADD CONSTRAINT "invoices_discount_nonnegative_check" CHECK ("discount" >= 0),
  ADD CONSTRAINT "invoices_shipping_nonnegative_check" CHECK ("shipping" >= 0),
  ADD CONSTRAINT "invoices_tax_nonnegative_check" CHECK ("tax" >= 0),
  ADD CONSTRAINT "invoices_total_nonnegative_check" CHECK ("total" >= 0);
