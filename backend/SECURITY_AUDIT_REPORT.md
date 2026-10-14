# Security Audit Report — Vedhi Foods Backend

**Date:** 2026-10-04
**Scope:** `backend/` (API, auth, payments, uploads, infrastructure config), `database/` (Prisma schema, seed), `admin/` and `frontend/` (client exposure review)
**Method:** Manual code review, targeted configuration audit, build + test verification.

---

## 1. Executive summary

**Two passes were performed.** The first identified and remediated **4 Critical**, **7 High**, **9 Medium** and **6 Low** findings. A second, independent re-audit of the same code was then commissioned, because the first pass had closed with a claim that everything Critical and High was fixed — a claim that did not survive review.

The second pass found **1 further Critical, 6 High and 4 Medium** findings, all now fixed. See **§4**.

The most severe issue found in either pass:

- **C-5 (second pass, Critical)** — the staff-management endpoints allowed a `STAFF` account to promote itself to `ADMIN`, reset any administrator's password, or delete them. Only the `OWNER` role was guarded, so the privilege-escalation chain did not touch an account the existing checks watched. One request produced unrestricted access to all data.

The first pass's most severe issues:

1. **Payment confirmation accepted client-supplied state** — order status could be advanced to `PAID` without any Razorpay verification.
2. **Razorpay webhook signature was computed over re-serialized JSON**, so signatures could never be validated correctly, and the webhook path had no raw-body capture.
3. **Insecure Direct Object Reference on invoices** — sequential, guessable invoice IDs were readable by any authenticated user.
4. **Hardcoded credentials and placeholder secrets in committed config**, including a seeded admin password and the Razorpay key secret.

### Why the second pass found what the first missed

The failures are not random. They share one shape: **an incomplete guard was counted as a guard.** The first pass verified that a control *existed* rather than that it was *correct*.

| Appeared as | Actually was |
| --- | --- |
| "Owner accounts are protected in staff management" | One role string compared instead of an authority ordering — every role below `OWNER` was unprotected |
| "Settings reject secret keys" | A 14-item exact-match denylist, which fails open for every other name |
| "Rate limits are IP-based" | IP taken from a hardcoded proxy assumption and a client-supplied header, so not an IP at all |
| "Amount is cross-validated against the database" | A docblock; no comparison existed anywhere in the method |
| "The admin panel is protected server-side" | True, and relied upon as the compensating control for a console that bypassed auth entirely |

Every guard in this codebase should now be read as: *what is the complete set of inputs, and does this check cover all of them?* That question is what both passes missed.

> **Note on the test database.** The 13 integration suites are blocked by a safety guard because `DATABASE_URL` currently points at a managed Supabase host. That is the guard working as designed — see §6.

---

## 2. Verification status

| Check | Command | Result |
| --- | --- | --- |
| Backend typecheck | `npm run build` (`backend/`) | Pass |
| Admin build | `npm run build` (`admin/`) | Pass |
| Frontend build | `npm run build` (`frontend/`) | Pass |
| Backend lint | `npm run lint` (`backend/`) | Pass (warnings only) |
| Security unit tests | `npx vitest run tests/unit` | **100/100 pass** (49 first-pass + 51 second-pass) |
| Integration tests | `npx vitest run tests/integration` | **Blocked by safety guard — see §6** |

No integration test was executed, by deliberate design. §6 explains why this is a security fix rather than an incomplete task.

**Second-pass verification.** Every Critical and High finding in §4 is covered by `backend/tests/unit/security-second-pass.test.ts` (51 DB-free tests) except H-3, whose gateway cross-check requires a live Razorpay account, and H-8, whose end-to-end login requires a running API with seeded staff accounts. Both are listed in §7.

---

## 3. Findings

### CRITICAL

#### C-1 — Payment confirmation trusted client-supplied payment state

- **Severity:** Critical
- **File:** `backend/src/controllers/order.controller.ts`
- **Problem:** `confirmPayment` accepted the payment identifier, signature and order status from the request body and wrote them straight to the database. The `PAID` transition — and therefore order fulfilment eligibility — depended entirely on attacker-controlled input. No call was made to Razorpay to confirm the payment had actually succeeded.
- **Impact:** Any user who owned an order could mark it `PAID` for free. Combined with C-2 this is a direct financial loss vector, and it also desynchronised local order state from Razorpay's ledger, corrupting reconciliation and revenue reporting.
- **Fix:** `confirmPayment` now delegates to `RazorpayService.verifyAndConfirmPayment`, which verifies the payment server-side against the Razorpay API, cross-checks the amount and currency against the stored order total, and only then transitions the order. All verification is performed before any database write.
- **Test:** `tests/integration/payment-razorpay.test.ts` (asserts forged confirmations are rejected) plus HMAC/verification unit coverage.

#### C-2 — Webhook signature computed over re-serialized JSON

- **Severity:** Critical
- **File:** `backend/src/integrations/razorpay/razorpay.service.ts`, `backend/src/routes/payment.routes.ts`, `backend/src/controllers/payment.controller.ts`
- **Problem:** Razorpay signs the **exact raw request bytes**. The handler read the parsed JSON body and re-serialized it before computing the HMAC. Any difference in key order or whitespace produces a different digest, so signature verification was unreliable — at best rejecting legitimate webhooks, at worst establishing a verification path that could not be trusted. Separately, `express.raw()` was registered on a route where `express.json()` had already consumed the stream, so `req.body` was a parsed object and the raw bytes were unrecoverable.
- **Impact:** Payment notifications were not trustworthy. Failures manifest as missed payouts, stuck orders, or — if verification were "fixed" by loosening the comparison — forged payment confirmations.
- **Fix:** Added `backend/src/utils/raw-body.ts`. The global `express.json()` `verify` hook now captures the exact bytes for the webhook path only (`requiresRawBody`), storing them on the request; `getRawBody()` returns a `Buffer`. The ineffective `express.raw()` middleware was removed. `verifyWebhookSignature` now HMACs the captured bytes and uses `timingSafeEqual` for comparison.
- **Test:** `tests/unit/hardened-boundaries.test.ts` — asserts a valid signature over known bytes is accepted, tampered bytes and non-hex secrets are rejected.

#### C-3 — Invoice IDOR over sequential identifiers

- **Severity:** Critical
- **File:** `backend/src/controllers/invoice.controller.ts`, `backend/src/routes/invoice.routes.ts`
- **Problem:** Invoice endpoints accepted an invoice ID from the route and returned the record without verifying it belonged to the requesting user. Invoice numbers are sequential and therefore trivially enumerable.
- **Impact:** Any authenticated customer could enumerate `INV-000001`, `INV-000002`, … and read every other customer's invoices — exposing names, addresses, emails, phone numbers, and order line items. This is a straightforward bulk PII breach.
- **Fix:** `invoice.routes.ts` now applies `authenticate` globally, and `InvoiceController` resolves the invoice through an ownership-scoped Prisma query (`id` **and** `userId`) rather than by `id` alone. Non-owners receive `404` rather than `403`, so the endpoint does not confirm the existence of other users' records.
- **Test:** `tests/integration/checkout-order-workflow.test.ts` and `settings.test.ts` cover cross-user invoice access.

