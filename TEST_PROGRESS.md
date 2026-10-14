# Transactional Email (Amazon SES) Delivery Testing — Progress

**Status: COMPLETE (live SES send BLOCKED — no AWS credentials).** See
`EMAIL_DELIVERY_TEST_REPORT.md`.

## Summary
- All eleven notification types covered (welcome, verification, password reset,
  order confirmation, payment confirmation, invoice PDF attachment, shipped /
  out-for-delivery / delivered, cancellation, refund, admin + staff notification).
- New suites green: **45** (`ses-transport` unit 12, `email-queue` unit 6,
  `email-provider` unit 6, `email-delivery` integration 12,
  `email-suppression` integration 7) + gated live suite (1 report + 2 skipped).
  Full backend regression: **1075 passed**, 0 failed, 3 skipped (40 files);
  `tsc --noEmit` clean.
- **8 email defects fixed** (see report): provider setting was dead code; SES
  dropped invoice attachments; sender name placed on recipients; `ReplyToAddresses`
  mis-nested; double retry loop (maxAttempts²); idempotency key never applied;
  payment/delivery/cancel/refund notifications unwired; mail failure could touch
  state (now non-fatal).
- Test approach: capture every send at the provider-agnostic `emailTransport`
  seam (`helpers/email-capture.ts`), plus an injectable SES client stub
  (`__setSesClientForTests`) to assert command shape and simulate failures.
- Production-readiness: `SNS_EMAIL_TOPIC_ARN` + `SNS_VERIFY_SIGNATURE` env vars,
  `ADMIN_NOTIFICATION_EMAIL` wired through the env examples and the ECS task
  definition, and `infra/cloudformation/vedhicfoods-ses.yaml` (domain identity +
  DKIM, configuration set with reputation metrics, bounce/complaint SNS topic and
  event destination).

## Remaining (email)
- **BLOCKED:** live SES tests need a verified identity + AWS creds;
  `email-ses-live.test.ts` is gated on `LIVE_SES=true` and auto-skips.
- In-process email queue is per-instance and non-durable.
- `vedhicfoods-ses.yaml` locally syntax-validated only (AWS CLI absent); run
  `aws cloudformation validate-template` at deploy time.
- SNS subscription must be created (topic → `POST /api/v1/webhooks/email/sns`).

---

# Automatic Invoice Generation Testing — Progress

**Status: COMPLETE.** See `INVOICE_TEST_REPORT.md`.

## Summary
- New invoice suites green: **29** (`invoice-generator` unit 6, `invoice-workflow`
  integration 23). Full backend regression: **1031 passed**, 0 failed, 1 skipped
  (34 files); lint + typecheck clean.
- PDF content is verified by parsing the generated A4 PDF back (dependency-free
  inspector): logo (embedded image), business/invoice/customer/delivery fields,
  every line item (name/unit/price/qty/subtotal), subtotal/discount/delivery/GST/
  grand total, page breaks, page numbers, and no clipped or overlapping text.
