# Audit Logging & Reporting API — Verification Report

**Scope:** backend-wide audit-trail verification (which sensitive operations are logged, with whom/by whom, no credentials in the trail, authorization and immutability of the log) plus a date-windowed reporting/analytics API test pass, cross-checked against raw database aggregates.

**Result:** All 73 new tests pass. Full regression: **44 files, 1236 passed / 3 skipped / 0 failed** (`NODE_ENV='test'; npx vitest run`). `npx tsc --noEmit` clean; `npm run lint` clean (2 pre-existing warnings unaffected).

---

## 1. Audit-logging gaps found & fixed in source

| Call-site | Gap before this pass | Fix |
|---|---|---|
| `order.controller.ts` `cancelOrder` | No audit on cancellation | Writes `ORDER_CANCELLED` (previousStatus, reason, actor=caller, req) |
| `order.controller.ts` `failPayment` | No audit on payment failure | Writes `ORDER_PAYMENT_FAILED` (reason, actor, req) |
| `staff.controller.ts` staff update | Reactivation collapsed into generic `STAFF_UPDATED` | Dedicated `STAFF_REACTIVATED` when `isActive` flips false → true |
| `checkout.service.ts` checkout | No audit when an order is created | `ORDER_CREATED` + `DELIVERY_CREATED` written atomically inside the checkout transaction (orderNumber/status/paymentMethod metadata, customer actor) |
| `checkout.service.ts` `transitionOrderStatus` | No audit on admin status transitions | `ORDER_STATUS_UPDATED` (previousStatus → newStatus, admin actor) inside the tx |
| `razorpay.service.ts` `initiatePayment` | No audit when a payment is initiated | `PAYMENT_INITIATED` after gateway order creation (razorpayOrderId, amountInPaise) |
| `constants/index.ts` | New actions were unknown to the enum | Added `ORDER_CANCELLED`, `ORDER_PAYMENT_FAILED`, `PAYMENT_INITIATED`, `DELIVERY_CREATED`, `STAFF_REACTIVATED` |

Robustness fixes on the query surface:
- `admin.controller.ts` `getAuditLogs` — malformed `from`/`to` and `from > to` now return **400** (were `new Date(garbage)` → NaN → silent 500), and `page`/`limit` are clamped via `clampPageNumber` / `clampPageSize` so garbage values (`page=abc`, `limit=99999`) cannot crash the query. Same clamp applied to `getCustomers`.

Real bug fixed in `reconciliation.service.ts`:
- `unpaidWithInvoice` was previously assigned `paidWithoutInvoice`, duplicating the wrong figure and leaving the true "unpaid invoices with an invoice" count permanently at zero. Now computed as invoices whose order `paymentStatus !== PAID`.

Routing bug fixed in `reconciliation.routes.ts` / `routes/index.ts`:
- One router mounted at both `/payments/reconciliation` and `/invoices/reconciliation` meant `GET /api/v1/invoices/reconciliation` (bare) was served by the **payments** report handler — which calls the Razorpay gateway and failed closed (503) when the gateway was unreachable; the invoice report was only reachable at the unintuitive `/invoices/reconciliation/invoices`. The two mounts now carry dedicated routers so the bare invoices path serves the invoice report and never touches Razorpay. (`/payments/reconciliation/invoices` + `/:razorpayOrderId` behaviour and ordering preserved.)

## 2. Audit trail coverage verified (`tests/integration/audit-logging.test.ts`)

