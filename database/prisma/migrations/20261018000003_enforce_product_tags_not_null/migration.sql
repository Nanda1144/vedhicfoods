-- Product tags participate in search and are represented as a required list
-- in Prisma. Normalize older nullable rows before enforcing that contract.
UPDATE "products" SET "tags" = ARRAY[]::TEXT[] WHERE "tags" IS NULL;
ALTER TABLE "products" ALTER COLUMN "tags" SET NOT NULL;