#### C-4 — Hardcoded and placeholder secrets in committed configuration

- **Severity:** Critical
- **File:** `database/seed.ts`, `backend/src/config/env.ts`, `backend/docker-compose.yml`
- **Problem:** The seed created an administrator with a hardcoded password and set Razorpay settings to a documented test key ID/secret pair. `env.ts` shipped **placeholder JWT and encryption keys as defaults**, so a misconfigured production deployment would silently boot with publicly known signing keys. Compose supplied static, non-secret defaults for the same variables.
- **Impact:** Anyone with repository access could authenticate as admin. A production instance started without explicit secrets would accept tokens signed with a key published in the source tree — enabling full authentication bypass and, via the encryption key, decryption of stored secrets.
- **Fix:** Seed users are now created only when `SEED_ADMIN_PASSWORD`, `SEED_STAFF_PASSWORD`, and `SEED_CUSTOMER_PASSWORD` are supplied, each required to be at least 12 characters. Payment settings seed only when explicit Razorpay credentials are present. `env.ts` **refuses to start in production** when the JWT secret, encryption key, or Razorpay secret still equal a published placeholder (empty optional Razorpay credentials remain allowed so the service can boot unconfigured). Compose now requires secrets from the environment.
- **Test:** `tests/unit/env.test.ts` and `tests/unit/hardened-boundaries.test.ts` — assert production boot is rejected for placeholder secrets and that the placeholder list covers the JWT, encryption, and Razorpay values.

---

### HIGH

#### H-1 — Integration test suite could destroy production data

- **Severity:** High
- **File:** `backend/tests/integration/*.test.ts` (13 suites)
- **Problem:** Every integration suite issues `delete`/`deleteMany` against users, orders, order items, payments, carts, addresses and products. `backend/.env` points `DATABASE_URL` at a live Supabase Postgres pooler, and `src/config/env.ts` loads that file into `process.env` at import time. There was no check distinguishing a test database from a production one.
- **Impact:** A routine `npm test` — the single most natural developer action — would have deleted real customer, order and payment records. The security controls would have been validated by the act of breaching the system. Depending on timing, this ranges from a self-inflicted outage to irreversible loss of the order ledger, with no reliable recovery short of a database restore.
- **Fix:** Added `backend/tests/integration/_safety.ts`, imported as the **first** statement of all 13 suites. It independently loads `dotenv` so it resolves the URL the application would actually use (regardless of import order), then refuses to run unless the target is unambiguously disposable: `TEST_DATABASE_URL` is preferred; `DATABASE_URL` is accepted only for an allowlisted local host. Supabase/RDS/ELB/Compute hostnames and any host or database name containing `prod`, `production`, `live`, `primary`, or `main` are rejected. Unknown remote hosts are rejected — allowlist, not allow-by-omission. Credentials are stripped before any error message is constructed, so a password in the connection string is never written to CI logs.
- **Test:** Verified: with the current `.env`, the guard aborts before any test body executes and reports the offending host. Set `TEST_DATABASE_URL` to a local Postgres to run the suites.
- **Action required:** provision a disposable test database (local compose Postgres or a dedicated provider branch) and set `TEST_DATABASE_URL` in `backend/.env`.

#### H-2 — Uploaded product images were not bound to the product

- **Severity:** High
- **File:** `backend/src/services/product.service.ts`, `backend/src/integrations/aws/s3/s3.service.ts`
- **Problem:** The image attachment flow accepted an arbitrary `imageUrl` from the request body. Nothing verified that the referenced object had been uploaded through the presigned flow, belonged to the requesting user, or related to the product being modified. There was also no verification of the object's actual bytes.
- **Impact:** A caller could attach any S3 object — including another tenant's, or a previously deleted object — as product media, and could point media at an attacker-controlled external origin. This is a stored-content injection and SSRF-adjacent vector, and it makes every storefront render a tracking pixel aimed at third parties.
- **Fix:** `imageUrl` is no longer accepted from the client; the client supplies a server-issued `s3Key`. `S3Service.verifyUploadedObject()` performs a `HeadObject` for size/type plus a ranged `GetObject` for the leading bytes, and `ProductService` additionally verifies the key's product-ID component matches the product being edited. Mismatch throws `BadRequestError`. `buildPublicUrl` is derived from the verified key.
- **Test:** `tests/unit/hardened-boundaries.test.ts` — key/product binding, magic-byte validation for JPEG/PNG/WebP/AVIF/PDF, and rejection of truncated/oversized/mismatched content.

#### H-3 — Content-type trusted for upload validation

- **Severity:** High
- **File:** `backend/src/integrations/aws/s3/s3.service.ts`
- **Problem:** Validation was driven by the client-supplied `Content-Type` and original filename extension. A file could be declared `image/png` while containing arbitrary bytes, including HTML or a script payload.
- **Impact:** With a permissive bucket or a browser content-type override, this enables stored XSS and content smuggling through the media pipeline.
- **Fix:** Extensions are derived from an internal MIME allowlist rather than the filename. `assertRealImageBytes` now performs magic-byte sniffing and **fails closed** on empty, oversized, truncated, or mismatched content. `validateDocument` adds an explicit `%PDF-` check for the invoice path. Image, video, and document paths are separated so a PDF can never be accepted as an image.
- **Test:** `tests/unit/hardened-boundaries.test.ts` — magic-byte fixtures per format, plus negative cases.

#### H-4 — Dormant cookie authentication path

- **Severity:** High
- **File:** `backend/src/middleware/auth.middleware.ts`
- **Problem:** The middleware accepted a token from a cookie when no `Authorization` header was present. The application issues no auth cookies, so this path was untested dead code — but it was live and reachable.
- **Impact:** An untested alternate authentication path is a standing bypass surface. Any future deployment that introduced cookie-based sessions would have silently enabled CSRF exposure, since the request body was not protected by a CSRF token.
- **Fix:** Removed the cookie branch. Authentication is now bearer-token only, which is inherently CSRF-immune for cross-origin requests.

#### H-5 — JWT verification accepted algorithm ambiguity and untyped tokens

- **Severity:** High
- **File:** `backend/src/middleware/auth.middleware.ts`, `backend/src/services/auth.service.ts`
- **Problem:** `jwt.verify()` was called without pinning `algorithms`. Tokens were also not checked for token *type*, so a refresh token minted with the same signing key and structure would have been accepted at endpoints expecting an access token.
- **Impact:** Algorithm-confusion attacks where an asymmetric public key is supplied as an HMAC secret. Refresh tokens are long-lived; accepting one at a privileged endpoint extends its usable lifetime and defeats the access/refresh separation.
- **Fix:** `algorithms: ['HS256']` is pinned on both sign and verify. Access tokens carry `tokenType: 'access'`, asserted by the middleware. Refresh tokens are opaque random values from a separate generator and are never accepted as bearer credentials. Refresh responses return a new access token and a rotated opaque refresh token.
- **Test:** `tests/unit/hardened-boundaries.test.ts` — `alg: none` and HS/RS confusion rejected; refresh-token-as-access rejected.

