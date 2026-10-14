# Inventory System — Test Report

**Status: COMPLETE.** Full stock lifecycle, reservation semantics, concurrency,
checkout integration, audit trail and RBAC verified. One production bug found and
fixed.

## 1. Scope

End-to-end verification of the inventory subsystem:

- Stock lifecycle: `ADD_STOCK`, `REMOVE_STOCK`, `MANUAL_ADJUSTMENT`, `RESTOCK`.
- Status computation and low-stock / out-of-stock / backorder transitions.
- Reservation lifecycle: `reserveStock` → `releaseReservation` / `confirmDeduction`
  / `restockOrder`.
- Transaction atomicity and concurrent oversell prevention.
- Checkout integration: COD (reserve + immediate deduction) vs online/RAZORPAY
  (reserve only), failed-payment release, order cancellation disposition.
- Audit trail (`InventoryLog`) integrity for every mutation.
- RBAC on all `/api/v1/admin/inventory*` endpoints.

## 2. Environment

- Disposable PostgreSQL 17 cluster on port **5435** (data dir under temp),
  migrated + seeded.
- `NODE_ENV=test` → `backend/.env.test`
  (`DATABASE_URL=postgresql://postgres:postgres@localhost:5435/vedhicfoods_test`).
- Vitest + supertest, single-fork, sequential.

## 3. Test Suites & Results

| Suite | Tests | Result |
|---|---|---|
| `tests/integration/inventory.test.ts` (existing smoke) | 24 | ✅ pass |
| `tests/integration/inventory-extended.test.ts` (new, this work) | 44 | ✅ pass |
| **Inventory total** | **68** | **✅ 68/68** |
| Full backend regression (`vitest run`) | 877 (25 files) | ✅ 877/877 |

Verification commands:

```
# inventory suites
$env:NODE_ENV='test'; npx vitest run tests/integration/inventory.test.ts tests/integration/inventory-extended.test.ts
# → 68 passed

# full suite
$env:NODE_ENV='test'; npx vitest run
# → 877 passed (25 files)

npx tsc --noEmit   # clean
npm run lint       # clean (oxlint)
```

### New coverage added (`inventory-extended.test.ts`)

1. **RBAC** — seeded STAFF (`inventory.read/update`) allowed; raw STAFF without
   `UserRole` grants → 403; customer → 403; anonymous → 401.
2. **Lifecycle & `Product.stock` sync** — add/remove/manual/restock, and
   `product.stock === inventory.availableQuantity` after every mutation.
3. **Status computation** — LOW_STOCK threshold boundary, forced BACKORDER,
   OUT_OF_STOCK, low-stock feed membership.
4. **Guard rails** — zero / negative / fractional quantity, unknown operation,
   negative threshold, over-removal, unknown product (404), self-heal of a
   missing inventory row from `product.stock`.
5. **Reservation semantics** — reserve moves available→reserved; over-reserve
   rejected without mutation; non-positive reserve rejected; release capped at
   reserved; release no-op when nothing reserved; confirm converts reserved→sold;
   restock returns sold→available.
6. **Atomicity** — a multi-item reservation whose second line is insufficient
   rolls back the entire set (verified first line untouched).
7. **Concurrency** — see §5.
8. **Checkout integration** — COD reserve+deduct; online reserve-only;
   online-cancel releases; failed-payment then cancel is inert; COD-cancel
   restocks and decrements sold.
9. **Audit trail** — exactly one `InventoryLog` per manual change, precise
   before/after values and actor identity, threshold PATCH audited, history
   paginated newest-first, each reservation operation logs its own operation.

## 4. Bug Found & Fixed

### BUG-INV-1 — Order cancellation used the wrong inventory disposition

**File:** `backend/src/controllers/order.controller.ts` → `cancelOrder`

**Root cause:** the handler unconditionally called
`InventoryService.restockOrder(...)` for every cancellable order, ignoring the
order's actual inventory state. It also only blocked `CANCELLED` / `DELIVERED`,
so already-failed orders were cancellable too.

**Impact:**

1. **Reserved-only orders (`PENDING_PAYMENT`, online payment not yet captured).**
   `restockOrder` increments `availableQuantity` but never touches
   `reservedQuantity`, and it decrements `soldQuantity`. Result: the reservation
   leaked (reserved never released), `soldQuantity` was under-counted, and
   `available + reserved` was inflated by the cancelled quantity.
