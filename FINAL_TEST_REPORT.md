# FINAL TEST REPORT — Product, Category & Product-Image System

**Date:** 2026-10-09
**Scope:** Product CRUD, Category CRUD/hierarchy, Product-Image management, AWS S3 integration, boundary/validation, RBAC, credential-exposure, full regression.

---

## 1. Executive Summary

| Metric | Result |
| --- | --- |
| Catalog suites (new + existing) | **103 / 103 passed** |
| New extended integration suite | **69 / 69 passed** |
| New S3 client unit suite | **20 / 20 passed** |
| Existing catalog integration suite | **34 / 34 passed** |
| Full backend regression (`npm test`) | **563 passed, 270 skipped, 1 suite aborted** |
| Lint (`oxlint`) | clean |
| Typecheck (`tsc --noEmit`) | clean |

Bugs found and fixed: **2** (both in `ProductService.addImage`). Real AWS network calls remain untestable in this environment (no credentials); their production branches are covered with a mocked S3 transport.

The single regression-suite failure (`rbac-matrix.test.ts`) is an **environment/data prerequisite**, not a code regression — the bare test database has no seeded order/address fixtures. Details in §6.

---

## 2. Environment

- **Backend:** Node.js/TypeScript, Express, Prisma 6.
- **Database:** PostgreSQL 17, disposable test cluster on **port 5435** (detached via WMI; data dir under the opencode temp folder). `backend/.env.test` points `DATABASE_URL` at `vedhicfoods_test`.
- **Migrations:** 9 migrations applied (`prisma:deploy`).
- **Seed:** 3 test users only (0 categories, 0 products, 0 orders):
  - `admin@vedhicfoods.com` / `Admin@Vedhic2026`
  - `staff@vedhicfoods.com` / `Staff@Vedhic2026`
  - `customer@vedhicfoods.com` / `Customer@Vedhic2026`
- **Storage:** AWS S3 via `@aws-sdk/client-s3`; in `NODE_ENV=test` operations fall back to simulated results.
- **Runner:** `NODE_ENV=test npx vitest run` (env must be `test` so `.env.test` loads instead of production config).

---

## 3. Test Inventory

### 3.1 New — `backend/tests/integration/catalog-extended.test.ts` (69 tests)

**Product required fields & boundary validation (14)**
- missing name / SKU / price / MRP → 400
- negative price, zero price, negative MRP, zero MRP → 400
- negative stock, fractional stock, negative net weight → 400
- over-long name (>200), SKU (>100), short description (>500) → 400

**Product category references & duplication (10)**
- malformed category UUID → 400; well-formed non-existent UUID → 400; non-existent slug → 400
- duplicate SKU on create → 409; duplicate SKU on update → 409
- duplicate product names allowed, distinct slugs generated
- malformed product ID on read/update/delete → 404
- update to non-existent category → 400

**Product attributes, pricing & stock (6)**
- full attribute round-trip (description, unit, ingredients, nutrition, tags, computed discount)
- explicit discount honoured
- create with stock 0 → `OUT_OF_STOCK`, `isAvailable=false`, inventory row `OUT_OF_STOCK`
- update stock → 0 → `OUT_OF_STOCK`
- update raising price above MRP → 400; negative price → 400

**Product activation lifecycle (2)**
- deactivate → public 404, reactivate → public 200
- legacy `active` flag supported

**Category CRUD, duplication & references (12)**
- create / update / delete empty category
- duplicate name (case-insensitive) → 409; duplicate explicit slug → 409
- delete category containing products → 400
- non-existent parent → 400; malformed parent UUID → 400
- over-long name → 400; invalid accent → 400
- unknown slug → 404; update non-existent → 404

**Image presigned URL validation (9)**
- valid request returns `uploadUrl`/`fileUrl`/`s3Key`; key ends in MIME-derived extension
- SVG → 400; HTML → 400; PDF-as-image → 400
- oversized declared size → 400
- path-traversal filename → 400; null-byte / script filename → 400
- executable filename (`payload.php`) with `image/jpeg` → key ends `.jpg`, never `.php`
- presign for non-existent product → 404

**Image attachment, ordering, replacement, duplication (7)**
- attach verified image, auto-primary on first image
- attach without `s3Key` → 400
- **foreign `s3Key` (another product) → 400** (was 500 — see BUG-1)
- **path-traversal `s3Key` → 400** (was 500 — see BUG-1)
- **duplicate `s3Key` → 409** (was 201 — see BUG-2)
- reorder images → 200; foreign image IDs → 400
- replace (attach new, delete old) → 200, old row removed
- delete unknown image → 404

**Image authorization boundaries (4)**
- customer presign → 403; customer delete → 403; unauthenticated delete → 401
- staff (`products.update`) may attach an image (201), but staff (`products.delete` absent) cannot delete a product (403)