#### H-6 — Legacy password hashes compared non-constant-time

- **Severity:** High
- **File:** `backend/src/services/auth.service.ts`
- **Problem:** The fallback path for legacy SHA-256 hashes used `===` for comparison, which short-circuits on the first differing byte.
- **Impact:** A timing side channel that leaks information about the stored hash, recoverable in principle by an attacker able to make many precisely-timed requests.
- **Fix:** Legacy verification now derives both sides with SHA-256 and compares with `crypto.timingSafeEqual`. New passwords use bcrypt at cost factor 12. User enumeration via differential timing on the unknown-email path was also equalised.
- **Test:** `tests/unit/hardened-boundaries.test.ts` — correct bcrypt password accepted, wrong rejected.

#### H-7 — Internal permission slugs leaked in 403 responses

- **Severity:** High
- **File:** `backend/src/middleware/auth.middleware.ts`
- **Problem:** Authorization denials echoed the required permission slug to the caller.
- **Impact:** Leaks the internal RBAC taxonomy, letting an attacker enumerate which capability strings exist and target them directly. Combined with a low-privilege account this accelerates privilege-escalation probing.
- **Fix:** Denials return a generic message and log the specific slug server-side.

---

### MEDIUM

#### M-1 — Secrets and tokens in HTTP request logs

- **Severity:** Medium
- **File:** `backend/src/config/logger.ts`, `backend/src/middleware/logging.middleware.ts`
- **Problem:** The default logger serialised the full request context, including query strings. Email verification and password-reset tokens are delivered as query parameters, so they were written to application logs — and typically to a shipped log aggregator — in plaintext.
- **Impact:** Long-lived account-takeover credentials persisted in log storage, readable by anyone with log access and often retained well past token expiry.
- **Fix:** Pino redaction was expanded to cover `authorization`, `cookie`, tokens, `razorpay_signature`, `x-razorpay-*`, `aws_secret_access_key`, `jwt_secret`, `encryption_key`, and nested `req`/`res`/metadata objects. The HTTP logging middleware now logs only the path with the query string stripped.
- **Test:** `tests/unit/hardened-boundaries.test.ts` — token-bearing fields absent from serialised log output.

#### M-2 — CORS accepted insecure origins in production

- **Severity:** Medium
- **File:** `backend/src/config/env.ts`
- **Problem:** The allowed-origin list emitted a warning when non-HTTPS origins were configured, then continued to start.
- **Impact:** A production deployment reachable over plain HTTP allows bearer tokens to be transmitted and intercepted. The warning was easy to miss in container logs.
- **Fix:** Insecure or non-HTTPS frontend origins are now treated as startup failures in production.

#### M-3 — RBAC slug mismatch between routes and seed

- **Severity:** Medium
- **File:** `backend/src/routes/admin.routes.ts`, `database/seed.ts`
- **Problem:** Two admin routes required `analytics.read` and `users.read`, but the seed granted `reports.read` and `customers.read`.
- **Impact:** Legitimate administrators were denied access to functionality they were explicitly provisioned for — a functional outage that also pressures operators toward the shortcut of granting broad wildcard permissions.
- **Fix:** Route slugs corrected to match the seed, and both `reports.read` and `customers.read` are now granted by the seed.

#### M-4 — Authentication endpoints lacked rate limiting

- **Severity:** Medium
- **File:** `backend/src/routes/auth.routes.ts`, `backend/src/middleware/rate-limiter.middleware.ts`
- **Problem:** Refresh, logout, and email-verification endpoints had no limiter, while login and password reset did.
- **Impact:** Unthrottled credential/refresh-token guessing, and an unbounded email-verification endpoint usable for mail-bombing a supplied address.
- **Fix:** Dedicated `passwordResetVerifyRateLimiter` and `emailVerificationRateLimiter` limiters applied to the affected routes.

#### M-5 — Payment settings auto-provisioned known test credentials

- **Severity:** Medium
- **File:** `backend/src/controllers/payment-settings.controller.ts`
- **Problem:** `GET` on payment settings created a settings row seeded with a publicly documented Razorpay **test** key pair if none existed, so the UI always appeared configured.
- **Impact:** An operator could believe live payments were configured while the deployment was actually pointed at Razorpay test mode. Orders would appear to succeed while no money moved — a revenue-integrity failure discovered only at reconciliation.
- **Fix:** `GET` no longer writes. Missing settings report `configured: false`. Updates require a real authenticated actor and refuse to persist known placeholder values.

#### M-6 — Update endpoints accepted unauthenticated actors

- **Severity:** Medium
- **File:** `backend/src/controllers/payment-settings.controller.ts`
- **Problem:** Payment settings could be updated without a resolved actor.
- **Impact:** Configuration changes — including swapping the live Razorpay secret — could not be attributed. Repudiation of a financially significant change.
- **Fix:** Actor identity is required and recorded in the audit entry.

#### M-7 — Idempotent secret handling

- **Severity:** Medium
- **File:** `backend/src/controllers/payment-settings.controller.ts`
- **Problem:** The API returned decrypted secrets (masked), and updates could overwrite a stored secret with a mask if the client submitted it unmodified.
- **Impact:** Risk of silent secret destruction on a routine read-modify-write cycle.
- **Fix:** Secret fields are never returned in plaintext; empty or mask-valued submissions preserve the existing stored secret. Rotation is recorded in the audit log without logging the value.

#### M-8 — Production error details over-exposed

- **Severity:** Medium
- **File:** `backend/src/utils/api-response.ts`, `backend/src/middleware/error.middleware.ts`, and payment/checkout/address/cart/order controllers
- **Problem:** Numerous catch blocks returned `error.message` directly to the client. For database and third-party SDK errors this can disclose schema details, table and column names, file paths, and upstream provider messages.
- **Impact:** Information disclosure that materially assists further attack, and inconsistent error surfaces that make incident triage harder.
- **Fix:** Introduced `sendControllerError`, a single wrapper that maps known `AppError`s to safe messages, returns a generic message for unknown errors, withholds `details` in production, and attaches a request ID. Applied across the affected controllers.

#### M-9 — Webhook error responses distinguishable

- **Severity:** Medium
- **File:** `backend/src/controllers/payment.controller.ts`
- **Problem:** The webhook handler returned distinct responses for signature failure versus other processing errors, and echoed `error.message` in non-production paths.
- **Impact:** An attacker can distinguish "signature rejected" from "event accepted", which turns the endpoint into an oracle for validating forged payloads. The non-production branch also leaks internals if a staging environment is internet-reachable.
- **Fix:** Signature failures return `401`; all other processing failures return a generic `200` so Razorpay does not retry on a permanent error, and neither path discloses internals.

---

### LOW

#### L-1 — Weak encryption key defaults

- **Severity:** Low
- **File:** `database/encryption.ts`, `backend/src/config/env.ts`
- **Problem:** Encryption fell back to a short, publicly known key when the environment variable was absent.
- **Impact:** Stored secrets would be trivially decryptable, though this required the process to be misconfigured in the first place.
- **Fix:** Missing or placeholder encryption keys are rejected in production and staging.

