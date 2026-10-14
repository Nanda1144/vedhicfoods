-- The pg_trgm GIN indexes (20261012000000) can only be used when EVERY branch
-- of the storefront search OR is indexable. The OR also matches product tags
-- via `"tags" @> ARRAY[$1]::text[]` (product.service.ts). With no index on the
-- tags column PostgreSQL marks the whole OR as a non-indexable (lossy) filter
-- and falls back to a sequential scan regardless of the trigram indexes.
-- This GIN array index (default text_array_ops, supports @> containment) makes
-- the final OR branch indexable, letting the planner emit a BitmapOr over the
-- four trigram scans plus this array scan.

CREATE INDEX IF NOT EXISTS "products_tags_gin_idx"
  ON "products" USING GIN ("tags");