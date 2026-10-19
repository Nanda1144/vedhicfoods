# Production Readiness Report — Vedhic Foods

Date: 2026-10-19 · Repo HEAD `0aa1c1a` (working tree has uncommitted env/style/doc changes).

## Method and scope (read this first)

This assessment is a **static, evidence-based audit** of the source and the AWS
Infrastructure-as-Code, plus the automated test suites that can run without
external services.

It is **not** a live test. The following could not be executed here and must be
run in a real environment:

- Clicking through the storefront in Chrome/Edge/Firefox/Safari.
- A live order against a real Postgres, Redis, Razorpay account, S3 bucket and
  SES identity.
- Any AWS API call (no credentials; no AWS account access).
- `prisma migrate`/integration suites (no disposable database available).

Anything marked **VERIFIED (code/tests)** is backed by a file:line reference.
Anything marked **LIVE-ONLY** requires the real environment. Test names are
listed even when they were skipped locally (they need Postgres).

---

## 1. End-to-end trace: Frontend → API → DB → Razorpay → Webhook → Inventory → Invoice → SES → Customer

| # | Step | Entry point (file:line) | Persistence / effect |
|---|---|---|---|
| 1 | Open website / browse | `frontend/src/services/http.ts` → `GET /products` | `product.service.ts:145` `listProducts` |
| 2 | Search product | `frontend/src/components/layout/SearchOverlay.tsx:61` | `product.service.ts:341` `searchProductsRanked` |
| 3 | Open product | `product.service.ts:434` `getProduct` | read-only |
| 4 | Add to cart | `frontend/src/services/cartService.ts` → `cart.routes.ts:11` | `cart.service.ts:163` `addItem` |
| 5 | Review cart / qty | `cart.service.ts:358` `updateItemQuantity` | `carts` rows |
| 6 | Checkout (guest) | `order.routes.ts:20` → `order.controller.ts:36` | — |
| 7 | Checkout core | `checkout.service.ts:33` `processCheckout` | idempotency probe `:47`; ownership `:72` |
| 8 | Reserve stock | `checkout.service.ts:279` `reserveStock` | `inventory.service.ts` (row locks, `FOR UPDATE`) |
| 9 | Create order | `checkout.service.ts` (order + items, `$transaction`) | P2002 replay recovery `:463` |
| 10 | Create Razorpay order | `payment.routes.ts:41` | `razorpay.client.ts` |
| 11 | Customer pays | Razorpay Checkout (client) | external |
| 12 | Verify payment | `payment.routes.ts:60` → `razorpay.service.ts:497` `verifyAndConfirmPayment` | ownership `:527`, replay `:536`, dup id `:553`, HMAC `:566`, amount `:610` |
| 13 | Webhook (authoritative) | `payment.routes.ts:26` (raw body, `raw-body.ts:19`) → `razorpay.service.ts:752` `processWebhookEvent` | verify `:760`, dispatch `:783` |
| 14 | Confirm capture | `razorpay.service.ts:809` `handlePaymentCaptured` | idempotent `:832`, amount check `:851` |
| 15 | Deduct inventory | `inventory.service.ts:733` `confirmDeduction` | `soldQuantity` increment (see DEFECT A1) |
| 16 | Generate invoice | `invoice.service.ts:151` `createInvoiceForOrder` | S3 upload `:191`, row `:204` (see DEFECT A2/A3) |
| 17 | Send invoice email | `invoice-email.service.ts:96,127` → `email.service.ts` | dedupe key; best-effort |
| 18 | Order confirmation email | `order-email.service.ts:135` `paymentConfirmed` | dedupe key |
| 19 | Update delivery | `delivery.routes.ts` → `delivery.service.ts` state machine | per-phase dedupe `:643` |
| 20 | Customer views status | `order.controller.ts` / storefront order page | read-only |

## 2. Failure-scenario coverage

| Scenario | Handling | Test |
|---|---|---|
| Duplicate checkout | Idempotency key; replay returns existing order + `X-Idempotent-Replay` (`checkout.service.ts:38,81`) | `integration/audit-logging.test.ts:289`; `full-customer-e2e-trace.test.ts` |
| Duplicate webhook | Idempotent capture (`razorpay.service.ts:832`) | `integration/payment-razorpay-webhook.test.ts` |
| Payment failure | Order → `PAYMENT_FAILED`, reservation released | `payment-razorpay-webhook.test.ts` |
| Payment cancellation | Reservation release on cancel | `inventory-extended.test.ts` |
| Insufficient stock | Checkout rejected before order | `integration/admin-order-management.test.ts:663` |
| Invalid coupon | Validated in checkout | `discount-extended.test.ts:491`, `discount-security-concurrency.test.ts` |
| Network failure / timeout | Typed `ServiceError` + user messages (`frontend/src/services/http.ts`) | manual |
| Inventory rollback | Multi-item atomic; restock guarded | `inventory-extended.test.ts` |
| Email failure (SES down) | Best-effort, deduped, ticket still saved | `email-delivery.test.ts:371`, `checkout-order-extended.test.ts:496` |
| Invoice generation failure | Best-effort catch — **no retry** | **none (gap)** |