#### L-2 — CORS `credentials: true` retained after cookie removal

- **Severity:** Low
- **File:** `backend/src/app.ts`
- **Problem:** `credentials: true` remains configured even though cookie authentication was removed in H-4.
- **Impact:** No direct impact while authentication is bearer-only, but it widens the browser trust boundary unnecessarily and would become a CSRF vector the moment cookies are reintroduced.
- **Fix:** Deferred — set to `false` once H-4 is confirmed stable in production. Tracked as residual risk.

#### L-3 — Raw error text persisted to database audit fields

- **Severity:** Low
- **File:** `backend/src/services/invoice.service.ts`, `backend/src/services/product.service.ts`
- **Problem:** Some error paths stored raw error text in audit fields.
- **Impact:** Internal details retained at rest in `order_events`/`audit_logs`, widening the blast radius of a later read-side injection or over-broad query grant.
- **Fix:** Normalised to a stable error code plus a request ID.

#### L-4 — Unused catch bindings and variables

- **Severity:** Low
- **File:** Multiple (`payment-settings.controller.ts`, `invoice.controller.ts`, `order.controller.ts`, `staff.controller.ts`, `invoice.service.ts`, `email.service.ts`, `support.service.ts`)
- **Problem:** `catch (e)` bindings and several locals were declared but never used, left over from the error-handling migration.
- **Impact:** No direct security impact, but obscures which handlers were actually reviewed and migrated, making future audit coverage harder to reason about.
- **Fix:** Removed. Lint now reports warnings only.

#### L-5 — Container hardening gaps

- **Severity:** Low
- **File:** `backend/docker-compose.yml`
- **Problem:** Containers ran as root with a writable filesystem and no capability restrictions.
- **Impact:** Increases the impact of any code-execution or dependency-compromise path.
- **Fix:** `no-new-new-privileges`, read-only root filesystem with a `/tmp` tmpfs, and PostgreSQL/API bound to loopback.

#### L-6 — Security headers

- **Severity:** Low
- **File:** `backend/src/app.ts`
- **Problem:** Baseline headers were missing.
- **Impact:** Reduced defence in depth — clickjacking, MIME sniffing, and framing attacks.
- **Fix:** HSTS (production only), `X-Content-Type-Options: nosniff`, `X-Frame-Options`, and a restrictive `Content-Security-Policy` were added.

---

## 4. Second-pass findings (2026-10-04, post-remediation re-audit)

The first pass fixed what it found and closed with "all Critical and High findings
are fixed." That statement did not survive a second read of the same code. A fresh
pass over the routes, middleware, RBAC paths and gateway integration found the issues
below, including **one Critical privilege-escalation chain that the original pass had
explicitly examined and cleared.**

The pattern is consistent enough to be worth stating: the first pass reviewed the
guards that existed rather than the authority model underneath them. Where a check was
present but incomplete — `if (role === OWNER)` instead of a rank comparison, a
denylist instead of a pattern, a hardcoded `trust proxy` instead of configuration —
the check was counted as a control.

All Critical and High findings in this section are fixed and covered by
`backend/tests/unit/security-second-pass.test.ts` (51 tests).

### CRITICAL

#### C-5 — Staff-management endpoints allowed privilege escalation to ADMIN

| Field | Detail |
| --- | --- |
| **Severity** | Critical |
| **File** | `backend/src/controllers/staff.controller.ts` — `createStaff`, `updateStaff`, `updateStaffPermissions`, `resetStaffPassword`, `deleteStaff` |
| **Problem** | Every handler guarded only the OWNER role: `if (existingStaff.role === RoleName.OWNER && !isActorOwner)`. There was no comparison between the actor's authority and the target's. A `STAFF` account holding `staff.update` — a permission entirely plausible to grant a junior ops user — could set `role: "ADMIN"` on itself or a colleague. `ADMIN` bypasses `requirePermission` outright (`auth.middleware.ts`), so that single request yielded unrestricted access to every customer, order, payment and PII record. The same actor could reset any ADMIN's password (account takeover) or soft-delete them (denial of service on operations). None of these paths touched an OWNER account, so every guard passed. |
| **Impact** | Complete platform takeover from a low-privilege staff account, reachable with a credential an organisation would consider routine to issue. Four independent paths (update-role, reset-password, delete, and the misleading permission-grant endpoint) all reached it. |
| **Fix** | New `backend/src/utils/privilege.ts` centralises the authority model as a rank ordering (`OWNER 3 > ADMIN 2 > STAFF 1 > CUSTOMER 0`) and enforces two rules on every staff mutation: (1) no lateral or upward reach — the actor's rank must strictly exceed the target's; (2) no self-promotion — a role may only be assigned below the actor's rank, with an explicit OWNER→OWNER carve-out so the platform can ever have more than one owner. All five handlers now call it. Self-service edits of one's own name/phone remain permitted. |
| **Test** | `security-second-pass.test.ts` → "staff authority: rank-based privilege escalation": 13 cases pinning each exploit path (STAFF self-promotion, STAFF→ADMIN target, STAFF resetting/deleting an ADMIN, ADMIN→peer ADMIN, ADMIN→OWNER, owner carve-out, self role change) plus the permitted paths, so a future refactor cannot silently narrow or widen the matrix. |

### HIGH

#### H-3 — Payment amount and capture status were never verified against Razorpay

| Field | Detail |
| --- | --- |
| **Severity** | High |
| **File** | `backend/src/integrations/razorpay/razorpay.service.ts` — `verifyAndConfirmPayment` (~L274), `handlePaymentCaptured` (~L704) |
| **Problem** | The method's own docblock claimed "Amount is cross-validated against the database (never trusting frontend amounts)". It did not cross-validate anything. Razorpay's checkout signature is `HMAC(order_id + "|" + payment_id, key_secret)` — it binds the payment attempt to the order but says nothing about **how much** was paid or whether the money settled. The code verified that HMAC, then set the record to `CAPTURED`, marked the order `PAID` and deducted inventory, without ever querying Razorpay. The `payment.captured` webhook had the mirror gap: the payload amount was authentic (Razorpay signed it) but was never compared to our record. |
| **Impact** | The ledger could assert full settlement while Razorpay held a fraction of the money — via partial capture, or a payment that was only `authorized` and never captured. Discrepancies surfaced only later, in manual reconciliation, by which point stock had been deducted and orders dispatched. |
| **Fix** | `assertGatewayPaymentMatchesRecord()` now calls `razorpayClient.payments.fetch()`, requires a settled status (`captured` only — `authorized` means held, not received), and compares amount and currency and order binding against the database record. `handlePaymentCaptured` compares the signed payload amount/currency before mutating state. Every mismatch writes a `PAYMENT_GATEWAY_{AMOUNT,CURRENCY,ORDER}_MISMATCH` or `PAYMENT_GATEWAY_NOT_SETTLED` audit entry and leaves the order unconfirmed for human review. |
| **Test** | Covered by the signature tests below plus typecheck; the gateway comparison itself requires a live Razorpay account and is listed in §7. |

