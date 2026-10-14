# Razorpay Payment System — Test Report

**Status: COMPLETE (live capture BLOCKED — no sandbox credentials).** The real
payment workflow is wired end-to-end and tested without fabricating success:

> Customer places order → order is `PENDING_PAYMENT` → storefront opens Razorpay
> checkout with the admin-configured public key → payment verified against the
> gateway (fail-closed) → order `CONFIRMED` / `PAID` → **tax invoice PDF generated
> and emailed to the customer, plus a printable admin copy** → inventory moved
> from `reserved` to `sold`.

Admin-supplied credentials (key id, key secret, webhook secret) are stored
**encrypted in the database** from the admin dashboard and are the runtime source
of truth; the process environment is only a fallback.

## 1. Scope

- `POST /api/v1/payments/razorpay/order` — initiate a gateway order; amount/currency
  sourced server-side from the DB; returns only the public `keyId`.
- `POST /api/v1/payments/razorpay/verify` — checkout-signature verification +
  authoritative gateway reconciliation (`payments.fetch`), then confirm.
- `POST /api/v1/payments/razorpay/webhook` — HMAC over the byte-exact body;
  `payment.captured`, `payment.failed`, `order.paid`.
- `POST /api/v1/orders/:id/confirm-payment` / `fail-payment` — thin adapters over
  the same service.
- `GET/PUT /api/v1/admin/payment-settings` — encrypted credential storage,
  masked read-back, cache invalidation on rotation.
- Post-payment invoice: `InvoiceService.createInvoiceForOrder` (PDF render → S3
  upload → customer email + admin printable copy).

## 2. Environment

- Disposable PostgreSQL 17 on port **5435**, `NODE_ENV=test` (`backend/.env.test`).
- Vitest + supertest, single-fork, sequential.
- Razorpay SDK 2.9.8. Brevo/S3 simulate under `NODE_ENV=test`.

## 3. Production changes (this workstream)

### BUG-PAY-1 — runtime ignored admin-configured credentials *(fixed)*
`razorpay.client.ts` was an **env-only module singleton**; the encrypted
`payment_settings` row written from the admin dashboard was never used for real
API calls. New `resolveRazorpayCredentials()`:
- reads `payment_settings(id='default')`, decrypts `encryptedKeySecret` /
  `encryptedWebhookSecret` (`decrypt32`) and prefers them **per field**, falling
  back to `env`;
- keeps the env `razorpayClient` singleton when no DB credentials exist (preserving
  existing spy targets) and builds a dedicated client when they do;
- caches for 60 s with `clearRazorpayCredentialCache()`, called by
  `PaymentSettingsController.updateSettings` so a rotation takes effect immediately;
- the resolved key secret feeds signature verification and the resolved webhook
  secret feeds `verifyWebhookSignature`; the resolved key id is what the storefront
  receives.

### BUG-PAY-2 — invoice generation was dead/incorrect code *(fixed)*
`invoice.service.ts` referenced Order fields that do not exist (`placedAt`,
`customerPhone`, `billingAddressSnapshot`) — it would have thrown on the first real
paid order, and it was never wired into payment confirmation anyway.
- mapped correctly to `createdAt`, `phone`, `null`;
- invoice generation is now invoked (best-effort, idempotent) from **both**
  confirmation paths — `verifyAndConfirmPayment` and the `payment.captured`
  webhook — via `RazorpayService.emitInvoice` (dynamic import, non-fatal);
- the customer now receives the **A4 tax-invoice PDF as an attachment**
  (`BrevoEmailService.sendOrderConfirmedInvoiceEmail`) and the admin receives a
  **printable copy** (`BrevoEmailService.sendAdminInvoiceEmail`) using the same
  generated buffer.

### BUG-PAY-3 — test fabricated a successful capture *(fixed)*
The old lifecycle suite stubbed `payments.fetch` to return
`status:'captured'` and asserted the order was confirmed — i.e. it manufactured a
settlement and called it a pass. Replaced with the honest contract: with an
unreachable gateway, verify **refuses (503)** and the order stays
`PENDING_PAYMENT` with no invoice. The genuine success path is exercised by the
webhook suite (real HMAC, no gateway call).

