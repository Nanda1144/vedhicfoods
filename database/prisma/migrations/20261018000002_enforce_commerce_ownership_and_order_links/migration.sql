-- Refuse the migration with a concise error if existing records violate the
-- relationships this migration is about to enforce. Repair the rows explicitly
-- before retrying; silently reassigning historical orders or invoices is unsafe.
BEGIN;
-- These two prefixes were used for ticket status/closure events, not message
-- identifiers. The corresponding event key is already persisted in dedupe_key.
UPDATE support_notifications
SET "messageId" = NULL
WHERE "messageId" LIKE 'close:%' OR "messageId" LIKE 'status:%';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM orders o
    JOIN addresses a ON a.id = o."addressId"
    WHERE a."userId" <> o."userId"
  ) THEN
    RAISE EXCEPTION 'Cannot add order address ownership constraint: one or more orders reference another customer''s address';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM invoices i
    JOIN orders o ON o.id = i."orderId"
    WHERE i."userId" <> o."userId"
  ) THEN
    RAISE EXCEPTION 'Cannot add invoice ownership constraint: one or more invoice owners differ from their order owners';
  END IF;

  IF EXISTS (
    SELECT 1 FROM coupon_usages cu
    LEFT JOIN orders o ON o.id = cu."orderId"
    WHERE o.id IS NULL OR cu."userId" <> o."userId"
  ) THEN
    RAISE EXCEPTION 'Cannot add coupon usage ownership constraint: orphan rows or cross-customer order references exist';
  END IF;

  IF EXISTS (
    SELECT 1 FROM inventory_logs il
    LEFT JOIN orders o ON o.id = il."orderId"
    WHERE il."orderId" IS NOT NULL AND o.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot add inventory log order foreign key: orphan order references exist';
  END IF;

  IF EXISTS (
    SELECT 1 FROM delivery_history dh
    LEFT JOIN users u ON u.id = dh."assignedToId"
    WHERE dh."assignedToId" IS NOT NULL AND u.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot add delivery assignment foreign key: orphan staff references exist';
  END IF;

  IF EXISTS (
    SELECT 1 FROM product_reviews pr
    LEFT JOIN users u ON u.id = pr."userId"
    WHERE pr."userId" IS NOT NULL AND u.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot add product review user foreign key: orphan user references exist';
  END IF;

  IF EXISTS (
    SELECT 1 FROM support_notifications sn
    LEFT JOIN support_messages sm ON sm.id = sn."messageId"
    WHERE sn."messageId" IS NOT NULL AND sm.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot add support notification message foreign key: orphan message references exist';
  END IF;
END $$;

CREATE UNIQUE INDEX "addresses_id_user_id_key" ON "addresses"("id", "userId");
CREATE UNIQUE INDEX "orders_id_user_id_key" ON "orders"("id", "userId");
CREATE UNIQUE INDEX "invoices_order_id_user_id_key" ON "invoices"("orderId", "userId");

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_address_owner_fkey"
  FOREIGN KEY ("addressId", "userId")
  REFERENCES "addresses"("id", "userId")
  ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_order_owner_fkey"
  FOREIGN KEY ("orderId", "userId")
  REFERENCES "orders"("id", "userId")
  ON DELETE NO ACTION ON UPDATE CASCADE;

CREATE INDEX "coupon_usages_order_id_idx" ON "coupon_usages"("orderId");
ALTER TABLE "coupon_usages"
  ADD CONSTRAINT "coupon_usages_order_id_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "coupon_usages"
  ADD CONSTRAINT "coupon_usages_order_owner_fkey"
  FOREIGN KEY ("orderId", "userId")
  REFERENCES "orders"("id", "userId")
  ON DELETE NO ACTION ON UPDATE CASCADE;

CREATE INDEX "inventory_logs_order_id_idx" ON "inventory_logs"("orderId");
ALTER TABLE "inventory_logs"
  ADD CONSTRAINT "inventory_logs_order_id_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "delivery_history_assigned_to_id_idx" ON "delivery_history"("assignedToId");
ALTER TABLE "delivery_history"
  ADD CONSTRAINT "delivery_history_assigned_to_id_fkey"
  FOREIGN KEY ("assignedToId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "product_reviews_user_id_idx" ON "product_reviews"("userId");
ALTER TABLE "product_reviews"
  ADD CONSTRAINT "product_reviews_user_id_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "support_notifications_message_id_idx" ON "support_notifications"("messageId");
ALTER TABLE "support_notifications"
  ADD CONSTRAINT "support_notifications_message_id_fkey"
  FOREIGN KEY ("messageId") REFERENCES "support_messages"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
