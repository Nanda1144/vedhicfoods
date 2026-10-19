-- A product gallery may contain many images but only one primary image.
-- Refuse migration if legacy rows already have multiple primaries so the
-- conflicting rows can be reviewed instead of silently changing the catalog.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "product_images"
    WHERE "isPrimary" = true
    GROUP BY "productId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce one primary product image: one or more products currently have multiple primary images';
  END IF;
END $$;

CREATE UNIQUE INDEX "product_images_one_primary_per_product_idx"
  ON "product_images" ("productId")
  WHERE "isPrimary" = true;