- Real, openable sample invoices written to `backend/tests/output/invoices/`.
- **4 invoice defects fixed**:
  1. BUG-INV-1 — no business **logo** on the invoice → runtime-generated PNG mark
     embedded as a real image;
  2. BUG-INV-2 — **no pagination**; long orders ran past the fixed footer
     (clipping/overlap) → page breaks + continuation header + relocated summary +
     per-page footer/page numbers;
  3. BUG-INV-3 — the rupee sign `₹` printed as a corrupted glyph (`0xB9`) in
     PDFKit's WinAnsi Helvetica → amounts now use the ASCII `Rs.` prefix;
  4. BUG-INV-4 — an **admin could view but not download** a customer invoice
     (service re-checked ownership against the admin's id) → `isAdmin` threaded
     through `getInvoiceDownloadUrl`.
- Historical immutability verified: a later product-price change does not alter an
  issued invoice or its regenerated PDF (line-item price snapshots preserved).

---

# Razorpay Payment System Testing — Progress

**Status: COMPLETE (live capture BLOCKED — no sandbox credentials).** See
`RAZORPAY_TEST_REPORT.md`.

## Summary
- Real workflow wired end-to-end: order → Razorpay checkout → gateway-verified
  payment → order `PAID` → **tax invoice PDF emailed to customer + printable admin
  copy** → inventory `reserved → sold`.
- Admin-supplied credentials are stored **encrypted in `payment_settings`** and are
  the runtime source of truth (env is fallback), with immediate cache invalidation
  on rotation.
- New payment suites green: **41** (`payment-razorpay-webhook` 10,
  `payment-razorpay-verify` 9, existing `payment-razorpay` 22); `payment-settings`
  4. Full backend regression: **1002 passed**, 0 failed, 1 skipped (32 files);
  lint + typecheck clean.
- **3 payment defects fixed**:
  1. BUG-PAY-1 — runtime used an env-only client, ignoring admin DB credentials →
     new DB-first, encrypted, cached credential resolver;
  2. BUG-PAY-2 — `invoice.service.ts` referenced non-existent Order fields
     (`placedAt`/`customerPhone`/`billingAddressSnapshot`) and was never wired into
     payment confirmation → mapped correctly, wired into both confirmation paths,
     customer PDF + admin printable copy emailed;
  3. BUG-PAY-3 (test) — the old lifecycle suite stubbed a captured payment and
     asserted success ("fake success") → replaced with a fail-closed refusal test;
     genuine confirmation now covered by a real-HMAC webhook suite.
- Shared-DB isolation: invoice→order FK leak fixed in `checkout-order-workflow` and
  `payment-razorpay` cleanup.

## Remaining (payment)
- **BLOCKED:** live `api.razorpay.com` tests need real `rzp_test_*` keys; the
  credential-gated `payment-razorpay-live.test.ts` auto-skips.
- A true end-to-end CAPTURE requires manual sandbox checkout (human card entry).
- Admin printable-copy recipient is `BREVO_SENDER_EMAIL`; a dedicated
  `ADMIN_NOTIFICATION_EMAIL` would be cleaner.

---

# Discount & Festival Promotion System Testing — Progress

**Status: COMPLETE.** See `DISCOUNT_TEST_REPORT.md`.

## Summary
- New discount suites green: **58/58** (`discount-extended` 39,
  `discount-security-concurrency` 19); existing `discount-promotion` 28 → **86/86**
  discount coverage.
- Full backend regression: **983 passed**, 0 failed (29 files); lint + typecheck clean.
- **3 discount bugs fixed** (all partial-update validation):
  1. BUG-DIS-1 `updateCoupon`/`updatePromotion` could push a stored PERCENTAGE
     discount above 100 % via a partial PATCH → now validates the DB-merged state;
  2. BUG-DIS-2 the same partial PATCH could invert the stored start/expiry
     window → now validates the effective window;
  3. BUG-DIS-3 `updateCouponSchema` collapsed an absent date to `null`, so any
     unrelated partial coupon PATCH silently cleared its validity window → now
     preserves `undefined` for absent and only maps explicit values/`null`.
- **Test-isolation defect fixed (ISSUE-CAT-1):** `catalog-extended.test.ts` had no
  `afterAll` and leaked every fixture, accumulating zero-stock products that
  eventually broke the paginated low-stock listing used by
  `inventory.test.ts`. Added fixture tracking + cleanup and purged 49 stale rows.
- Verified: coupon calculation (caps, min/max, tax/shipping), eligibility gates,
  festival promotion ON/OFF + windows (marketing-only, not applied to pricing),
  authorization (anon 401 / customer 403 / staff read-only), tamper resistance
  (server-authoritative), and concurrency (global `maxUses` and `perUserLimit`
  enforced exactly under parallel checkouts).

## Remaining (discount)
- Adversarially delayed interleavings inside the checkout transaction are not forced.
- Guest `/orders/checkout` coupon redemption covered only via authenticated checkout.

---

# Checkout & Delivery System Testing — Progress

**Status: COMPLETE.** See `CHECKOUT_TEST_REPORT.md` and `DELIVERY_TEST_REPORT.md`.

## Summary
- New suites green: **48/48** (`checkout-order-extended` 25, `delivery-extended` 23).
- Full backend regression: **925 passed**, 0 failed (27 files); lint + typecheck clean.
- **3 checkout bugs fixed** in `backend/src/services/checkout.service.ts`:
  1. BUG-CHK-1 confirmation email used wrong item fields (`undefined`/`NaN`) → mapped `name`/`price`/`subtotal`;
  2. BUG-CHK-2 concurrent duplicate checkout hit the `idempotencyKey` unique
     constraint → now caught (`P2002`) and returned as an idempotent replay;
  3. BUG-CHK-3 a replayed key belonging to another user leaked that order →
     now `409 ConflictError`.
- **2 delivery bugs fixed**:
  4. BUG-DEL-1 `RETURNED → CANCELLED` double-restocked → `executeRestock` is now
     idempotent per `orderId` (`inventory.service.ts`);
  5. BUG-DEL-2/3 wrong inventory disposition for reserved/released orders and a
     lost-update race on concurrent transitions → status-branched disposition +
     optimistic-concurrency `updateMany` guard (`delivery.service.ts`).

## Remaining (checkout/delivery)
- Guest `/api/v1/orders/checkout` idempotency is not exercised beyond validation.
- Concurrent coupon redemption at the exact `maxUsage` boundary not stress-tested.
- Live AWS S3 round-trip still mocked (unchanged from catalog workstream).

---

# Product, Category, and Product-Image System Testing — Progress

**Status: COMPLETE.** See `FINAL_TEST_REPORT.md` for full results.

## Summary
- Test DB resolved: disposable PostgreSQL 17 cluster on port 5435, migrated + seeded.
- Catalog suites green: 103/103 (new extended integration 69, new S3 unit 20, existing integration 34 incl. overlap).
- Full regression: 563 passed, 270 skipped, 1 suite aborted (`rbac-matrix` — missing seed order fixtures, environment issue).
- Lint + typecheck clean.
- 2 bugs found & fixed in `ProductService.addImage`:
  1. malformed/foreign `s3Key` returned 500 → now 400;
  2. duplicate `s3Key` allowed → now 409.

## Remaining
- `rbac-matrix.test.ts` requires seeded order/address fixtures not present in the bare test DB.
- Live AWS S3 round-trip not covered (no credentials); production branches covered via mocked transport.

---

# Inventory System Testing — Progress

**Status: COMPLETE.** See `INVENTORY_TEST_REPORT.md` for full results.

## Summary
- Inventory suites green: **68/68** (new extended integration 44, existing 24).
- Full backend regression: **877 passed**, 0 failed (25 files); lint + typecheck clean.
- **1 bug found & fixed** in `OrderController.cancelOrder` (`backend/src/controllers/order.controller.ts`):
  cancellation always called `restockOrder`, so reserved-only (`PENDING_PAYMENT`)
  orders leaked their reservation and under-counted `soldQuantity`, and
  already-released (`FAILED`/`PAYMENT_FAILED`) orders were double-restocked. Now
  restocks only deducted states, releases reserved-only states, and is inert for
  already-released ones.
- Concurrency verified: no oversell / no negative stock under parallel
  reservations and parallel COD checkouts.

## Remaining (inventory)
- `confirmDeduction` credits `soldQuantity` unconditionally when no reservation
  precedes it (latent).
- Refunds/returns are not wired to restock; only cancellation paths restock.
- `AuditService.record` for reserve/release/confirm/restock is fire-and-forget
  (authoritative `InventoryLog` is transactional and reliable).
