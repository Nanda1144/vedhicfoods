-- Repair: enum values referenced by application code but never added by any
-- migration. Generated with `prisma migrate diff --from-url <deployed-db>
-- --to-schema-datamodel database/prisma/schema.prisma`.
--
-- Without this migration a database provisioned with `prisma migrate deploy`
-- (the documented production path) rejects every online checkout:
--   orders.status = 'PENDING_PAYMENT'          -> checkout.service.ts
--   orders.status = 'PAYMENT_FAILED'           -> checkout.service.ts
--   deliveries.status in ('PACKED','SHIPPED')  -> admin delivery transitions
--   deliveries.status = 'CANCELLED'            -> checkout/delivery cancellation
--
-- Enum values are isolated in their own migration so that no DDL runs in the
-- same transaction as the type change.

ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'PENDING_PAYMENT';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'PAYMENT_FAILED';

ALTER TYPE "DeliveryStatus" ADD VALUE IF NOT EXISTS 'PACKED';
ALTER TYPE "DeliveryStatus" ADD VALUE IF NOT EXISTS 'SHIPPED';
ALTER TYPE "DeliveryStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