## 3. Defects found (ranked)

### A. Application

**A1 — Medium — `confirmDeduction` is not idempotent**
`backend/src/services/inventory.service.ts:754,757`: `deductQty = min(reserved, qty)` but
`newSold = prevSold + qty` unconditionally. A second call (reserved already drained)
increments `soldQuantity` again. Phone-charged risk is mitigated because callers gate on
payment status (`razorpay.service.ts:832`), but the primitive is unsafe if reused.

**A2 — Medium — Invoice creation is not atomic and has no retry**
`invoice.service.ts:191` uploads the PDF to S3 **before** creating the invoice row at
`:204`, outside a transaction. If PDF/S3 fails, the paid order has **no invoice and no
automatic retry** (caught as best-effort at `:237-239`). No test covers this path.

**A3 — Medium — Invoice-number race**
`invoice.service.ts:84-103` generates the number with a read-then-increment and no lock;
the existence check `:165` and create `:204` are not in a transaction. Two concurrent
captures can compute the same number; the loser hits the unique constraint with no retry.

**A4 — Low — Legacy SHA-256 password fallback still active**
`auth.service.ts:95` verifies a legacy SHA-256 hash and upgrades to bcrypt on next login
(`:527-534`). Acceptable transitionally; remove once all rows are migrated.

**A5 — Low — Pino redaction is single-level**
`backend/src/config/logger.ts:22-58`: wildcards like `*.password` do not match a
top-level `password`. Current call sites nest, so no active leak.

### B. Infrastructure — go-live blockers

**B1 — HIGH — S3 hardening absent from IaC.** No `AWS::S3::Bucket`, public-access block,
encryption, versioning, lifecycle, bucket policy or CloudFront/OAC anywhere under
`backend/infra` (only `s3-cors.json`). The app points at `cdn.vedhicfoods.com`
(`AWS_S3_PUBLIC_BASE_URL`) plus `buildPublicUrl()` emitting raw S3 URLs, but no
distribution is defined.

**B2 — HIGH — `log_temp_files_limit` is not a valid RDS parameter.**
`vedhicfoods-database.yaml:291` (and `log_temp_files` already set at `:288`). RDS rejects
unknown parameters, so the database stack will fail to create/update.

**B3 — HIGH — No ECS service, circuit breaker, or auto-rollback in IaC.**
No `AWS::ECS::Service`/`ApplicationAutoScaling` in the repo; `deploy.yml` smoke-test
failure aborts but does **not** roll back (`PRODUCTION_RUNBOOK.md:450-490` — manual).

**B4 — HIGH — No SES bounce/complaint alarms.** `vedhicfoods-ses.yaml:28-30` depends on
them; `vedhicfoods-monitoring.yaml` has none.

**B5 — HIGH — No SNS subscription of the SES events topic to
`/api/v1/webhooks/email/sns` in IaC.** Suppression-list maintenance depends on a
manually-created subscription.

**B6 — MEDIUM — Monitoring ALB/TG names are hardcoded guesses** (`monitoring:66,73`);
they will not match CloudFormation-generated physical names, so alarms fail **silently**.

**B7 — MEDIUM — Server-side TLS not enforced** (no `rds.force_ssl` in the parameter group).

**B8 — MEDIUM — `stopTimeout` never set** on the task definition (docs assume 60s; ECS
default is 30s). `SHUTDOWN_GRACE_MS=25000` still fits.

**B9 — MEDIUM — OIDC deploy/backup role trust + permissions exist only as prose**
(`README.md:64-98`, `db-backup.yml:23-47`), broad/vague; no IaC.

**B10 — MEDIUM — `ExecutionRole` lacks `kms:Decrypt`** (`iam-policies.json:29-36`); a
CMK-encrypted injected secret (e.g. the RDS-managed master secret) will fail to resolve.

**B11 — MEDIUM — Suspicious CFN construct:** `vedhicfoods-edge.yaml:293-296` puts
`!Ref 'AWS::NoValue'` as a **list element** in `LoadBalancer.SecurityGroups`. Should be
`[!Ref LoadBalancerSecurityGroup]`. Likely fails validation or yields an empty SG entry.

**B12 — LOW — App CloudWatch log group is script-only** (not CloudFormation);
`README.md:22` misdescribes `monitoring.yaml`. No dashboard. Alarm topic has no default
subscriber and no encryption.

## 4. Password and secret storage (explicit verification)

- **All passwords are hashed with bcrypt, cost 12** (`auth.service.ts:20,78,91`). Staff
  create/reset reuse it (`staff.controller.ts:278,865`). Guest accounts use a real bcrypt
  hash over 32 random bytes, not a sentinel string (`order.controller.ts:253`). Seed reads
  passwords from env and hashes with bcrypt (`database/seed.ts:309,345`). **No plaintext
  password is stored or returned.** (Only A4 legacy fallback remains.)