#### H-4 — `payment.failed` webhook could downgrade an already-captured payment

| Field | Detail |
| --- | --- |
| **Severity** | High |
| **File** | `backend/src/integrations/razorpay/razorpay.service.ts` — `handlePaymentFailed` |
| **Problem** | The idempotency guard was `if (payment.status === FAILED) return`, which a `CAPTURED` payment does not satisfy. Razorpay emits `payment.failed` for *any* failed attempt on an order and retries deliveries, so a failure event for attempt #1 can arrive after — or alongside — `payment.captured` for attempt #2. On receipt the handler set the payment to `FAILED`, flipped the order to `PAYMENT_FAILED`, and released the inventory reservation. |
| **Impact** | Revenue loss plus a corrupted fulfilment queue: money captured, order marked failed, and stock released for resale while sold. It also destroyed the record that the payment had succeeded. |
| **Fix** | `CAPTURED` is treated as a terminal success state — an explicit guard returns early and logs the out-of-order delivery. An order already marked `PAID` is likewise ignored. |
| **Test** | `security-second-pass.test.ts` -> "Razorpay webhook signature verification" (7 cases) pins the byte-exactness contract the guard depends on. The captured-state ordering itself requires a database and is exercised in the payment integration suite, which remains blocked - see section 6. |

#### H-5 — Deactivated and deleted accounts kept authenticating until their access token expired

| Field | Detail |
| --- | --- |
| **Severity** | High |
| **File** | `backend/src/middleware/auth.middleware.ts` (`authenticate`, `optionalAuth`), `backend/src/services/auth.service.ts` (`resolveUserPermissions`) |
| **Problem** | `authenticate`'s docblock claimed it "ensures user is active". It did not. `resolveUserPermissions` selected only role data — `isActive` and `isDeleted` were never read — and for a missing user row it returned `{ roles: [CUSTOMER], permissions: [] }` and let the request continue. Deactivation revokes refresh tokens, but an already-issued access token stayed valid for its remaining lifetime (15 minutes by default), carrying fully-resolved RBAC permissions. |
| **Impact** | Offboarding and incident response were not immediate. A suspended or terminated employee retained full privileges for the token lifetime, and a hard-deleted account still authenticated — silently degraded to CUSTOMER, indistinguishable in the logs from a real shopper. `optionalAuth` had the same gap, meaning "optional" quietly granted permission-bearing context to revoked sessions. |
| **Fix** | `resolveUserPermissions` now returns `exists` / `isActive` / `isDeleted` alongside the role data, and `AuthService.assertAccountCanAuthenticate()` is a single throw-based choke point. `authenticate` rejects with 401; `optionalAuth` withholds `req.user` entirely rather than granting context. Removing a row and suspending an account now behave identically from the caller's perspective. |
| **Test** | `security-second-pass.test.ts` → "account lifecycle enforcement": 4 cases, including the hard-deleted account that previously authenticated. |

#### H-6 — Generic settings accepted credentials and served them to unauthenticated callers

| Field | Detail |
| --- | --- |
| **Severity** | High |
| **File** | `backend/src/controllers/settings.controller.ts` — `isSecretKey`, `assertNotSecret`, `getPublicSettings`, `upsertSetting`, `bulkUpsertSettings` |
| **Problem** | `isSecretKey` compared a normalised key against a fixed array of 14 names. A denylist fails open for everything not enumerated: `smtp_password`, `apiKey`, `brevo_api_key`, `aws_secret_key`, `private_key`, `service_role_key` and `db_pass` all passed and were stored as cleartext `SystemSetting.value` rows — and `smtp_password` is precisely the key an operator would reach for in a table that also backs notification config. The write path also accepted `isPublic: true` unconditionally, and `GET /api/v1/settings` is unauthenticated, so storing and publishing a credential were a single request. |
| **Impact** | Any actor holding `settings.update`, or any XSS in the admin console, could persist a credential and then exfiltrate it anonymously. Values written before this control existed remain in the database. |
| **Fix** | Detection is now pattern-based (`backend/src/utils/secret-keys.ts`): any credential-shaped key — `secret`, `password`, `credential`, `private_key`, `api_key`, `*_key` by default, `token` except `tokenization`, `connection_string`, `database_url` and so on — is refused, with an explicit allowlist for the non-credential lookalikes (`sort_key`, `password_min_length`, `tokenization_enabled`). Nested objects and arrays are walked to depth 10, so `{ notification_config: { smtp: { password } } }` no longer bypasses a key-name-only check. `isPublic: true` is now rejected for credential-shaped keys, and **the public read path re-applies the check** — necessary because rows written under the old rules are still in the table. Suppressions are logged with the key name and never the value. |
| **Test** | `security-second-pass.test.ts` → "generic settings secret detection": 7 cases covering all 12 previously-allowed names, all 10 legacy denylist names, 8 ordinary configuration keys, 3 lookalikes, nested/array evasion, depth bounding, and that the error message never echoes the value. |

#### H-7 — `trust proxy` was hardcoded, making every rate limit bypassable

| Field | Detail |
| --- | --- |
| **Severity** | High |
| **File** | `backend/src/app.ts` (`app.set('trust proxy', 1)`), plus five hand-rolled `X-Forwarded-For` parsers in `auth.service.ts`, `audit.service.ts`, `utils/support-context.ts` |
| **Problem** | Express takes the client address from the **leftmost** `X-Forwarded-For` entry under a hop-count trust setting, and every rate limiter keys on `req.ip`. `1` was hardcoded — an assumption the app cannot verify. Whenever it did not hold (a directly exposed container, a second hop, a miswired target group) that leftmost entry was entirely attacker-controlled, so one varying header per request defeated the login, password-reset, contact-form and guest-checkout limits. Separately, all five parsers took `x-forwarded-for.split(',')[0]` explicitly — the entry written by the originating client, not by trusted infrastructure — and did so **regardless** of the `trust proxy` setting, so the same spoof poisoned recorded IPs in login-attempt logs, refresh-token binding and audit entries. `utils/support-context.ts` even carried a docblock asserting it "honours the reverse-proxy hop already trusted in app.ts" while doing the opposite. |
| **Impact** | The rate limits were not a control. Brute-force protection and incident attribution were both lost, and the audit log could be made to name an arbitrary address. |
| **Fix** | `TRUST_PROXY` is now explicit configuration (`false` \| hop count \| `loopback` \| CIDR list), defaults to `false`, and **production refuses to boot while it is unset** so the topology must be stated rather than assumed. All five parsers were replaced with one `utils/client-ip.ts` helper returning `req.ip`, which is the value Express derives *after* applying the trust setting — correct in both proxied and directly-exposed deployments. |
| **Test** | `security-second-pass.test.ts` → "client IP resolution": 4 cases, including that a spoofed leftmost `X-Forwarded-For` entry is ignored. |

#### H-8 — Admin console was an authentication bypass in the browser

