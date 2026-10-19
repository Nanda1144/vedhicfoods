-- Reconcile residual PostgreSQL drift against the Prisma schema (the schema is
-- the source of truth consumed by the application). Every statement below is
-- idempotent so the migration is safe to re-run and safe on databases that
-- already received the equivalent fixes.

-- 1) products.tags is a required scalar list in Prisma (`String[] @default([])`).
--    Backfill legacy NULLs, then enforce the contract.
UPDATE "products" SET "tags" = ARRAY[]::TEXT[] WHERE "tags" IS NULL;
ALTER TABLE "products" ALTER COLUMN "tags" SET NOT NULL;

-- 2) inventory_logs.order -> Order relation is declared with `onDelete: SetNull`
--    and the explicit FK name `inventory_logs_order_id_fkey`. Create it only
--    when it is absent so the migration stays re-runnable.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'inventory_logs_order_id_fkey'
      AND conrelid = '"inventory_logs"'::regclass
  ) THEN
    ALTER TABLE "inventory_logs"
      ADD CONSTRAINT "inventory_logs_order_id_fkey"
      FOREIGN KEY ("orderId") REFERENCES "orders"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

-- 3) Address declares `@@unique([id, userId], map: "addresses_id_user_id_key")`,
--    which is the target of the composite ownership foreign keys.
CREATE UNIQUE INDEX IF NOT EXISTS "addresses_id_user_id_key"
  ON "addresses"("id", "userId");
