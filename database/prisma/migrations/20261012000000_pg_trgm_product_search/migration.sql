-- pg_trgm GIN indexes accelerate the storefront keyword search whose predicate
-- is OR of ILIKE '%term%' across "name", "shortDescription", "description" and
-- "sku" (see backend/src/services/product.service.ts). Without these every
-- search is a sequential scan; the trigram GIN indexes turn each ILIKE into a
-- bitmap index scan, which is the dominant cost for the default storefront
-- listing query and the keyword search path.
--
-- Requires the pg_trgm extension. On managed PostgreSQL the role that runs
-- `prisma migrate deploy` must be allowed to CREATE EXTENSION (owner/superuser).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "products_name_trgm_idx"
  ON "products" USING GIN ("name" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "products_shortDescription_trgm_idx"
  ON "products" USING GIN ("shortDescription" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "products_description_trgm_idx"
  ON "products" USING GIN ("description" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "products_sku_trgm_idx"
  ON "products" USING GIN ("sku" gin_trgm_ops);