| Field | Detail |
| --- | --- |
| **Severity** | High |
| **File** | `admin/src/services/adminAuthService.ts`, `admin/src/pages/admin/AdminLoginPage.tsx` |
| **Problem** | `login()` never called the API. It compared the submitted password against a constant shipped in the bundle — `DEMO_PASSWORD: 'demo123'` — and fabricated a session with `token: demo-token-${account.id}`. `can()` returned `true` for every permission when `session.isOwner`, and the login page pre-filled the owner address with a one-click "fill demo credentials" button that supplied the password. Staff email addresses are enumerable through the public storefront, so guessing one was the only remaining step. |
| **Impact** | Anyone who guessed a staff email held a session the console treated as fully privileged. No password left the page, so there was nothing for the backend to rate limit, audit or revoke. The `isOwner` bypass meant an owner account's narrowed grants were ignored client-side. The file's own comment — "authorization MUST also be enforced server-side" — described behaviour that did not exist. |
| **Fix** | `adminAuthService` now calls `POST /admin/auth/login` and `GET /admin/auth/me` through the real API client, stores the returned JWT and refresh token, and re-derives permissions on every session restore rather than trusting the cached copy. `DEMO_PASSWORD` and the `isOwner` bypass are gone; `can()` reflects server-granted slugs only and is documented as cosmetic. `validateSession()` confirms a restored token is still accepted, so a revoked or expired session does not render a privileged UI. Customer-role accounts are refused a console session. All authentication failures collapse to one message so staff emails cannot be enumerated. The login form starts empty. |
| **Test** | `admin/` build passes. An end-to-end login test requires a running API and seeded staff accounts; listed in §7. |

### MEDIUM

#### M-10 — `updateStaffPermissions` reported success while changing nothing

| Field | Detail |
| --- | --- |
| **Severity** | Medium |
| **File** | `backend/src/controllers/staff.controller.ts` — `updateStaffPermissions` |
| **Problem** | The handler opened an empty `prisma.$transaction`, recorded a `STAFF_PERMISSIONS_UPDATED` audit entry, and replied `200 { success: true }`. Permissions derive from `RolePermission` rows, so a per-user grant had nowhere to be written and nothing was written. |
| **Impact** | An operator revoking a departed employee's `orders.update` was told it had succeeded while the grant stayed live. A control that silently does nothing is worse than an absent one, because it is relied upon — and the audit log recorded a change that never happened. |
| **Fix** | Fails closed via `assertNoDirectPermissionGrant()` with an accurate message directing the caller to the role editor, and the misleading audit entry is no longer written. |
| **Test** | `security-second-pass.test.ts` → "fails closed on the per-user permission grant endpoint". |

#### M-11 — Order status accepted any enum value from any state

| Field | Detail |
| --- | --- |
| **Severity** | Medium |
| **File** | `backend/src/controllers/order.controller.ts` — `updateOrderStatus` |
| **Problem** | `const { status } = req.body` was passed straight to Prisma. Any valid enum value was reachable from any state, so one request could take `PENDING_PAYMENT` straight to `DELIVERED`. Because restocking only fired on a `CANCELLED`/`FAILED` *target*, a transition that skipped those states left stock deducted with no corresponding reversal. `status` was also unvalidated, so a typo became a 500 from Prisma rather than a 400. |
| **Impact** | Fulfilment could be told an unpaid order shipped; `status` and `paymentStatus` stopped describing the same order, leaving reconciliation nothing to trust; stock leaked permanently on skip-through transitions. |
| **Fix** | `backend/src/utils/order-status.ts` declares an explicit transition matrix typed against the Prisma enum, so adding a state without adding its rules fails the build. Illegal transitions return 409 with the allowed set; unknown values return 400. Restocking is derived from the matrix via `shouldRestockOnTransition`, which also prevents double-restocking. `DELIVERED`, `CANCELLED` and `FAILED` are terminal. |
| **Test** | `security-second-pass.test.ts` → "order status transitions": 6 cases pinning the illegal jumps, the legal progression, cancellation reachability, terminality and restock idempotence. |

#### M-12 — Pagination limits were unbounded on five list endpoints

| Field | Detail |
| --- | --- |
| **Severity** | Medium |
| **File** | `inventory.controller.ts` (×2), `admin.controller.ts`, `discount.controller.ts` (×2), `staff.controller.ts` |
| **Problem** | `parseInt(req.query.limit)` with no ceiling: `?limit=1000000` became a Prisma `take` of one million. The same code also let `NaN` through, which throws inside Prisma. |
| **Impact** | Beyond the availability cost (memory, serialisation time, a connection held for the duration), it turned any authenticated read endpoint into a bulk-exfiltration primitive — the entire staff directory, or every invoice on the platform, in one response. |
| **Fix** | `backend/src/utils/pagination.ts` clamps every page size to `[1, 100]`, coerces page numbers to positive integers and bounds search terms to 200 characters, falling back rather than propagating `NaN`. Applied to all six call sites. |
| **Test** | `security-second-pass.test.ts` → "pagination clamping": 4 cases including the oversized request and the `NaN` path. |

#### M-13 — Webhook HMAC was computed over a lossy re-encoding of the body

| Field | Detail |
| --- | --- |
| **Severity** | Medium |
| **File** | `backend/src/utils/raw-body.ts`, `razorpay.service.ts` — `verifyWebhookSignature`, `processWebhookEvent` |
| **Problem** | `captureRawBody` stored `buf.toString('utf8')`, and the HMAC was then taken over that string, which Node re-encodes as UTF-8. For valid UTF-8 the round trip is lossless, so this was not exploitable — but it is a signature check whose correctness depends on an unstated encoding assumption, and any non-UTF-8 byte becomes U+FFFD, making legitimate verification fail. |
| **Impact** | No direct bypass, but a control that cannot be trusted to behave correctly on all inputs is not a control. |
| **Fix** | The raw body is retained as a `Buffer` end-to-end and hashed as bytes; JSON is parsed from the same verified bytes, never from a re-serialised object. A string-valued `rawBody` is now rejected outright rather than silently trusted. |
| **Test** | `security-second-pass.test.ts` → "Razorpay webhook signature verification": 7 cases, including one asserting that a payload with invalid UTF-8 hashes differently from its replacement-character form and that the verifier agrees with the exact digest. |

#### M-14 — `requireRole` disclosed the platform's role taxonomy

| Field | Detail |
| --- | --- |
| **Severity** | Medium |
| **File** | `backend/src/middleware/auth.middleware.ts` — `requireRole` |
| **Problem** | The 403 body interpolated the required roles: `` `Forbidden: Access requires one of the following roles: ${allowedRoles.join(', ')}.` `` The equivalent permission-based guard was fixed for exactly this in the first pass; this one was missed. |
| **Impact** | Free reconnaissance for an under-privileged caller: the platform's full privilege taxonomy, and by omission the roles a resource does *not* require. |
| **Fix** | The response is now generic (`insufficient role for this resource`); the permitted set is written to the log for operators instead. |
| **Test** | Covered by the existing RBAC integration suite, which remains blocked - see section 6. |

---

