# Discount & Festival Promotion System — Test Report

**Status: COMPLETE.** Coupon calculation, eligibility, admin CRUD, festival
promotion on/off and date windows, checkout integration, authorization, tamper
resistance and concurrency verified end-to-end. Three production bugs found and
fixed (all in partial-update validation), plus one test-isolation defect fixed.

## 1. Scope

- `POST /api/v1/coupons/apply` (optional auth) — server-authoritative coupon
  calculation against `{ code, items:[{productId,quantity}] }`.
- Admin CRUD: `/api/v1/admin/discounts/coupons` and `/promotions`
  (create, list, get, PATCH/PUT, `PATCH /:id/status`, DELETE), guarded by
  `discounts.read|create|update|delete`.
- Festival promotions: `GET /api/v1/promotions/active`,
  `GET /api/v1/promotions/:slug` (ON/OFF via `isActive`, `startDate`/`endDate`).
- Checkout integration: `POST /api/v1/checkout` with `couponCode` — the single
  place coupon usage is recorded (`usedCount`, `CouponUsage`).
- Boundaries: `minOrderValue`, `maxDiscount`, PERCENTAGE ≤ 100, FIXED_AMOUNT,
  `maxUses`, `perUserLimit`, start/expiry windows, active/inactive,
  product- and category-restricted coupons.

## 2. Environment

- Disposable PostgreSQL 17 cluster on port **5435**, `NODE_ENV=test`
  (`backend/.env.test`).
- Vitest + supertest, single-fork, sequential.

## 3. Test Suites & Results

| Suite | Tests | Result |
|---|---|---|
| `tests/integration/discount-promotion.test.ts` (existing) | 28 | ✅ pass |
| `tests/integration/discount-extended.test.ts` (new) | 39 | ✅ pass |
| `tests/integration/discount-security-concurrency.test.ts` (new) | 19 | ✅ pass |
| **Discount total** | **86** | **✅ 86/86** |
| Full backend regression (`vitest run`) | 983 (29 files) | ✅ 983/983 |

```
$env:NODE_ENV='test'; npx vitest run tests/integration/discount-extended.test.ts tests/integration/discount-security-concurrency.test.ts
$env:NODE_ENV='test'; npx vitest run     # → 983 passed (29 files)
npx tsc --noEmit   # clean
npm run lint       # clean (oxlint)
```

### Coverage added

**`discount-extended.test.ts` (39)**
- Creation boundaries: missing/zero/negative value, PERCENTAGE > 100, inverted
  window on create, non-positive `maxUses`/`perUserLimit`.
- Calculation correctness: 10% and flat amounts on mixed carts; `maxDiscount`
  cap; cap by eligible subtotal and by cart subtotal; `minOrderValue` gate
  (below/at/above boundary); tax (`5%`) and shipping (`free ≥ 499 else 49`)
  computed on the discounted subtotal.
- Eligibility gates: disabled, not-yet-started, expired, `maxUses` reached,
  `perUserLimit` reached, product-restricted mismatch, category-restricted
  mismatch.
- Festival promotions: create/list, `isActive` ON/OFF toggling, start/end date
  windows, `GET /promotions/active` inclusion/exclusion, `GET /promotions/:slug`
  (inactive/expired/unknown → 400).
- Update validation: partial PATCH cannot push a PERCENTAGE coupon/promotion
  above 100 % (BUG-DIS-1) nor invert the stored date window (BUG-DIS-2); a
  partial PATCH that omits the dates preserves them (BUG-DIS-3 regression).
- Stacking: a single coupon per checkout; attempts to stack a second are
  rejected; festival promotions are **not** applied to checkout totals (by
  design — marketing only).

**`discount-security-concurrency.test.ts` (19)**
- Authorization: anonymous → 401 on all admin endpoints; customer → 403 on
  create/update/toggle/delete/list; a staff user holding only `discounts.read`
  can list (200) but is refused create/update/delete (403); raw STAFF with no
  `UserRole` → 403.
- Tamper resistance: client-supplied prices/line totals are ignored and
  recomputed server-side; a product outside the coupon's allowed scope is
  rejected at checkout; discount is never applied to a different cart than the
  one presented.
- Concurrency: `maxUses=3` under an 8-customer parallel checkout race is
  enforced **exactly** (3 succeed, 5 rejected) — the atomic
  `updateMany({ where: { usedCount: { lt: maxUses } } })` guard serialises on the
  coupon row; `perUserLimit=1` under 5 parallel checkouts by the same customer is
  enforced exactly.
