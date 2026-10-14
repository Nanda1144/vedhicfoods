-- Repair: schema objects that exist in schema.prisma and are written by
-- application code, but were never created by a migration. Generated with
-- `prisma migrate diff --from-url <deployed-db> --to-schema-datamodel
-- database/prisma/schema.prisma`.
--
-- Impact of the drift before this migration:
--   inventory_logs        -> every inventory mutation raised Prisma P2022
--   delivery_history      -> delivery status history writes failed
--   coupon_products/_cats -> coupon product/category filters failed
--   orders.idempotencyKey -> checkout idempotency replay lookup failed
--   promotions.min/max    -> promotion CRUD and validation failed

-- AlterTable
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;

-- AlterTable
ALTER TABLE "promotions" ADD COLUMN IF NOT EXISTS "maxDiscount" DECIMAL(10,2);
ALTER TABLE "promotions" ADD COLUMN IF NOT EXISTS "minOrderValue" DECIMAL(10,2) DEFAULT 0.00;

-- CreateTable
CREATE TABLE IF NOT EXISTS "inventory_logs" (
    "id" TEXT NOT NULL,
    "inventoryId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorEmail" TEXT,
    "operation" TEXT NOT NULL,
    "previousQuantity" INTEGER NOT NULL,
    "newQuantity" INTEGER NOT NULL,
    "quantityChange" INTEGER NOT NULL,
    "previousReserved" INTEGER NOT NULL DEFAULT 0,
    "newReserved" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT,
    "orderId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "coupon_products" (
    "id" TEXT NOT NULL,
    "couponId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,

    CONSTRAINT "coupon_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "coupon_categories" (
    "id" TEXT NOT NULL,
    "couponId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,

    CONSTRAINT "coupon_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "delivery_history" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL,
    "actorId" TEXT,
    "actorEmail" TEXT,
    "notes" TEXT,
    "assignedToId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "inventory_logs_inventoryId_idx" ON "inventory_logs"("inventoryId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "inventory_logs_productId_idx" ON "inventory_logs"("productId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "inventory_logs_actorId_idx" ON "inventory_logs"("actorId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "inventory_logs_operation_idx" ON "inventory_logs"("operation");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "inventory_logs_createdAt_idx" ON "inventory_logs"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "coupon_products_couponId_idx" ON "coupon_products"("couponId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "coupon_products_productId_idx" ON "coupon_products"("productId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "coupon_products_couponId_productId_key" ON "coupon_products"("couponId", "productId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "coupon_categories_couponId_idx" ON "coupon_categories"("couponId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "coupon_categories_categoryId_idx" ON "coupon_categories"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "coupon_categories_couponId_categoryId_key" ON "coupon_categories"("couponId", "categoryId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "delivery_history_deliveryId_idx" ON "delivery_history"("deliveryId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "delivery_history_status_idx" ON "delivery_history"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "delivery_history_createdAt_idx" ON "delivery_history"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "orders_idempotencyKey_key" ON "orders"("idempotencyKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "orders_idempotencyKey_idx" ON "orders"("idempotencyKey");

-- AddForeignKey
ALTER TABLE "inventory_logs" ADD CONSTRAINT "inventory_logs_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "inventories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_logs" ADD CONSTRAINT "inventory_logs_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_logs" ADD CONSTRAINT "inventory_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_products" ADD CONSTRAINT "coupon_products_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "coupons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_products" ADD CONSTRAINT "coupon_products_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_categories" ADD CONSTRAINT "coupon_categories_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "coupons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_categories" ADD CONSTRAINT "coupon_categories_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_history" ADD CONSTRAINT "delivery_history_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_history" ADD CONSTRAINT "delivery_history_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