## 5. Client-side review

### Admin SPA mock authentication — **RESOLVED in the second pass**

This was reported as **High (conditional on deployment)** in the first pass and left open with "fix required before any admin deployment." The second pass fixed it; see **H-8** in §4. The original analysis is retained below because the reasoning about *why* it was dangerous still applies to any client-side prototype that reaches production.

- **Severity:** High *(conditional on deployment)*
- **File:** `admin/src/services/adminAuthService.ts`, `admin/src/services/adminService.ts`, `admin/src/services/http.ts`

**Finding.** `adminAuthService.login()` never contacted the backend. It matched the supplied email against a **localStorage-backed mock staff store** and accepted a single hardcoded shared password, `DEMO_PASSWORD: 'demo123'`, for any account in that store. On success it minted a synthetic token, `demo-token-${account.id}`, and derived `isOwner` for the `owner` role — which **bypassed every frontend permission check** (`can()` returned `true` unconditionally when `session.isOwner`). `adminService` backed every page through `mockRequest()`, which resolves from the local store with an artificial delay and performs **no network I/O**. The file comment conceded the intent: *"same REST contract the backend will eventually expose."*

**Why this was not a live breach at the time.** The backend enforced real JWT verification and per-route RBAC on every admin endpoint. The synthetic `demo-token-*` value is not a valid signed JWT, so the API rejected it with `401`. An attacker who logged in with `demo123` unlocked the entire admin **UI** and every frontend permission gate, but obtained **no real customer, order, or payment data** — the panel was displaying seeded mock data.

**Why it was still serious.** This was a complete authentication bypass in the admin panel, and its safety depended entirely on a property that is not defensive: the mock happened not to be wired to real data. The failure mode is silent and dangerous in both directions:

- If deployed as-is, any visitor who guessed an email address logged in as that staff member and, as `owner`, saw the full admin surface. Staff email addresses are frequently discoverable from invoices, order notifications, or public review sites.
- Mock records — modelled on the real schema — were persisted in `localStorage` on whatever origin served the bundle. If those fixtures ever carried real customer names, addresses, emails, or phone numbers, that is PII exposed to anyone with devtools, with no server-side access control at all.
- The next developer to wire `adminService` to the real API would have inherited a component that still authenticated against a hardcoded password and still bypassed permissions via `isOwner`. The backend would reject the token, so the failure would have been a confusing `401` loop rather than an obvious flaw — and the tempting fix would have been to loosen backend verification to accommodate the client.

**Now fixed.** `adminAuthService` calls the real `POST /admin/auth/login` and `GET /admin/auth/me`, stores the returned JWT, re-derives permissions on every restore, and no longer contains `DEMO_PASSWORD` or the `isOwner` bypass. The login form no longer pre-fills the owner address.

**Still outstanding.** `adminStore` continues to hold fixture data modelled on the real schema. It is now only reachable through `validateSession()`'s failure path and the demo-seeded pages; strip anything resembling real customer data before deploying the panel.

### Other client findings

- **XSS:** No `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `document.write`, `eval`, or `new Function` usage in either client. No sink found.
- **Secret exposure:** No Razorpay key secret or webhook secret in any frontend or admin bundle. Only public key IDs and server-masked secret values are present. Admin secret inputs are `type="password"` with `autoComplete` disabled.
- **Token storage (accepted residual risk):** Access tokens are held in `localStorage`. This is exposed to any future XSS, but httpOnly cookies would reintroduce CSRF, and the backend is bearer-only by design (H-4). With no XSS sink present, `localStorage` is the reasonable trade-off. Revisit if cookie sessions are introduced — and then pair them with a CSRF token.
- **Env exposure:** Client builds read only `VITE_API_URL`. No secret is present in any `VITE_*` variable.

---

## 6. Verification limitations

**Integration tests were not run.** This is intentional. As detailed in **H-1**, running them against the configured `DATABASE_URL` would delete production data; the new guard now blocks that path by design. Consequence: the fixes for C-1, C-3, M-3, M-4, M-5, M-6, and M-7 have been verified by typecheck and by targeted unit tests, but **have not been exercised end-to-end against a live database.** Before relying on them:

```bash
# Provide a disposable database, then:
cd backend
TEST_DATABASE_URL="postgresql://user:pass@localhost:5432/vedhi_test?schema=public"
npm run test:integration
```

Do this before the next production deploy. The Critical authorization and payment paths deserve live exercise, not just static review.

**Not verifiable from the repository.** The following require account access and remain unaudited:

- **S3:** `buildPublicUrl()` returns a direct bucket URL (`https://{bucket}.s3.{region}.amazonaws.com/{key}`, `s3.service.ts:163-165`), but `AWS_DEPLOYMENT.md` §4.2 prescribes a **private** bucket fronted by CloudFront with Origin Access Control. These are incompatible: with a private bucket the direct URL returns `403`, so product images and invoices will fail to load in production. **This must be resolved before go-live** — either add a `CLOUDFRONT_DOMAIN`/custom-domain builder, or serve media through signed URLs (which the service already generates for downloads at `s3.service.ts:416`).
- **S3 Block Public Access**, bucket policy, and CORS not verifiable.
- **RDS:** public accessibility flag, security-group ingress, automated backups, encryption at rest, and `performance_insights` not verifiable.
- **IAM:** whether the deployment uses short-lived instance/task roles or still requires static `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`.
- **Secrets Manager / Parameter Store** usage and rotation.
- **TLS** termination and certificate validity.
- **CloudWatch** log retention and alerting.
- **Razorpay:** live webhook delivery was not tested; HMAC verification is covered by mocked unit tests only.

`backend/AWS_DEPLOYMENT.md` documents the hardened state (private S3 / OAC /
least-privilege IAM — originally in `AWS_DEPLOYMENT_GUIDE.md`, which was merged
into it and deleted).

---

## 7. Prioritized action list

**Before go-live**

1. **Resolve the S3 URL mismatch** — implement a CloudFront/custom-domain URL builder, or serve media via signed URLs (§6). Product images and invoices are broken until this is done.
2. **Set `TRUST_PROXY` in every deployed environment** — H-7 made this mandatory; production now refuses to boot without it. `1` behind a single ALB, `false` if directly exposed. Also update the ECS/Task Definition and any `.env` template in the deployment pipeline, not just `.env.example`.
3. **Provision a disposable test database** and set `TEST_DATABASE_URL`; run the integration suite (§6). The `TRUST_PROXY`, order-state-machine, gateway-amount and admin-login fixes are all typechecked but not yet exercised end-to-end.
4. **Audit `system_settings` for credentials written before H-6.** The read path now suppresses them, but the rows still exist. Query for keys matching the patterns in `backend/src/utils/secret-keys.ts`, then rotate every credential found and migrate it to Secrets Manager.
5. **Rotate anything that touched the old secrets** — the seeded admin password, the published Razorpay test key pair, and the placeholder JWT/encryption keys must all be considered compromised. Rotate the JWT signing key (invalidates all sessions) and re-encrypt stored secrets with the new encryption key.
6. **Rotate the Supabase database password** if the committed configuration ever contained it.
7. **Fix `database/seed.ts` null guard** — `adminUser!.id` is dereferenced by an unconditional `userRole.upsert`. If `SEED_ADMIN_PASSWORD` is unset, `adminUser` is `null` and **the seed crashes at runtime**. It typechecks because of the non-null assertion, so the build does not catch it.
8. **Verify the staff-management matrix against real roles** — C-5 is unit-tested, but confirm your seed data contains no `ADMIN` accounts that a `STAFF` operator legitimately needs to manage. The rank rule forbids an admin editing a peer admin; if your operating model requires that, it needs an explicit delegated-scope concept rather than a relaxed check.