**Credential / internal data exposure (3)**
- no secret tokens in presigned-URL, admin-product, or public-product payloads
- public payload excludes `s3Key`, `inventory`, `isDeleted`

**S3 service behaviour (3)**
- `buildPublicUrl` contains no credentials
- `deleteFile` and `generatePresignedDownloadUrl` degrade gracefully in test env

### 3.2 New — `backend/tests/unit/s3-client-behaviour.test.ts` (20 tests)

Mocks the SDK transport (`s3Client.send`) and the presigner to execute **production** branches:

- upload stores correct `Key`/`ContentType`/`inline` disposition; rejects script bytes before any request
- invalid credentials → generic failure (no provider text leaked)
- unavailable bucket → graceful fallback outside production
- presign returns signed URL / fails closed in production / simulated fallback in test / rejects disallowed type
- `verifyUploadedObject`: accepts genuine bytes; rejects PNG-declared HTML (polyglot), disallowed content type, missing object, wrong product, non-`products/` key, path traversal
- `deleteFile` success/failure; `checkObjectExists` true/false

### 3.3 Existing — `backend/tests/integration/product-category-s3.test.ts` (34 tests)
All pre-existing catalog/product/S3/RBAC/soft-delete tests still pass after the fix.

### 3.4 Existing — `backend/tests/unit/hardened-boundaries.test.ts` (46 tests)
S3 magic-byte inspection, key generation, traversal, JWT, webhook HMAC, error masking — all pass.

---

## 4. Bugs Found & Fixed

### BUG-1 — Malformed / foreign `s3Key` returned HTTP 500 instead of 400
**File:** `backend/src/services/product.service.ts` → `addImage`
`S3Service.verifyUploadedObject` throws a plain `Error` for a key outside `products/`, a key belonging to another product, or an unverifiable object. `addImage` let it bubble to the central error handler, which classifies a bare `Error` as **500**. These are all caller mistakes and must be **400**.
**Fix:** wrap the verification call in `try/catch` and rethrow as `BadRequestError`.
**Covered by:** `rejects a foreign s3Key … with 400`, `rejects a path-traversal s3Key with 400`.

### BUG-2 — Duplicate `s3Key` could be attached more than once
**File:** `backend/src/services/product.service.ts` → `addImage`
The same S3 object could back multiple gallery rows. Deleting one row calls `S3Service.deleteFile`, removing the object while the other row keeps a now-dangling URL.
**Fix:** reject a `s3Key` already present on the product with `ConflictError` (409). The key is trimmed once and reused for verification, URL building and persistence.
**Covered by:** `rejects a duplicate s3Key attachment with 409`.

---

## 5. Full Regression (`npm test`, `NODE_ENV=test`)

```
Test Files  1 failed | 23 passed (24)
     Tests  563 passed | 270 skipped (833)
  Duration  140.39s
```

All product/category/image/S3 suites pass. Lint and typecheck are clean.

---

## 6. Remaining Issues / Notes

1. **`rbac-matrix.test.ts` aborts (environment, not code).**
   Its `beforeAll` requires a pre-existing `Order` and `Address` fixture:
   `Error: No pre-existing order available for IDOR fixtures`.
   The disposable test database was seeded with users only (0 orders), so the suite cannot run. It aborts before executing its 270 tests (reported as skipped). This is independent of the catalog change. To run it, the test DB needs the full order/address seed data.

2. **Real AWS S3 calls are not exercised end-to-end.** No AWS credentials are available. Production branches are validated against a mocked transport; the live bucket round-trip (upload → HeadObject → ranged GetObject → delete) is not covered here.

3. **Pre-existing observation (unchanged):** the catalog seed loaded 0 categories/products, so the disposable DB relies on data created by tests themselves.

4. **Not in scope / left as-is:** explicit `discount` greater than `mrp - price` is accepted (schema only enforces `discount >= 0`); `deleteImage` removes the S3 object before the DB transaction completes.

---

## 7. How to Reproduce

```powershell
# From backend/, with the test Postgres reachable on port 5435
$env:NODE_ENV='test'

npx vitest run tests/integration/product-category-s3.test.ts `
                tests/integration/catalog-extended.test.ts `
                tests/unit/s3-client-behaviour.test.ts `
                tests/unit/hardened-boundaries.test.ts

npm test          # full regression
npm run lint
npx tsc --noEmit
```

**Changed/new files**
- `backend/src/services/product.service.ts` (fixes BUG-1, BUG-2)
- `backend/tests/integration/catalog-extended.test.ts` (new, 69 tests)
- `backend/tests/unit/s3-client-behaviour.test.ts` (new, 20 tests)
- `backend/.env.test` (test DB port 5435)
