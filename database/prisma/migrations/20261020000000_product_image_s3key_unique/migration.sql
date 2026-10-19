-- A single S3 object may back at most one gallery row per product.
--
-- A presigned PUT mints a unique key per upload, but the same key can still be
-- attached more than once. The application-level pre-check in `addImage` reads
-- the existing images *before* the insert, so two concurrent attaches of the
-- same key both pass it and both insert. Two rows then point at one S3 object;
-- deleting either removes the shared object and leaves the survivor with a
-- dangling URL. A database constraint is the only way to close this race.
--
-- `s3Key` is nullable and PostgreSQL treats each NULL as distinct in a unique
-- index, so direct-URL gallery rows without a backing object are unaffected and
-- may repeat. This matches the intended one-row-per-object semantics.
--
-- Dedupe any pre-existing duplicates before enforcing the constraint: keep the
-- earliest row per ("productId", "s3Key") and delete the later ones. The
-- self-join keeps exactly one row for every duplicate group (each later row
-- pairs with an earlier one), and is a no-op when there are no duplicates.
DELETE FROM "product_images" a
USING "product_images" b
WHERE a."productId" = b."productId"
  AND a."s3Key" IS NOT NULL
  AND a."s3Key" = b."s3Key"
  AND (a."createdAt" > b."createdAt"
       OR (a."createdAt" = b."createdAt" AND a."id" > b."id"));

-- Named to match Prisma's generated constraint name for
-- `@@unique([productId, s3Key], map: "product_images_productId_s3Key_key")`.
CREATE UNIQUE INDEX "product_images_productId_s3Key_key"
  ON "product_images" ("productId", "s3Key");