- Usage accounting: `usedCount` and `CouponUsage` rows match the number of
  successful redemptions; rejected attempts leave no usage rows.

## 4. Bugs Found & Fixed

### BUG-DIS-1 — Partial PATCH could push a PERCENTAGE discount above 100 %

**File:** `backend/src/services/discount.service.ts` (`updateCoupon`,
`updatePromotion`)

The update schemas only cross-validated fields present in the *same request
body* (`discountType` + `discountValue`). A partial PATCH that changed only
`discountValue` on an existing PERCENTAGE coupon/promotion bypassed the ≤ 100
check entirely.

**Fix:** validate against the **merged** (DB + request) state before writing:
`effectiveType`/`effectiveValue` from `input ?? existing`, rejecting
`PERCENTAGE > 100` with a 400. Applied to both `updateCoupon` and
`updatePromotion`.

### BUG-DIS-2 — Partial PATCH could invert the stored validity window

**File:** `backend/src/services/discount.service.ts` (`updateCoupon`,
`updatePromotion`)

Likewise, the start>end refinement only ran when both dates were supplied
together. Patching a single date against the other stored date could produce an
invalid window.

**Fix:** compute `effectiveStartsAt`/`effectiveExpiresAt` (and promotion
`startDate`/`endDate`) from `input ?? existing` and reject an inverted effective
window with a 400.

### BUG-DIS-3 — Any partial coupon PATCH silently cleared its date window

**File:** `backend/src/types/discount.types.ts` (`updateCouponSchema`)

The old optional date fields used
`.optional().nullable().transform((val) => (val ? new Date(val) : null))`, which
collapsed an **absent** field to `null`. So an unrelated partial PATCH (e.g.
`{ description: 'only description' }`) wiped `startsAt`/`expiresAt`, turning a
time-boxed coupon into an always-valid one.

**Fix:** the field now preserves the three distinct states —
string/Date → `Date`, explicit `null` → `null`, **absent → `undefined`**
(`z.union([...]).optional().transform((val) => (val === undefined ? undefined : val ? new Date(val) : null))`).
A regression test asserts a partial PATCH leaves the stored window intact.

## 5. Test-Isolation Defect Found & Fixed

**ISSUE-CAT-1 — `catalog-extended.test.ts` leaked every fixture it created.**

The suite had a `beforeAll` but **no `afterAll`**, so each run left ~dozens of
products in the shared test database — including several zero-stock ones. Across
repeated runs these accumulated; because the low-stock listing is a *global,
paginated* query ordered `availableQuantity asc` with a page size of 50, the
accumulated zero-stock products eventually pushed the fixture used by the
pre-existing `inventory.test.ts` low-stock test off page 1, failing it. This was
**not** a discount regression (confirmed by reproducing it with only
`inventory.test.ts` running against the polluted DB).

**Fix:**
1. `catalog-extended.test.ts` now tracks every product/category created via its
   helpers and removes them (with images, inventory, logs and join rows) in a new
   `afterAll`.
2. The 49 already-leaked, order-unreferenced zero-stock products were purged from
   the disposable test DB.

## 6. Notable Verified Behaviour (not bugs)

- Festival promotions are **marketing/listing only** — they are surfaced via the
  promotions endpoints and are intentionally **not** applied to checkout pricing.
  Only coupons affect order totals. Verified explicitly.
- `POST /coupons/apply` is a *preview*: it does not reserve usage. `usedCount`
  and `CouponUsage` are recorded atomically at checkout, so a coupon may be
  applied many times but redeemed only up to its limits.
- One coupon per checkout; there is no coupon-stacking path.
- The promotion slug lookup returns **400** (not 404) for
  inactive/expired/unknown slugs.

## 7. Remaining Risks & Notes

- Concurrency coverage asserts exact limits under parallel HTTP checkouts; it
  does not force an adversarially delayed interleaving inside the transaction
  window.
- Guest `/api/v1/orders/checkout` coupon redemption is covered only through the
  authenticated checkout path.

## 8. Files Changed (this workstream)

- `backend/src/services/discount.service.ts` — BUG-DIS-1/2 merged-state validation.
- `backend/src/types/discount.types.ts` — BUG-DIS-3 date-field transformation.
- **NEW** `backend/tests/integration/discount-extended.test.ts` (39 tests).
- **NEW** `backend/tests/integration/discount-security-concurrency.test.ts` (19 tests).
- `backend/tests/integration/catalog-extended.test.ts` — added fixture tracking + `afterAll` cleanup (ISSUE-CAT-1).