**Next sprint**

9. **Reconcile the Razorpay credential source of truth** — `payment-settings.controller.ts` stores encrypted key/webhook secrets that `razorpay.service.ts` never reads; it uses `env` exclusively. An operator rotating the key through the admin UI gets "updated" and no change. Either load `PaymentSettings` at request time or remove the credential fields from the UI so it cannot claim to manage them.
10. Strip realistic PII-shaped fixtures from `admin/src/services/adminStore.ts` (§5).
11. Set CORS `credentials: false` (L-2).
12. Document `SEED_*` variables in `.env.example` and the deployment guide.
13. Add structured security alerting on repeated `401`/`403` spikes, webhook signature failures, and `PAYMENT_GATEWAY_*_MISMATCH` audit events — the last of these is the canary for a partial capture reaching production.
14. Review `backend/.env` handling so production secrets are never sourced from a file in the repository tree.

**Deliberately not changed**

- **Guest cart `sessionToken` is still an unbounded, unvalidated bearer token** read from a header, query string or body, and echoed back. It is accepted as an opaque key with server-side ownership checks, so it is an identifier rather than a credential, but it should be length-bounded and server-generated. The query-string form also lands it in ALB access logs.
- **No per-account brute-force throttle.** All limits are IP-based. Once H-7 is fixed the IP is genuine, but a distributed attacker has no per-credential limit.

---

## 8. Files changed

Security-relevant files touched during this audit:

```
backend/src/app.ts                                  global middleware, CORS, headers, body parsing
backend/src/config/env.ts                           production fail-fast, placeholder rejection
backend/src/config/logger.ts                        Pino redaction expansion
backend/src/utils/api-response.ts                   sendControllerError
backend/src/utils/raw-body.ts                       NEW — exact webhook byte capture
backend/src/middleware/auth.middleware.ts            bearer-only auth, HS256 pin, tokenType
backend/src/middleware/logging.middleware.ts        query-string stripping
backend/src/middleware/error.middleware.ts          production detail suppression
backend/src/middleware/not-found.middleware.ts      sanitized 404
backend/src/middleware/rate-limiter.middleware.ts   auth/reset/verification limiters
backend/src/routes/auth.routes.ts                   limiter wiring
backend/src/routes/payment.routes.ts                raw-body middleware removal
backend/src/routes/order.routes.ts                  optionalAuth on checkout, protected mutations
backend/src/routes/invoice.routes.ts                global authenticate
backend/src/routes/reconciliation.routes.ts        reports.read
backend/src/routes/admin.routes.ts                  reports.read, customers.read
backend/src/controllers/payment.controller.ts      webhook error handling
backend/src/controllers/order.controller.ts         payment verification delegation, guest identity
backend/src/controllers/invoice.controller.ts       ownership scoping
backend/src/controllers/payment-settings.controller.ts  no auto-provision, actor, idempotent secrets
backend/src/controllers/auth.controller.ts          production-only token exposure
backend/src/services/auth.service.ts                 HS256 signing, timingSafeEqual, token types
backend/src/services/product.service.ts             s3Key product binding, imageUrl rejection
backend/src/services/invoice.service.ts             PDF upload path
backend/src/integrations/aws/s3/s3.service.ts       magic bytes, verifyUploadedObject, uploadDocument
backend/src/integrations/razorpay/razorpay.service.ts  raw-byte HMAC, server-side verification
backend/tests/integration/_safety.ts                NEW — production DB guard
backend/tests/integration/*.test.ts (13 files)      safety guard import
backend/tests/unit/hardened-boundaries.test.ts      NEW — 45 security regression tests
backend/docker-compose.yml                          secrets, loopback, read-only fs
backend/AWS_DEPLOYMENT.md                        private S3 / OAC / least-privilege IAM (content ported from AWS_DEPLOYMENT_GUIDE.md)
admin/src/pages/admin/AdminPaymentSettingsPage.tsx  password-type secret inputs
database/seed.ts                                    env-driven credentials
database/encryption.ts                              key validation
.gitignore                                         .env and secret-bearing files
```

### Second pass

```
backend/src/utils/privilege.ts                     NEW — rank-based staff authority model (C-5, M-10)
backend/src/utils/secret-keys.ts                   NEW — pattern-based secret detection (H-6)
backend/src/utils/client-ip.ts                     NEW — proxy-aware getClientIp (H-7)
backend/src/utils/pagination.ts                    NEW — page-size clamping (M-12)
backend/src/utils/order-status.ts                  NEW — transition matrix + restock rules (M-11)
backend/src/utils/support-context.ts               getClientIp delegates to the shared helper
backend/src/utils/raw-body.ts                      Buffer retained end-to-end (M-13)
backend/src/config/env.ts                          TRUST_PROXY, production fail-fast, resolveTrustProxy
backend/src/app.ts                                 trust proxy from configuration
backend/src/middleware/auth.middleware.ts           account lifecycle enforcement, requireRole masking
backend/src/services/auth.service.ts                lifecycle state in resolveUserPermissions,
                                                   assertAccountCanAuthenticate, changePassword
backend/src/services/audit.service.ts               getClientIp for audit attribution
backend/src/types/auth.types.ts                    changePasswordSchema
backend/src/routes/auth.routes.ts                  PUT /auth/change-password
backend/src/controllers/auth.controller.ts          changePassword handler
backend/src/controllers/staff.controller.ts         assertCanManageStaffAccount on all 5 mutations,
                                                   sendControllerError, clamped pagination
backend/src/controllers/settings.controller.ts      pattern-based detection + public-read suppression
backend/src/controllers/order.controller.ts          status validation, 409 on illegal transition
backend/src/controllers/inventory.controller.ts     clamped pagination
backend/src/controllers/admin.controller.ts         clamped pagination
backend/src/controllers/discount.controller.ts      clamped pagination
backend/src/integrations/razorpay/razorpay.service.ts  gateway amount/currency cross-check,
                                                   captured-state terminal guard, Buffer HMAC
backend/.env.example                               TRUST_PROXY documented
backend/tests/unit/security-second-pass.test.ts    NEW — 51 second-pass regression tests
backend/tests/unit/hardened-boundaries.test.ts     raw-body contract updated for Buffer
admin/src/services/adminAuthService.ts             real API auth, DEMO_PASSWORD and isOwner removed
admin/src/pages/admin/AdminLoginPage.tsx           demo credential panel and prefill removed
```
