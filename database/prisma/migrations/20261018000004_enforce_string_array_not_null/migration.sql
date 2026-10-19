-- Prisma scalar list fields are required; enforce that contract in PostgreSQL
-- for rows created before the API consistently wrote empty arrays.
UPDATE "products" SET "ingredients" = ARRAY[]::TEXT[] WHERE "ingredients" IS NULL;
UPDATE "products" SET "allergens" = ARRAY[]::TEXT[] WHERE "allergens" IS NULL;
UPDATE "products" SET "metaKeywords" = ARRAY[]::TEXT[] WHERE "metaKeywords" IS NULL;
UPDATE "contact_submissions" SET "spamReasons" = ARRAY[]::TEXT[] WHERE "spamReasons" IS NULL;
UPDATE "payment_settings" SET "enabledMethods" = ARRAY[]::TEXT[] WHERE "enabledMethods" IS NULL;

ALTER TABLE "products" ALTER COLUMN "ingredients" SET NOT NULL;
ALTER TABLE "products" ALTER COLUMN "allergens" SET NOT NULL;
ALTER TABLE "products" ALTER COLUMN "metaKeywords" SET NOT NULL;
ALTER TABLE "contact_submissions" ALTER COLUMN "spamReasons" SET NOT NULL;
ALTER TABLE "payment_settings" ALTER COLUMN "enabledMethods" SET NOT NULL;
