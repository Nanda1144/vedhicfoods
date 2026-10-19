# Current database QA status — 2026-10-18

`DB_QA_REPORT.md` is a historical report dated 2026-10-08. It predates the
current schema and migration work and does not establish that the present
worktree has passed database integration testing.

## Checks completed

| Check | Result | Notes |
|---|---|---|
| Prisma schema validation | PASS | `prisma validate` succeeds for the current schema. |
| Database package build | PASS | TypeScript build succeeds. |
| Backend package build | PASS | TypeScript build succeeds after the audit redaction change. |
| Audit secret redaction | PASS | New unit test covers nested objects and objects inside arrays. |
| Commerce database checks | IMPLEMENTED, NOT APPLIED | New migration rejects negative product prices/stock, inventory quantities, order/invoice totals, order-item amounts/quantities, and payment amounts. Migration preflights legacy rows before adding constraints. |
| Direct-write integrity suite | ADDED, NOT RUN | New suite attempts duplicate order/invoice/SKU values, invalid foreign keys, negative commerce values, rollback, and parallel inventory increments. |
| PostgreSQL integration suite | BLOCKED | The disposable database `vedhicfoods_test` does not exist. The integration guard refused the configured managed database; no live database was touched. |
| Migration deploy/status | NOT RUN | No disposable PostgreSQL server is available. |
| Seed | NOT RUN | Requires an available disposable database. |
| Existing-data migration | NOT RUN | Requires a disposable database with a representative pre-migration dataset. |
| Query plan / PostgreSQL concurrency | NOT RUN | Requires PostgreSQL. The new contract suite has not executed. |

## Files pending database verification

- `database/prisma/schema.prisma` has worktree changes and needs validation against an empty database and an existing-data clone.
- `database/prisma/migrations/20261014000000_product_full_text_search/migration.sql` is untracked in the current worktree and needs fresh-install and upgrade-path verification.
- `database/prisma/migrations/20261018000000_add_commerce_nonnegative_checks/migration.sql` is untracked and needs execution against an empty database and an existing-data clone. If the preflight finds legacy negative values, repair those rows before deployment.
- `database/prisma/migrations/20261018000002_enforce_commerce_ownership_and_order_links/migration.sql` adds ownership and relation constraints. Run it against both an empty database and a sanitized clone; the preflight intentionally fails on legacy orphan or cross-owner rows.
- `backend/tests/integration/database-contract.test.ts` was added for PostgreSQL schema introspection, rollback, duplicate/missing relation checks, and concurrent atomic updates. Run it only after configuring `backend/.env.test` with a disposable local PostgreSQL database.
- `backend/tests/integration/database-security-integrity.test.ts` was added for database-boundary uniqueness, foreign keys, checks, password hashing, rollback, and concurrent inventory adjustments. Run it only after applying migrations to that disposable database.
- `database/seed.ts` needs an idempotency run against that disposable database.

## Static review findings — latest follow-up

- Added additive migration `20261018000002_enforce_commerce_ownership_and_order_links` and matching Prisma relations/foreign keys for order address ownership, invoice/order ownership, coupon usage/order ownership, inventory log order references, delivery assignments, review authors, and support notification messages. Existing orphans and cross-customer references stop the migration before constraints are installed.
- Coupon usage order deletion now uses `RESTRICT` so financial promotion history is retained.
- Weekly admin dashboard totals now use a bounded PostgreSQL aggregate. The previous all-order application-memory query was removed. Runtime `EXPLAIN ANALYZE` remains pending representative PostgreSQL data.
- Redundant pre-existing indexes were not dropped. Their deployed catalog state must be checked through the PostgreSQL integration suite before changing schema history.
- Static review found one duplicate product fetch in the detail-to-related-products path; the existing product record is now reused. Runtime query logging and other query paths still need PostgreSQL-backed profiling.

## Latest verification

- Prisma schema validation, backend build, storefront/admin typechecks and
  production builds pass.
- Backend unit suite: 232 passed. Admin suite: 99 passed. Storefront suite: 13
  passed.
- Database integration tests, migration deploy from empty/existing databases,
  seed, direct-write constraint probes, rollback, and concurrent database
  operations remain **NOT RUN** because no disposable PostgreSQL server or
  Docker engine is available. No live database was contacted.
- Prisma client generation and `migrate diff` remain blocked by Windows
  `EPERM` errors when Prisma starts/replaces its query engine. A migration-history
  drift check still needs to run in CI or on a disposable PostgreSQL instance.

## Staff experience status

Staff API/RBAC tests exist, but the full staff experience is not verified in this run. Login-by-role, module navigation in a browser, logout, idle expiry, and HTTP 403 probes require a running app and disposable seeded database. Existing API tests cover permission matrices and escalation/data-isolation cases but were blocked at database setup.