### Shared-DB isolation
Invoices have a restrictive FK to orders. `checkout-order-workflow.test.ts` and
`payment-razorpay.test.ts` now delete invoices before orders in `afterAll`,
eliminating an FK failure (`.catch`'d) that silently leaked paid orders/invoices.

## 4. Test matrix

| Suite | Tests | Result | Nature |
|---|---|---|---|
| `payment-razorpay.test.ts` | 22 | ✅ pass | auth, initiation guards, verify security, status API, webhook signature/HMAC |
| `payment-razorpay-webhook.test.ts` (new) | 10 | ✅ pass | **genuine** capture lifecycle, idempotency, raw-body byte-exactness, out-of-order, invoice |
| `payment-razorpay-verify.test.ts` (new) | 9 | ✅ pass | fail-closed reconciliation; admin DB-credential runtime proof |
| `payment-settings.test.ts` | 4 | ✅ pass | encryption + masked admin read/write |
| `payment-razorpay-live.test.ts` (new) | 1 + 1 | ⛔ 1 **BLOCKED**, 1 pass | real sandbox order create/read — skipped without `rzp_test_*` keys |
| **Payment total** | **46** | **45 ✅, 1 ⛔** | |
| Full backend regression | 1003 (32 files) | ✅ **1002 pass**, 1 skipped | 0 failures |

### What is proven (no gateway stub)
- Webhook signature is verified over the **exact received bytes** (raw-body hook);
  a logically-identical re-serialisation is rejected.
- `payment.captured` → order `CONFIRMED`/`PAID`, payment `CAPTURED`, inventory
  `reserved → sold`, **invoice created** (`INV-YYYY-NNNNNN`, totals match).
- Replays are idempotent (no double deduction, single invoice).
- A late `payment.failed` after capture is ignored (money already banked).
- `payment.failed` → `PAYMENT_FAILED` + reservation released.
- Amount/currency mismatch on capture leaves the order unconfirmed and writes an
  anomaly audit record.
- Admin DB credentials drive the resolver, the webhook verifier (DB secret
  accepted, env secret rejected) and the storefront `keyId`; rotation is immediate.

### What is mocked/adverse-only (never a fake success)
- `payments.fetch` is stubbed **only to simulate failures**: unreachable → 503,
  `authorized` (not settled) → 400, short amount / wrong order / wrong currency →
  400, each with an anomaly audit and no state change.

### Blocked / not automatable
- **Live create/capture** against `api.razorpay.com` cannot run: no real
  `rzp_test_*` key exists in this repo (all placeholders). The live suite is
  credential-gated and reports BLOCKED.
- A true end-to-end **CAPTURE** requires a human entering card/UPI details in
  Razorpay checkout; it cannot be scripted. Automated coverage stops at
  authenticated order creation/retrieval (live) and at webhook-signed capture
  (offline, genuine).

## 5. How to run

```powershell
# from backend/
$env:NODE_ENV='test'
npx vitest run tests/integration/payment-razorpay.test.ts `
              tests/integration/payment-razorpay-webhook.test.ts `
              tests/integration/payment-razorpay-verify.test.ts `
              tests/integration/payment-settings.test.ts
npx vitest run     # full regression → 1002 passed, 1 skipped
npx tsc --noEmit   # clean
npm run lint       # clean (oxlint)
```

To unblock live tests, set real sandbox credentials (env or admin dashboard):
`RAZORPAY_KEY_ID=rzp_test_...`, `RAZORPAY_KEY_SECRET=...`, `RAZORPAY_WEBHOOK_SECRET=...`.

## 6. Remaining / follow-ups

- Full live capture remains manual (sandbox checkout) and is tracked as BLOCKED.
- Optional: admin-inbox recipient for the printable copy is `BREVO_SENDER_EMAIL`;
  a dedicated `ADMIN_NOTIFICATION_EMAIL` would be cleaner.
- Optional: S3 invoice URLs are simulated outside production (AWS unprovisioned).
