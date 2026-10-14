# Delivery Management — Test Report

**Status: COMPLETE.** Full delivery state-machine verified against
`VALID_DELIVERY_TRANSITIONS`, including inventory disposition, concurrency,
order-status synchronisation, RBAC, ownership and audit. Two production bugs
found and fixed (plus a third hardening change).

## 1. Scope

- `GET /api/v1/admin/delivery`, `GET /api/v1/admin/delivery/:id`
  (`:id` = deliveryId | orderId | orderNumber).
- `PATCH /api/v1/admin/delivery/:id` (metadata/tracking update).
- `POST /api/v1/admin/delivery/:id/assign`.
- `PATCH /api/v1/admin/delivery/:id/status`.
- Customer tracking endpoint `GET /api/v1/orders/:orderNumber/delivery`.
- The complete valid transition matrix, invalid/terminal transitions, inventory
  disposition (restock vs release vs inert), order-status mirror, concurrency,
  RBAC, customer ownership, metadata guards and audit trail.

## 2. Environment

- Disposable PostgreSQL 17 cluster on port **5435**, migrated + seeded.
- `NODE_ENV=test` → `backend/.env.test`.
- Vitest + supertest, single-fork, sequential.

## 3. Test Suites & Results

| Suite | Tests | Result |
|---|---|---|
| `tests/integration/delivery.test.ts` (existing) | 24 | ✅ pass |
| `tests/integration/delivery-extended.test.ts` (new, this work) | 23 | ✅ pass |
| **Delivery total** | **47** | **✅ 47/47** |
| Full backend regression (`vitest run`) | 925 (27 files) | ✅ 925/925 |

```
$env:NODE_ENV='test'; npx vitest run tests/integration/delivery-extended.test.ts   # → 23 passed
$env:NODE_ENV='test'; npx vitest run                                                # → 925 passed (27 files)
npx tsc --noEmit   # clean
npm run lint       # clean (oxlint)
```

### Coverage added (`delivery-extended.test.ts`)

1. **RBAC / auth** — all five admin endpoints reject anonymous (401) and
   permission-less customers (403); delivery staff can list (200).
2. **Valid transition matrix** — `PENDING→ASSIGNED→PACKED→SHIPPED→OUT_FOR_DELIVERY→DELIVERED`
   and the assignment-skipping `PENDING→PACKED→…`; order status mirrors at every
   step; COD marked `PAID`/`CAPTURED` on delivery.
3. **Failure & recovery** — `SHIPPED→FAILED→OUT_FOR_DELIVERY`;
   `OUT_FOR_DELIVERY→RETURNED` restocks exactly once; `RETURNED→CANCELLED` does
   **not** double-credit.
4. **Invalid / terminal** — `PENDING→DELIVERED`, `PENDING→SHIPPED`,
   `PENDING→OUT_FOR_DELIVERY`, `PACKED→OUT_FOR_DELIVERY`, `SHIPPED→DELIVERED`,
   `RETURNED→DELIVERED`, `FAILED→DELIVERED` (all 400); `DELIVERED` and
   `CANCELLED` are terminal; duplicate status update → 400; unknown status → 400.
5. **Cancellation disposition** — a `CONFIRMED` (deducted) order restocks once
   when its delivery is cancelled; order becomes `CANCELLED`.
6. **Assignment rules** — inactive staff → 400; assignment after `DELIVERED` → 400.
7. **Metadata guards** — tracking/courier update mirrors onto the order; update on
   a cancelled delivery → 400.
8. **Concurrency** — racing `OUT_FOR_DELIVERY→DELIVERED` vs `→RETURNED` yields
   exactly one winner (200), the other 400/409; delivery and order stay consistent.
9. **Ownership & audit** — owner can track, other customer → 403;
   `DELIVERY_STAFF_ASSIGNED` and `DELIVERY_STATUS_CHANGED` audit rows and
   `DeliveryHistory` entries written.

## 4. Bugs Found & Fixed

### BUG-DEL-1 — Double restock on `RETURNED` → `CANCELLED`

**File:** `backend/src/services/inventory.service.ts` → `executeRestock`

A returned order that was subsequently cancelled restocked the same units a second
time, inflating `availableQuantity` and corrupting sold counts.

**Fix:** `executeRestock` is now idempotent per order — if `context.orderId` is
provided and a `RESTOCK` `InventoryLog` already exists for that order, it returns
early (no second credit). The guard only activates when an `orderId` is present,
so existing callers that pass only `orderNumber` are unaffected.

### BUG-DEL-2 — Wrong inventory disposition for non-deducted orders

**File:** `backend/src/services/delivery.service.ts` → `updateDeliveryStatus`

Cancelling/returning a delivery always restocked, even for orders whose stock was
only **reserved** (never deducted) or already released, leaking reservations and
double-crediting stock.

**Fix:** disposition now branches on the pre-transition order status:

- `CONFIRMED | PROCESSING | PACKED | SHIPPED | OUT_FOR_DELIVERY` → `restockOrder`.
- `FAILED | PAYMENT_FAILED | CANCELLED` → inert (already released).
- otherwise (reserved-only) → `releaseReservation`.

### BUG-DEL-3 — Lost update on concurrent status transitions

**File:** `backend/src/services/delivery.service.ts` → `updateDeliveryStatus`

Two concurrent transitions both read the same starting status and both wrote,
so the last writer silently won (no conflict surfaced) and the order/delivery
could diverge.

**Fix:** optimistic-concurrency guard —
`tx.delivery.updateMany({ where: { id, status: currentStatus }, ... })`; if
`count === 0` a `ConflictError` (409) is thrown. Added the `ConflictError` import.

## 5. Transition Matrix (enforced)

```
PENDING          → ASSIGNED, PACKED, CANCELLED
ASSIGNED         → PACKED, SHIPPED, CANCELLED
PACKED           → ASSIGNED, SHIPPED, CANCELLED
SHIPPED          → OUT_FOR_DELIVERY, FAILED, CANCELLED
OUT_FOR_DELIVERY → DELIVERED, FAILED, RETURNED, CANCELLED
DELIVERED        → (terminal)
FAILED           → OUT_FOR_DELIVERY, RETURNED, CANCELLED
RETURNED         → CANCELLED
CANCELLED        → (terminal)
```

## 6. Remaining Risks & Notes

- Concurrency coverage exercises the optimistic guard via racing API calls;
  a deliberately delayed/overlapping window is not forced, so the 409 vs 400
  loser code can vary (both are correct and asserted).
- Order-status mapping for `RETURNED` intentionally leaves the order in its
  prior fulfilment state (not `CANCELLED`) until an explicit cancel.

## 7. Files Changed (this workstream)

- **NEW** `backend/tests/integration/delivery-extended.test.ts` (23 tests).
- `backend/src/services/delivery.service.ts` — BUG-DEL-2/3.
- `backend/src/services/inventory.service.ts` — BUG-DEL-1.