2. **Already-released orders (`FAILED` / `PAYMENT_FAILED`).** `failPayment` and
   the Razorpay `payment.failed` webhook already released the reservation;
   cancelling afterwards restocked *again*, double-crediting `availableQuantity`.

**Fix:** disposition now depends on the pre-cancellation status:

- `CONFIRMED | PROCESSING | PACKED | SHIPPED | OUT_FOR_DELIVERY` → `restockOrder`
  (stock was deducted; return sold → available).
- `PENDING | PENDING_PAYMENT` → `releaseReservation` (stock only reserved; never
  touch `soldQuantity`).
- `FAILED | PAYMENT_FAILED` → no inventory operation (reservation already
  released).

This aligns `cancelOrder` with the canonical `VALID_ORDER_TRANSITIONS` handling in
`CheckoutService.transitionOrderStatus`.

**Regression tests:** `cancelling an online PENDING_PAYMENT order RELEASES the
reservation` and `cancelling an already payment-failed order does not
double-restore stock`. Both failed before the fix and pass after.

## 5. Concurrency Results

- **8 parallel `reserveStock` calls on a 5-unit product** → exactly **5**
  fulfilled, 3 rejected, `availableQuantity=0`, `reservedQuantity=5`, never
  negative; releasing all 5 restored `availableQuantity=5`. (Row-level
  `SELECT ... FOR UPDATE` + conditional `updateMany ... availableQuantity >= qty`.)
- **6 parallel guest COD checkouts on a 4-unit product** → exactly **4** orders
  created (~201), remaining 4xx; `availableQuantity=0`, `reservedQuantity=0`,
  `soldQuantity=4`, never negative.

No oversell, no negative stock, no deadlock observed.

## 6. RBAC Findings

- Seed role **STAFF** has `inventory.read` + `inventory.update` → list + adjust
  allowed (200).
- A `STAFF` user with **no `UserRole` rows** resolves to zero permissions → 403
  (permissions are granted via `UserRole → RolePermission`, not the `role`
  scalar).
- Customer → 403 on inventory read/history; anonymous → 401.

## 7. Audit Trail Findings

- Every manual stock change writes **exactly one** `InventoryLog` row with
  correct `previousQuantity` / `newQuantity` / `quantityChange` and actor
  `actorId` + `actorEmail`.
- A threshold-only `PATCH` is audited as `MANUAL_ADJUSTMENT` with
  `quantityChange: 0` and `metadata.newThreshold`.
- `reserveStock`, `releaseReservation`, `confirmDeduction`, `restockOrder` each
  emit their own operation row (`RESERVE_STOCK`, `RELEASE_RESERVATION`,
  `CONFIRM_DEDUCTION`, `RESTOCK`).

## 8. Remaining Risks & Notes

- **`confirmDeduction` without a prior reservation** increments `soldQuantity` by
  the requested quantity even when `reservedQuantity < qty` (the reserved debit
  is clamped, the sold credit is not). Normal flows always reserve first, so this
  is latent; a stray `confirmDeduction` call could over-report sold units.
- **Refunds/returns are not wired to inventory.** Only order cancellation paths
  restock; `PaymentStatus.REFUNDED` / `PARTIALLY_REFUNDED` and support
  `RETURN_REFUND` tickets do not trigger restock. Confirm this matches the
  intended business process.
- **Idempotent checkout under true concurrency:** a duplicate POST with the same
  `idempotencyKey` can hit the unique constraint and surface as an error rather
  than an idempotent replay. Sequential replay returns the original order
  correctly.
- **`MANUAL_ADJUSTMENT` cannot set stock to 0** (Zod `positive()`); use
  `REMOVE_STOCK` of the full available quantity.
- **Best-effort audit:** `AuditService.record` for reserve/release/confirm/restock
  is fire-and-forget (`.catch(...)`); the authoritative movement ledger
  (`InventoryLog`) is written synchronously inside the transaction and is fully
  reliable.

## 9. Files Changed (this workstream)

- **NEW** `backend/tests/integration/inventory-extended.test.ts` (44 tests).
- `backend/src/controllers/order.controller.ts` — `cancelOrder` inventory
  disposition fix (BUG-INV-1).
- `backend/tests/integration/inventory.test.ts` — unchanged, remains green.
