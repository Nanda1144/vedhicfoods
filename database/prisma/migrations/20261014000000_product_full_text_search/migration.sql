-- PostgreSQL full-text search over the product catalogue.
--
-- The storefront `search` filter previously ranked nothing: it was an OR of
-- ILIKE predicates (see backend/src/services/product.service.ts). This migration
-- adds a `tsvector` representation of each product and the GIN index that makes
-- `@@` and `ts_rank` efficient.
--
-- The column is maintained by a BEFORE INSERT OR UPDATE trigger rather than a
-- STORED generated column. A generated column requires an IMMUTABLE expression,
-- and `array_to_string(tags, ' ')` — needed to fold the product tags into the
-- vector — is only STABLE (it calls the element type's output function), so
-- PostgreSQL rejects it with `42P17 generation expression is not immutable`.
-- A trigger may legally call STABLE functions, and it keeps the column in sync
-- on every write with no application code.
--
-- Weights order matches by field: name (A) outranks tags/sku (C); descriptions
-- sit in between (B). sku is included so the old SKU keyword search keeps
-- working. `english` is the text-search configuration.
--
-- The matching Prisma field is `searchVector Unsupported("tsvector")?` with a
-- `@@index([searchVector], type: Gin)`, so Prisma tracks the column and index
-- (needed for drift detection) without ever reading or writing the
-- trigger-maintained column. The trigger and function are invisible to Prisma's
-- schema diff, which only models tables, columns, indexes and enums.

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "search_vector" tsvector;

CREATE OR REPLACE FUNCTION "products_search_vector_refresh"() RETURNS trigger AS $$
BEGIN
  NEW."search_vector" :=
    setweight(to_tsvector('english'::regconfig, coalesce(NEW."name", '')), 'A') ||
    setweight(to_tsvector('english'::regconfig, coalesce(NEW."shortDescription", '')), 'B') ||
    setweight(to_tsvector('english'::regconfig, coalesce(NEW."description", '')), 'B') ||
    setweight(to_tsvector('english'::regconfig, coalesce(array_to_string(NEW."tags", ' '), '')), 'C') ||
    setweight(to_tsvector('english'::regconfig, coalesce(NEW."sku", '')), 'C');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "products_search_vector_trigger" ON "products";
CREATE TRIGGER "products_search_vector_trigger"
  BEFORE INSERT OR UPDATE
  ON "products"
  FOR EACH ROW
  EXECUTE FUNCTION "products_search_vector_refresh"();

CREATE INDEX IF NOT EXISTS "products_search_vector_idx"
  ON "products" USING GIN ("search_vector");