- **Stored gateway credentials are encrypted at rest** with AES-256-GCM, random IV per
  record, auth tag verified (`database/encryption.ts:64,81`); the committed default key is
  rejected in production/staging (`:26-50`).
- **Secrets are never committed** in the audited infra files (`ecs-task-definition.json`
  carries ARNs only; `create-secrets.ps1` never writes values to argv/stdout).

## 5. AWS service readiness

| Service | Status | Notes |
|---|---|---|
| RDS | **PARTIAL** | Multi-AZ, KMS encryption, 35-day backups, PITR, deletion protection, final snapshot, private subnets, SG-scoped — all PASS. Blocked by B2; add `rds.force_ssl` (B7). |
| S3 | **MISSING** | Only CORS. See B1. |
| SES | **PARTIAL** | Domain identity + DKIM + config set + bounce/complaint→SNS PASS. Missing IaC SNS subscription (B5) and reputation alarms (B4). |
| Compute (ECS) | **PARTIAL** | Task def valid (secrets via `valueFrom`, logs, healthchecks). No service/desired-count/autoscaling/circuit-breaker (B3, B8). |
| Secrets Manager / SSM | **PARTIAL** | 7 secrets stored; RDS master rotates; app secrets have no rotation (B10 for CMK decrypt). |
| CloudWatch | **PARTIAL** | 5xx/latency/CPU/DB-connection alarms PASS. Log group script-only, no dashboard, name guesses (B6, B12). |
| IAM | **PARTIAL** | Execution vs task role separated; only ECR uses `"*"` (unavoidable). Missing `kms:Decrypt` (B10); OIDC roles undocumented in IaC (B9). |
| ACM / HTTPS | **PASS (verify)** | DNS-validated cert, 80→443 `HTTP_301`, TLS-1.3 policy, HSTS. Verify B11. |
| DNS | **PASS (by design)** | Required `HostedZoneId`, A-alias to ALB. Apex/admin/CDN records are external. |

## 6. Least privilege / unauthorized-operation check

- Grep of `backend/infra` for wildcard resources found only ECR pull actions (which
  require `"*"`) and an explicit `Deny` on `secretsmanager` in the task role — no
  over-broad action on data resources. **VERIFIED (code).**
- Attempting real unauthorized AWS calls is **LIVE-ONLY** (no credentials here).
- The app also gates on roles/permissions server-side (`middleware/auth.middleware.ts`,
  `utils/privilege.ts`) with an RBAC matrix test (`integration/rbac-matrix.test.ts`, 270
  cases, skipped locally).

## 7. Restart, rollback, and environment hygiene

- **Restart:** `bootstrap.ts` loads Secrets Manager then `server.ts`; production exits if
  the DB is not ready (`server.ts:19-23`); graceful shutdown bounded by
  `SHUTDOWN_GRACE_MS`; `/health` liveness and `/health/ready` (503 when unhealthy)
  separate, so the ALB drains correctly. **VERIFIED (code).**
- **Rollback:** immutable SHA image tag + image-verified registration PASS; **no
  automated service rollback** (B3).
- **No production dependency points at localhost.** Every `localhost` fallback is behind a
  production guard: `frontend/src/services/http.ts:27-54`, `admin/src/services/http.ts:73`,
  `frontend/vite.config.ts:25-78`, `admin/vite.config.ts:22-73`, `backend/src/app.ts:32-49`,
  `backend/src/config/env.ts:125-126,354-368`.
- **No development credentials in production.** Only CI carries literal throwaway seed
  passwords for a runner-local Postgres (`ci.yml:179-180`) — not production. Real `.env`
  files are untracked.

## 8. Go / No-Go

**NO-GO until the HIGH items are resolved:** B1, B2, B3, B4, B5 (infra) and a decision on
A2/A3 (a paid order can end without an invoice).

## 9. What must be verified live

1. `aws cloudformation validate-template` / deploy for all four templates (B2, B11).
2. One real order end-to-end: card success, failure, cancellation; confirm single order /
   payment / deduction / invoice in RDS.
3. Restore drill: RDS snapshot → point-in-time restore into a scratch instance.
4. S3 presigned `PUT`/`GET` from the admin origin against the real bucket + CDN.
5. SES live send + bounce/complaint reaching `/api/v1/webhooks/email/sns`; alarm fires.
6. Effective IAM for the OIDC deploy/backup roles (no over-broad grants; `iam:PassRole`
   scoped).
7. ECS task start with CMK-encrypted secrets injected (proves B10).
8. Rollback drill: deploy a bad image, confirm circuit-breaker auto-rollback.
9. Browser matrix (Chrome/Edge/Firefox/Safari, desktop + mobile) for the flows in §1.
