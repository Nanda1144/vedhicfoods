# Checkout & Order Creation — Test Report

**Status: COMPLETE.** End-to-end verification of the customer checkout →
order-creation pipeline (cart → address → totals → order → payment prep,
idempotency, email). Three production bugs found and fixed.

## 1. Scope

- `POST /api/v1/checkout` (authenticated) and `POST /api/v1/orders/checkout`
  (optional-auth guest) request validation.
- Address resolution and ownership gates.
- Product availability gates (soft-deleted, inactive, out-of-stock).
- Financial engine: line subtotals, coupon discounts, shipping boundary, 5% tax
  on the discounted amount, and total.
- Coupon lifecycle (invalid / disabled / not-started / expired / per-user limit /
  not-applicable / fixed-amount cap / percentage math / usage recording).
- Price snapshots captured at order time (immutability against later price changes).
- Order numbering (`VF-YYYY-NNNNNN` uniqueness).
- Transaction atomicity / rollback on a mid-transaction failure.
- Client-tamper resistance (ignored `status` / `paymentStatus` / totals / stock).
- Idempotency: sequential replay, cross-user isolation, concurrent double-submit.
- Confirmation-email dispatch and payload correctness, and transport-failure resilience.

## 2. Environment

- Disposable PostgreSQL 17 cluster on port **5435**, migrated + seeded.
- `NODE_ENV=test` → `backend/.env.test`.
- Vitest + supertest, single-fork, sequential.

## 3. Test Suites & Results

| Suite | Tests | Result |
|---|---|---|
| `tests/integration/checkout-order-extended.test.ts` (new, this work) | 25 | ✅ pass |
| Full backend regression (`vitest run`) | 925 (27 files) | ✅ 925/925 |

```
$env:NODE_ENV='test'; npx vitest run tests/integration/checkout-order-extended.test.ts   # → 25 passed
$env:NODE_ENV='test'; npx vitest run                                                      # → 925 passed (27 files)
npx tsc --noEmit   # clean
npm run lint       # clean (oxlint)
```

### Coverage added (`checkout-order-extended.test.ts`)

1. **Validation matrix** — missing address, malformed `addressId`, missing inline
   address fields, quantity `0`, soft-deleted product (404), inactive product
   (400), another customer's address (403).
2. **Shipping & tax** — subtotal `499` free / `498` charged `49`; tax computed on
   `(subtotal − discount)`.
3. **Coupon gates** — invalid, disabled, expired, not-started, not-applicable,
   per-user usage limit, fixed-amount cap, percentage math, usage recorded.
4. **Price snapshot immutability** — order line price/total frozen at checkout.
5. **Order number** — `VF-YYYY-NNNNNN` uniqueness across concurrent orders.
6. **Rollback** — a failing mid-transaction step creates no order and mutates no stock.
7. **Email** — transport failure does not fail checkout; confirmation payload
   carries correct `name` / `unitPrice` / `subtotal`.
8. **Tamper resistance** — client-supplied `status`, `paymentStatus`, `stock`,
   `subtotal`, `total` are ignored; authoritative values used.
9. **Idempotency** — sequential replay → 200 + `X-Idempotent-Replay: true`;
   cross-user reuse of an `idempotencyKey` → 409; concurrent double-submit →
   exactly one order + one replay.

## 4. Bugs Found & Fixed

### BUG-CHK-1 — Confirmation email rendered `undefined` / `NaN`

**File:** `backend/src/services/checkout.service.ts`

The order-confirmation email read `item.productName`, `item.unitPrice` and
`item.totalPrice`, but the order snapshot uses `name`, `price` and `subtotal`.
Every email line showed an empty name and `NaN` amounts.

**Fix:** map `item.name`, `Number(item.unitPrice ?? item.price)`,
`Number(item.subtotal)`.

### BUG-CHK-2 — Concurrent duplicate checkout surfaced as an error instead of a replay

**File:** `backend/src/services/checkout.service.ts`

Two simultaneous POSTs with the same `idempotencyKey` both passed the existence
pre-check; the loser hit the `idempotencyKey` unique constraint inside the
transaction and bubbled up as a raw `409`/`500` instead of the idempotent replay
the API contract promises.

**Fix:** wrap the transaction in `try/catch`; on `error.code === 'P2002'` for the
`idempotencyKey` field, re-query the winning order and return the standard replay
(`200` + `X-Idempotent-Replay: true`).

### BUG-CHK-3 — Cross-user idempotency-key collision leaked another account's order

**File:** `backend/src/services/checkout.service.ts`

An attacker who guessed/observed an `idempotencyKey` used by another customer
received that customer's order back as a "replay" (data-leak + confused-deputy).

**Fix:** when a matching order exists but `existingOrder.userId !== userId`, throw
`ConflictError` (409) instead of replaying. Added the `ConflictError` import.

## 5. Idempotency Semantics (verified)

| Scenario | Response |
|---|---|
| First request | `201` + new order |
| Repeat, same user, same key | `200` + `X-Idempotent-Replay: true` + original order |
| Repeat, different user, same key | `409` |
| Two concurrent, one key | one `201`, one `200` replay, single order row |

## 6. Remaining Risks & Notes

- Guest checkout (`/api/v1/orders/checkout`) does not participate in the
  `idempotencyKey` mechanism the same way; covered for validation only here.
- Coupon `maxUsage` accounting relies on the unique `CouponUsage` row; concurrent
  redemptions at the exact limit boundary were not stress-tested.
- Decimal columns serialize as JSON **strings**; assertions coerce with `Number(...)`.

## 7. Files Changed (this workstream)

- **NEW** `backend/tests/integration/checkout-order-extended.test.ts` (25 tests).
- `backend/src/services/checkout.service.ts` — BUG-CHK-1/2/3.