| Area | What is asserted |
|---|---|
| Authentication | `USER_LOGIN` carries actorId, requestId, IP and User-Agent and never the credential; `USER_REGISTERED`; `PASSWORD_CHANGED` never stores the new value; `USER_LOGOUT` |
| Order lifecycle | COD checkout → `ORDER_CREATED` + `DELIVERY_CREATED` atomically with customer actor; idempotent replay does **not** duplicate records; cancel → `ORDER_CANCELLED`; admin transition → `ORDER_STATUS_UPDATED`; Razorpay failure → `ORDER_PAYMENT_FAILED` |
| Staff lifecycle | `STAFF_CREATED` (actor email, no credential material); disable → `STAFF_DISABLED`; reactivation → distinct `STAFF_REACTIVATED` with no generic `STAFF_UPDATED` emitted for the flip |
| Secret redaction | `password` / `refreshToken` / `webhookSecret` / `keySecret` write as `[REDACTED]`; `apiKey` and plain keys untouched |
| API security | Anonymous 401; customer 403; staff without the permission 403; staff with `audit_logs.read` 200; **immutability** — `POST`/`PATCH`/`PUT`/`DELETE /admin/audit-logs` all 404 (no write routes exist) |
| Query robustness | action filter; date filter; malformed / inverted dates → 400; future dates 200; `page=abc&limit=99999` → clamped 200; customer list survives garbage page values |
| Reconciliation fix | `unpaidWithInvoice` equals the raw count of invoices whose order is not PAID, and `paidWithoutInvoice` equals raw PAID orders lacking an invoice |

## 3. Reporting API — new surface & test matrix (`tests/integration/reporting-api.test.ts`)

New endpoint: `GET /api/v1/admin/reports/:dimension` (`src/services/report.service.ts`, `report.controller.ts`, `report.routes.ts`), mounted under `/admin` after the dashboard/analytics surface and guarded by the same `reports.read` permission.

**Query contract**
- `range=today|week|month|all` (default `all` = all-time, matching the dashboard)
- `from` / `to` ISO-8601 or `YYYY-MM-DD`; `to` is inclusive end-of-day
- empty query → all-time; future-only window → empty series (not an error)
- invalid range / date / `from > to` / unknown dimension / unknown format → **400**
- `limit` default 10, max 100, clamped (`clampPageSize`); `format=csv` streams `text/csv` + `Content-Disposition: attachment`

**Dimensions (9)** — each cross-checked against raw Prisma aggregates for every preset when applicable:

| Dimension | Key verified fields |
|---|---|
| `sales` | orderCount, revenue, averageOrderValue + daily series |
| `revenue` | gross, netPaidRevenue, refundedAmount (REFUNDED + PARTIALLY_REFUNDED), AOV |
| `orders` | total + counts by status incl. cancelled / failed+payment-failed |
| `products` | top-N by revenue: quantitySold, revenue; row-sum consistency |
| `inventory` | active / low stock / out of stock, movementsInWindow vs raw `inventory_logs` |
| `customers` | total, new-in-window, paying-in-window, top customers by revenue |
| `discounts` | usagesInWindow, couponDiscountApplied (via `coupon_usages.usedAt`), orderDiscountInWindow |
| `payments` | totals, captured, refunded vs raw `payments` |
| `delivery` | totals, delivered, pending vs raw `deliveries` |

**Security & privacy:** anonymous → 401; customer → 403 on every dimension (no aggregate leakage); staff without `reports.read` → 403 despite authenticated; staff with the permission → 200; surfaces are read-only (write verbs → 404).

**Export & limits:** CSV content-type / disposition / quoting; future-window CSV still emits the zero-filled daily series (28-day window → header + 28 rows); small `limit` honoured, oversized clamped to ≤100, garbage values fall back to the default; 300-order all-time revenue answers in well under the 5 s budget; unbounded sales series stays under the 400-day bucket cap.

## 4. How to run

```powershell
cd backend
$env:NODE_ENV='test'
npx vitest run tests/integration/audit-logging.test.ts   # 20 tests
npx vitest run tests/integration/reporting-api.test.ts   # 53 tests
npx vitest run                                           # full regression
npx tsc --noEmit && npm run lint
```

## 5. Previously verified (regression baseline)

- Staff/RBAC — `STAFF_RBAC_TEST_REPORT.md`; Notification center / support contact — `SUPPORT_CONTACT_NOTIFICATION_TEST_REPORT.md` (12/12).
- Now combined: 1236 integration tests green (3 skipped: live SES, live Razorpay).