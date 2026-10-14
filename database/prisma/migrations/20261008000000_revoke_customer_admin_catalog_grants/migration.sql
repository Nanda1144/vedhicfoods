-- SECURITY: revoke the storefront CUSTOMER role's staff-level catalog grants.
--
-- `products.read` and `categories.read` are not storefront permissions — the
-- public catalog routes (`GET /api/v1/products`, `/api/v1/categories`) are
-- unauthenticated and check nothing. Those two slugs are instead the *only*
-- gate on the admin-console catalog reads:
--
--   GET /api/v1/admin/products      requirePermission('products.read')
--   GET /api/v1/admin/products/:id  requirePermission('products.read')
--   GET /api/v1/admin/categories    requirePermission('categories.read')
--   GET /api/v1/admin/categories/:id requirePermission('categories.read')
--
-- which are served by the admin flag of `ProductService.listProducts(query, true)`
-- and therefore include soft-deleted, unpublished and inactive rows plus the
-- internal fields the public endpoints strip. Any registered customer could
-- call them.
--
-- The router-wide role gate added to `backend/src/routes/admin.routes.ts`
-- already blocks this independently; this migration removes the grant itself so
-- the database stops asserting a privilege the role must never hold.

DELETE FROM role_permissions
WHERE "roleId" = (SELECT id FROM roles WHERE name = 'CUSTOMER')
  AND "permissionId" IN (
    SELECT id FROM permissions
    WHERE slug IN ('products.read', 'categories.read')
  );
