# Vedhic Foods — Final Pre-Deployment Verification & Production Readiness

Date: 2026-10-19
Auditor role: DevOps / Full-Stack / QA / DB / AppSec / AWS (combined)
Repo: `C:\nanda\freelances\vedhifoods` · branch `monorepo-restructure` · HEAD `0aa1c1a` (large uncommitted worktree)

Status legend: **PASS** = verified with evidence below · **FAIL** = reproducible defect · **BLOCKED** = needs an external system/credential not available here · **NOT TESTED** = not exercised (recorded honestly, never assumed).

> This is a static + automated-test audit plus a live run of the backend integration/e2e suites against a disposable local PostgreSQL 18. It is **not** a live AWS/Razorpay/SES/browser test; everything that needs those is marked BLOCKED/NOT TESTED. No secret values are printed.

---

## 1. Executive summary

- The application code is in good shape: backend build, frontend/admin production builds, TypeScript checks, lint, and the whole automated matrix pass locally on a real database — **backend integration 1364/1367 passed (3 skipped), backend unit 232, api-e2e 2, frontend 20, admin 116**, Prisma schema valid, 23 migrations applied, **zero schema drift**.
- The security-critical money/email/DB paths were re-verified in code: Razorpay HMAC verification (`timingSafeEqual`), server-side amount check + idempotent capture, invoice creation is now row-first with P2002 retry/race-collapse, inventory has non-negative DB checks, RBAC is enforced server-side for every admin route, and the error handler does not leak stacks in production.
- **Production is still blocked** by infrastructure and external-dependency items, not by application logic:
  1. **Infra-as-code is incomplete** — no `AWS::S3::Bucket`, no `AWS::CloudFront`, no `AWS::ECS::Service`/autoscaling, and no `SNS→/webhooks/email/sns` subscription in any template. These are treated as manually pre-created prerequisites (see `backend/infra/README.md`), so they are undocumented drift risks and unverifiable here.
  2. **Two conflicting deployment stories**: `backend/infra/*` (ECS Fargate + RDS + ALB) vs `docs/DEPLOYMENT_ENV.md` (Vercel + Render). The real target must be confirmed before a deploy plan is final.
  3. **Live external verification is impossible here** (no AWS account, no Razorpay/SES keys, no browser automation): live payments, SES deliverability, S3 round-trip, ECS deploy/rollback, and the 320→1920px browser matrix are BLOCKED/NOT TESTED.
- Dependency audit reports 6 advisories (2 critical, 3 high, 1 moderate) — **all in dev/test tooling** (`vitest`, `tinypool`, `@vitest/mocker`, `prisma`, `@prisma/config`, `deepmerge-ts`), i.e. not shipped in the runtime bundle, but should be upgraded.

**Verdict: NOT READY (for production).** Core app = ready for a **staging** dress-rehearsal the moment a staging DB + external sandboxes exist; production remains gated on the infra/external items in §15.

---

## 2. Frontend verification

| Check | Status | Evidence |
|---|---|---|
| All customer routes exist | PASS | `frontend/src/routes/index.tsx:49-65` — `/`, `/about`, `/shop`, `/categories`, `/product/:slug`, `/cart`, `/checkout`, `/order-success/:orderNumber`, `/invoice/:id`, `/invoice/order/:orderNumber`, `/contact`, `/faq`, `/support`, `/privacy`, `/terms`, `/refund-policy` (return policy), `*`→NotFound |
| Lazy loading + SEO titles | PASS | `routes/index.tsx:13-34` (`lazyNamed` + `titled`/`RoutePage`) |
| 404 + error boundary | PASS | `routes/index.tsx:65`; `errorElement` `routes/index.tsx:47`; class boundary `components/common/ErrorBoundary.tsx:21` mounted `App.tsx:8` |
| API base URL from env, no secret bundled | PASS | `services/http.ts:28,54`; only `VITE_API_URL`/`VITE_HERO_IMAGES` (public). No `VITE_*_SECRET/KEY/TOKEN` anywhere |
| Auth token handling | PASS | in-memory access token `services/tokenStore.ts`; refresh via HttpOnly cookie; `http.ts:253-261,293-302` |
| Real payment flow (no fabricated success) | PASS | `frontend/src/components/checkout/PaymentGateway.tsx:12-28` (used `CheckoutPage.tsx:332`) |
| Dev localhost fallback guarded out of prod | PASS | `frontend/src/services/http.ts:30,54` behind `import.meta.env.PROD`; build guard `frontend/vite.config.ts:78` |
| Data comes from backend (fallbacks removed) | PASS/FAIL | Real fetching present; but dead config remains: `VITE_ENABLE_PRODUCT_FALLBACK`/`VITE_ENABLE_SETTINGS_FALLBACK` are declared (`frontend/.env.production:30-31`) yet referenced **nowhere** in `src/` (dead) — Low |
| Route auth guard on `/checkout` | NOT TESTED | No `RequireAuth` wrapper; guest checkout is intended (`order.routes.ts:20-21` `optionalAuth`), so this is by design — confirm product intent |
| Visual/viewport matrix 320–1920, console errors, no overflow, mobile bottom nav, images | NOT TESTED (BLOCKED) | No browser automation in repo (no Playwright/Cypress). Requires manual/CI browser run — see §15 |

Production build: **PASS** — `npm run build --prefix frontend` → `✓ built in 4.79s` (largest chunk `react` 312.87 kB / gzip 98.81 kB).

---

## 3. Admin verification

| Check | Status | Evidence |
|---|---|---|
| Admin routes + per-route permission | PASS | `admin/src/routes/index.tsx:69-103` — products/inventory/orders/customers/delivery/invoices/discounts/promotions/support/staff/permissions/audit-logs/settings/payment-settings/content/theme/hero |
| Login / invalid creds / logout | PASS (unit) | admin unit suite 116 passed; `adminAuthService`, `AdminLoginPage.tsx:12-17` (form starts empty) |
| Unauthenticated redirect | PASS | `components/admin/RouteGuard.tsx:17-18` + `AdminLayout.tsx:144-146` → `/admin/login` |
| Missing permission → 403 panel (no redirect) | PASS | `RouteGuard.tsx:20-36` via `can()` |
| Client-side `can()` is UX only | PASS | `adminAuthService.ts:313-316`; server enforces separately (§5) |
| Session expiry handling | PASS | `AdminAuthContext.tsx:52-65,89-120` (validates `GET /admin/auth/me`, expiry events) |
| Orphaned simulated payment component | FAIL (Low, dead code) | `admin/src/components/checkout/PaymentGateway.tsx:6-10,40-55,133` (setTimeout + `Math.random()<0.15` failure). Only re-exported (`components/checkout/index.ts:4`); **no page imports it** → dead, not user-reachable |
| Live admin CRUD persistence → storefront | NOT TESTED (BLOCKED) | Covered by backend integration (`admin-storefront-consistency.test.ts` PASS); no live admin UI session run |

Production build: **PASS** — `npm run build --prefix admin` → `✓ built in 2.92s`.

---

## 4. Staff and RBAC verification

| Check | Status | Evidence |
|---|---|---|
| Auth verifies JWT (HS256 pinned) + token type | PASS | `middleware/auth.middleware.ts:45-50,63-66` |
| `req.user` + permissions resolved per request | PASS | `auth.middleware.ts:69-89` → `AuthService.resolveUserPermissions` (`services/auth.service.ts:231`) |
| `requireRole` / `requirePermission` | PASS | `auth.middleware.ts:162-189`, `:202-239` (OWNER+ADMIN bypass slug checks; CUSTOMER/STAFF enforced) |
| Every admin route has an auth + permission gate | PASS | admin router-wide `authenticate`+`requireRole(OWNER,ADMIN,STAFF)` (`routes/admin.routes.ts:55-56`); each sub-router adds `authenticate` + slugs (`staff|inventory|delivery|staff-support|report|settings|discount` routers) |
| Owner-scoped resources (IDOR) | PASS (code+test) | `requireResourceOwnership` `auth.middleware.ts:250-276`; customer isolation `order.controller.ts:1155-1167`; tests `rbac-matrix.test.ts`, `auth-rbac.test.ts`, `database-security-integrity.test.ts` PASS |
| Staff escalation guards | PASS | `utils/privilege.ts:12-17`, `assertCanManageStaffAccount:72`, `assertCanAssignPermissions:137` |
| One sub-router lacks its own `authenticate` | PASS w/ nuance | `routes/content.routes.ts` admin sub-router relies on the parent guard (`admin.routes.ts:55-56`) — still protected, single-point dependency (Low) |
| Live "hit restricted URL with a token" probe | PASS (integration) | RBAC matrix regression passed in the full run; live deployed probe BLOCKED |

RBAC matrix + auth suites ran as part of the 1364-passing integration run — **PASS**.

---

## 5. Backend verification

| Check | Status | Evidence |
|---|---|---|
| Production build (`tsc`) | PASS | `npm run build:backend` clean |
| Health liveness/readiness | PASS | `GET /api/v1/health`, `/health/ready` (`routes/health.routes.ts:6-7`; 503 when unhealthy `health.controller.ts:18-19`) |
| Request validation | PASS w/ gaps | zod on auth/checkout/payments/products/categories/discounts/delivery/inventory/staff/settings/support/content. Manual (unvalidated) on **cart mutations**, admin payment-settings, admin refund, admin order-status, staff reset-password, coupon/promotion status, invoice cancel/regenerate — Low/Med |
| Global error handler hides internals in prod | PASS | `middleware/error.middleware.ts:139-149` (generic message, stack only when `!isProduction`); `utils/api-response.ts:97-101` |
| Rate limiting | PASS | global 1000/15m (`app.ts:183`); per-route `middleware/rate-limiter.middleware.ts:288-419`; Redis-backed & **fail-closed in prod** (`:196-212`) |
| CORS allowlist + admin-origin gate | PASS | `app.ts:32-53,108-161`; prod rejects `*`/http/loopback (`config/env.ts:360-405`) |
| Logging (no secrets) | PASS | pino; `config/logger.ts:22-58` redaction (single-level — Low); only 5 `console.error`, all in `config/env.ts` |
| Graceful startup/shutdown | PASS | `server.ts` exits if DB not ready; bounded by `SHUTDOWN_GRACE_MS`; workers stopped before disconnect |
| Background workers (new) | PASS | `EmailOutboxWorker`, `ReservationSweepService` started/stopped in `server.ts`; env-gated (`EMAIL_OUTBOX_ENABLED`, `RESERVATION_SWEEP_ENABLED`) |
| Malformed input → 4xx not 5xx | PASS | zod + AppError mapping (`error.middleware.ts:32-124`) |
| External-service failure handling | PASS (code) | best-effort email/invoice catch + typed errors (`utils/api-response.ts:66-119`); live failure injection NOT TESTED |
| API e2e (Helmet headers + CORS preflight) | PASS | `tests/e2e/api.e2e.test.ts` 2/2 passed |

Backend **integration suite: PASS — 52 files, 1364 passed, 3 skipped, 0 failed** (373s, local PG18).
Backend **unit: PASS — 232**.

---

## 6. Database verification

| Check | Status | Evidence |
|---|---|---|
| Prisma schema valid | PASS | `prisma validate` → "The schema … is valid 🚀" |
| Migration history applied & current | PASS | `prisma migrate status` → "23 migrations found / Database schema is up to date!" |
| Zero schema drift (migrations ↔ datamodel) | PASS | `prisma migrate diff` → **"No difference detected."** |
| Non-negative commerce constraints | PASS | migration `20261018000000_add_commerce_nonnegative_checks`; `database-security-integrity.test.ts` PASS |
| Ownership/FK integrity | PASS | migrations `2026..._enforce_commerce_ownership_and_order_links`, `_support_message_sender_fk`; preflight orphan checks |
| Product image single-primary + S3 key unique | PASS | migrations `20261018000001`, `20261020000000` |
| Passwords hashed | PASS | bcrypt cost 12 (`auth.service.ts:20,78,91`); seed reads env + hashes (`database/seed.ts:288-308,343-345`); no plaintext stored/returned |
| Secrets encrypted at rest | PASS | AES-256-GCM `database/encryption.ts:64,81`; committed default key rejected in prod/staging (`:26-51`) |
| Migration against production | NOT RUN (by instruction) | No production DB contacted; procedure in §19/§20 |
| Backup before migration | BLOCKED | Requires live RDS; workflow in §18 |

Disposable DB: `vedhicfoods_itest_20261019` on local `localhost:5432` (PG18). No destructive ops run against any non-disposable DB.

---

## 7. Razorpay payment verification

| Check | Status | Evidence |
|---|---|---|
| Webhook HMAC (sha256, constant-time) | PASS | `integrations/razorpay/razorpay.service.ts:102,118,141,156` (`crypto.timingSafeEqual`) |
| Missing signature → 400 | PASS | `controllers/payment.controller.ts:125-129` |
| Raw-body preserved for signature | PASS | `payment.routes.ts:26` + raw-body capture |
| Server verifies amount + captures idempotently | PASS | `razorpay.service.ts` verify/capture with amount check + idempotent capture; tests `payment-razorpay-webhook.test.ts`, `payment-razorpay-verify.test.ts`, `payment-razorpay.test.ts`, `order-lifecycle-payments.test.ts` PASS |
| Frontend cannot mark order paid | PASS | server-side confirm only; `payment.controller.ts:83` verify flow |
| Duplicate webhook cannot double order/inventory/invoice/email | PASS | idempotent capture + invoice unique `orderId` collapse (§10) + email dedupe |
| Live test-credential charge flow | NOT TESTED (BLOCKED) | `payment-razorpay-live.test.ts` is skipped without live keys; no account here |
| Production keys/webhook secret handled securely | PASS (design) | secrets via env/Secrets Manager; `env.ts:296-354` refuses placeholder secrets in prod |

---

## 8. Amazon S3 verification

| Check | Status | Evidence |
|---|---|---|
| Upload path + validation | PASS (code+test) | `integrations/aws/s3/s3.service.ts`; suites `product-image-workflow.test.ts`, `product-category-s3.test.ts`, `product-workflow.test.ts` PASS |
| Signed upload/download | PASS (code) | presign via `@aws-sdk/s3-request-presigner`; `s3.service.ts:306-309,439-441` |
| Simulation only in non-production | PASS | `s3.service.ts:263,306,357,439` gated `env.NODE_ENV !== 'production'` |
| Bucket policy / encryption / versioning / CloudFront(OAC) in IaC | **FAIL** | No `AWS::S3::Bucket`/`AWS::CloudFront` in any template (repo-wide grep = 0). Only `backend/infra/s3-cors.json`. Bucket/CDN assumed pre-created manually (`infra/README.md:15`) — **HIGH** |
| No public exposure of private files | BLOCKED | Cannot verify live bucket ACL/policy here |
| Live presigned PUT/GET round-trip | NOT TESTED (BLOCKED) | no bucket/credentials |

---

## 9. Amazon SES verification

| Check | Status | Evidence |
|---|---|---|
| Provider integration + simulation gated | PASS | `integrations/ses/ses.service.ts:107-108,129-131,221` (simulate only dev/test); `email.service.ts` outbox path |
| Transactional emails (order/payment/invoice/delivery/password) | PASS (code+test) | `order-email.service.ts`, `invoice-email.service.ts`, `email.service.ts`; suites `email-delivery.test.ts`, `email-suppression.test.ts`, `email-outbox.test.ts` PASS |
| Suppression handling | PASS (code) | `webhooks/email/sns` handler maintains suppression list |
| SES domain identity/DKIM/config set → SNS | PASS (IaC) | `vedhicfoods-ses.yaml` (identity/DKIM/config set; 17 matches) |
| SNS topic → `/api/v1/webhooks/email/sns` subscription | **FAIL** | Only SNS subscription found is the alarm email (`vedhicfoods-monitoring.yaml:196-197`). No HTTPS subscription to the webhook in IaC (`ses.yaml:98` describes it, doesn't define it) — **HIGH** |
| SES bounce/complaint reputation alarms | **FAIL/PARTIAL** | No explicit Bounce/ComplaintRate reputation alarms found in monitoring template — High |
| Buyer/sender production sending access | BLOCKED | Account-level; cannot verify |
| Live send + bounce reaching the webhook; alarms fire | NOT TESTED (BLOCKED) | no SES/SNS access |

---

## 10. Invoice verification

| Check | Status | Evidence |
|---|---|---|
| Unique invoice numbers | PASS | `services/invoice.service.ts:84-103` generate + `invoiceNumber` unique; tests `invoice-workflow.test.ts` PASS |
| Row-first, PDF archival best-effort (no paid order without invoice) | PASS | `invoice.service.ts:183-249` (create row `:202`, then S3 archive) |
| Concurrency: P2002 → collapse onto existing invoice / retry number | PASS | `invoice.service.ts:191-238` (5 attempts, race `findUnique(orderId)`) |
| Historical order data, business details, taxes, totals | PASS | `invoice.service.ts:108` `buildInvoiceData`; `config/branding.ts:21-30`; corrected fixture per `QA_AUDIT_STATUS` |
| A4 PDF + download + email | PASS (code+test) | `pdfkit`; `GET /invoices/:id/download|pdf`; `invoice-email.service.ts` |
| Duplicate webhook cannot duplicate invoice | PASS | unique `orderId` + collapse path §above |

---

## 11. Security findings

| # | Severity | Finding | Evidence | Fix / status |
|---|---|---|---|---|
| S1 | High | S3 bucket/CDN policy not codified | §8 | Not fixed — infra action (B1) |
| S2 | High | SES→SNS suppress-webhook subscription not codified | §9 | Not fixed — infra action (B5) |
| S3 | High | No ECS service / circuit-breaker / autoscaling in IaC | grep `AWS::ECS::Service`=0 | Not fixed — infra action (B3) |
| S4 | Medium | `rds.force_ssl` not enforced | `vedhicfoods-database.yaml:290` param map has no force_ssl | Not fixed — infra action (B7) |
| S5 | Medium | Cart + several admin mutations validated manually (no zod) though schemas exist (`types/cart.types.ts:4,10` unused) | §5 | Not fixed — app action (Low/Med) |
| S6 | Low | Pino redaction single-level (`*.password` misses top-level) | `config/logger.ts:22-58` | Not fixed (no active leak) |
| S7 | Low | Dead simulated admin `PaymentGateway.tsx` (not imported) | §3 | Recommend delete |
| S8 | Low | Legacy SHA-256 password fallback still accepted | `auth.service.ts:95` | Remove after all rows migrated |
| S9 | Low | Dead env config `VITE_ENABLE_*_FALLBACK` | `frontend/.env.production:30-31` | Recommend removal |
| D1 | Critical* | `vitest`/`tinypool`/`@vitest/mocker` advisories | `npm audit` | dev-only; upgrade vitest 5 (major) |
| D2 | High* | `prisma`/`@prisma/config`/`deepmerge-ts` advisories | `npm audit` | dev-only; upgrade prisma |

\* Dev/test tooling only — not present in the production runtime bundle. Still recommended before freeze.

**Verified secure (code evidence):** JWT HS256 + token-type pinning; RBAC enforced server-side on every admin route; IDOR/ownership checks; parameterized Prisma (no string-built SQL found in request paths); Helmet security headers (api-e2e PASS); cookie-bound cross-SPA refresh isolation (per `QA_AUDIT_STATUS_2026-10-18.md`, regression-tested); Razorpay HMAC constant-time; AES-256-GCM at rest; no secrets in git-tracked `.env` files or `VITE_*`; prod boot rejects placeholder secrets (`config/env.ts:296-405`). Cross-tenant/IDOR, upload attacks, CSP, and webhook abuse against a **deployed** stack remain NOT TESTED (BLOCKED).

---

## 12. Performance findings

| Check | Status | Evidence |
|---|---|---|
| Production bundles build & are code-split | PASS | frontend 4.79s, admin 2.92s; route-level lazy chunks; `react` vendor 313 kB (gzip 99 kB) |
| DB indexes for hot paths | PASS | migrations include trigram + FTS (`20261012000000_pg_trgm_product_search`, `20261014000000_product_full_text_search`), tags GIN, notification event key |
| Dashboard aggregation in DB (not in memory) | PASS | per `QA_AUDIT_STATUS` (weekly totals aggregated in Postgres) |
| Connection pool tuning documented | PASS | `DATABASE_POOL_SIZE`, pgbouncer/socket timeout vars in `backend/.env.production.example` |
| Bundle-size budget / Lighthouse / load test | NOT TESTED | no tooling in repo |

---

## 13. Build and test results (actual commands run)

| Command | Result |
|---|---|
| `npm run build:backend` (`tsc`) | PASS |
| `npm run build --prefix frontend` | PASS — built in 4.79s |
| `npm run build --prefix admin` | PASS — built in 2.92s |
| `npm run prisma:validate` / `migrate status` / `migrate diff` | PASS / up-to-date (23) / no drift |
| `npx vitest run tests/unit` (backend) | PASS — **232** |
| `npx vitest run tests/integration` (backend, local PG18) | PASS — **52 files, 1364 passed, 3 skipped, 0 failed** |
| `npx vitest run tests/e2e` (backend) | PASS — **2** |
| `npm test --prefix frontend` | PASS — **20** |
| `npm test --prefix admin` | PASS — **116** |
| `npm run lint:database` + backend lint | PASS (warnings only; unused-var warnings) |
| `npm run lint --prefix frontend` | PASS (clean) |
| `npm run lint --prefix admin` | PASS (warnings only: react set-state-in-effect / purity) |
| `npm audit` | **6 advisories** (2 critical, 3 high, 1 moderate) — all dev/test deps |
| Docker build | NOT TESTED (no Docker engine) |
| Browser/viewport e2e | NOT TESTED (no Playwright/Cypress) |

The 3 skipped integration tests are the live-gated suites (`payment-razorpay-live`, `email-ses-live`, and one other) — intentionally skipped without external creds.

---

## 14. AWS and domain readiness

| Area | Status | Evidence |
|---|---|---|
| RDS (Multi-AZ, KMS, 35-day backups, PITR, deletion protection, private subnets) | PARTIAL | `vedhicfoods-database.yaml`; `log_temp_files_limit` correctly removed (`:302-304`); missing `force_ssl` (S4); CMK grant present (`:235` kms:ViaService) |
| ECS compute | PARTIAL | task definition + IAM valid; **no `AWS::ECS::Service`** (S3 infra blocker) |
| S3 | **MISSING (IaC)** | S1 |
| CloudFront/CDN | **MISSING (IaC)** | S1; app points at `AWS_S3_PUBLIC_BASE_URL` / `cdn.vedhicfoods.com` |
| SES | PARTIAL | identity/DKIM/config set present; webhook subscription + reputation alarms missing (S2 + §9) |
| ACM/HTTPS/HSTS (ALB) | PASS (template) | `vedhicfoods-edge.yaml`; ALB SG list fixed (`:293-296` `[!Ref LoadBalancerSecurityGroup]`) — prior defect resolved |
| Monitoring/alarms | PARTIAL | 5xx/latency/CPU/DB-connection + RDS failover event subscription present (`monitoring.yaml:753-757`); ALB/TG name assumptions + no dashboard remain |
| IAM least privilege | PARTIAL | Execution vs Task roles separated; only ECR uses `*`; OIDC deploy/backup roles are prose, not IaC |
| Domain/DNS | CONFIRM | Cert + hosted-zone parameters exist; apex/admin/CDN records are external |
| Deployment target consistency | **FAIL (documentation)** | `backend/infra` = ECS Fargate; `docs/DEPLOYMENT_ENV.md` = Vercel + Render. Must be reconciled |

No AWS resources were created, modified, or deleted. All AWS-dependent checks are static or BLOCKED.

---

## 15. Remaining defects / blockers (action list)

**Production blockers (must fix/confirm before go-live):**
1. **B1 — Define S3 bucket + public-access-block + encryption + versioning + lifecycle + CloudFront(OAC)** in IaC, or document them as pre-created and verify live. (`infra` gap)
2. **B3 — Define the ECS service + deployment circuit breaker + auto-rollback** (and desired-count/autoscaling) in IaC, or document the service as pre-created.
3. **B5 — Add `AWS::SNS::Subscription`** from the SES events topic to `https://<api>/api/v1/webhooks/email/sns`, and **B4 — SES bounce/complaint reputation alarms**.
4. **B7 — Set `rds.force_ssl`** (or `rds.force_ssl=1`) on the DB parameter group.
5. **Confirm the real hosting target** (ECS vs Vercel/Render) and align `docs/DEPLOYMENT_ENV.md` with `backend/infra`.
6. **Upgrade dev-dependency advisories**: `vitest`→5.x (brings fixed `tinypool`/`@vitest/mocker`), `prisma`/`deepmerge-ts`.
7. **Run the live external verification set** (blocked here): Razorpay test-order lifecycle, SES live send + bounce→webhook, S3 presigned round-trip, ECS deploy + boot with CMK-encrypted secrets, rollback drill, and the 320–1920px browser matrix.

**Non-blocking (quality):**
8. Add zod to cart mutations + the manual admin mutations; delete unused `types/cart.types.ts` schemas or wire them.
9. Delete dead `admin/src/components/checkout/PaymentGateway.tsx` and dead `VITE_ENABLE_*_FALLBACK` config.
10. Consider tightening pino redaction; remove legacy SHA-256 fallback once rows are migrated.

---

## 16. Missing / required environment variable names

Required at runtime (names only; values are placeholders in the tracked examples and must be provided by the platform/Secrets Manager):

- **Backend** (`backend/.env.production.example`): `NODE_ENV, PORT, DATABASE_URL, JWT_SECRET, JWT_EXPIRES_IN, FRONTEND_URL, ADMIN_FRONTEND_URL, TRUST_PROXY, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_S3_BUCKET, AWS_S3_PUBLIC_BASE_URL, REDIS_URL, DATABASE_POOL_SIZE, DATABASE_CONNECT_TIMEOUT_S, DATABASE_SOCKET_TIMEOUT_S, DATABASE_PGBOUNCER, SECRETS_MANAGER_SECRET_ID, REQUEST_TIMEOUT_MS, HEADERS_TIMEOUT_MS, KEEP_ALIVE_TIMEOUT_MS, SHUTDOWN_GRACE_MS, EMAIL_PROVIDER, SES_REGION, SES_SENDER_EMAIL, SES_SENDER_NAME, SES_CONFIGURATION_SET, ADMIN_NOTIFICATION_EMAIL, SNS_EMAIL_TOPIC_ARN, SNS_VERIFY_SIGNATURE, EMAIL_OUTBOX_ENABLED, EMAIL_OUTBOX_INTERVAL_MS, EMAIL_OUTBOX_BATCH_SIZE, RESERVATION_SWEEP_ENABLED, RESERVATION_TTL_MS, RESERVATION_SWEEP_INTERVAL_MS, RESERVATION_SWEEP_BATCH, BREVO_API_KEY, BREVO_SENDER_EMAIL, BREVO_SENDER_NAME, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET, ENCRYPTION_KEY, LOG_LEVEL`.
- **Frontend** (`frontend/.env.production`): `VITE_API_URL` (+ dead `VITE_ENABLE_PRODUCT_FALLBACK`, `VITE_ENABLE_SETTINGS_FALLBACK`).
- **Admin** (`admin/.env.production`): `VITE_API_URL`.
- **Workflows** also require repository variables (not secrets): `AWS_REGION, AWS_BACKUP_ROLE_ARN, ECR_REGISTRY, ECR_REPOSITORY, ECS_CLUSTER_NAME, ECS_SERVICE_NAME, ECS_TASK_FAMILY, ECS_MIGRATION_TASK_DEFINITION, ECS_BACKUP_TASK_DEFINITION, PRIVATE_SUBNET_IDS, TASK_SECURITY_GROUP_ID, BACKUP_S3_BUCKET` (+ optional `BACKUP_S3_PREFIX`, `BACKUP_RETENTION_DAYS`).

---

## 17. Required manual configuration (needs confirmation)

- Real host + region + account id: **ECS cluster/service/task family** and private subnets/SG (`REPLACE_ME_*` in `ecs-task-definition.json`) — or the Vercel/Render equivalent.
- **S3 bucket, CloudFront distribution + OAC, DNS (apex/admin/CDN records)** — create or confirm.
- **SES**: production sending access, verified sender identity, SNS topic → webhook subscription, reputation alarms.
- **Razorpay**: production `KEY_ID/KEY_SECRET/WEBHOOK_SECRET`, webhook URL registered to `POST /api/v1/payments/razorpay/webhook`, test→live key cutover.
- **Secrets Manager** entries for all backend secrets; CMK decrypt for the execution role.
- **Redis** reachable for rate limiting (fail-closed in prod).
- Confirm the **hosting target** decision (see blocker 5).

---

## 18. Backup and recovery status

| Item | Status | Evidence |
|---|---|---|
| RDS automated backups + PITR | PASS (IaC) | `vedhicfoods-database.yaml` (35-day retention, Multi-AZ, deletion protection, final snapshot) |
| Logical dump-to-S3 workflow | PASS (code) | `.github/workflows/db-backup.yml` runs `pg_dump` as an **in-VPC ECS Fargate one-off task** using `database/backup.Dockerfile`; `database/README.md` documents vars/IAM |
| Retention | PASS (config) | `BACKUP_RETENTION_DAYS` (default 30) or S3 lifecycle |
| Restore drill (snapshot → PITR into scratch) | NOT TESTED (BLOCKED) | needs live RDS |
| Backup taken before production migration | NOT RUN | procedure mandated in §19/§20 |

---

## 19. Deployment commands (repository scripts; confirm target first)

Database (never against prod without a verified backup):
```
npm run prisma:validate
npm run prisma:deploy        # applies committed migrations
npm run prisma:status
```

Backend:
```
npm run build:backend        # tsc → backend/dist (start: node dist/bootstrap.js)
```

Frontends:
```
npm run build --prefix frontend      # → frontend/dist (Vercel, or S3+CloudFront)
npm run build --prefix admin         # → admin/dist
```

CI/CD (per `.github/workflows/`):
```
# ci.yml         → typecheck, unit, integration (throwaway Postgres + migrate deploy + drift check)
# deploy.yml     → build+push image, run migration task (image pinned via describe-task-definition),
#                  register task def, update-service, smoke-test, auto-rollback on failure
# db-backup.yml  → build backup image → ECS run-task (pg_dump → S3) → wait → assert exitCode 0
```

---

## 20. Rollback steps

1. **Application:** `deploy.yml` captures the current service task definition into `PREVIOUS_TASK_DEFINITION` and, on any failure, re-registers it and waits for `services-stable` (auto-rollback). Manual: re-point `ECS_SERVICE_NAME` to the prior image tag (immutable SHA tags).
2. **Database:** expand/contract only — safe migrations require the previous image to remain runnable (deploy app before dropping columns; drop in a later release). Restore path: PITR to a scratch instance, or restore the latest `pg_dump` artifact from S3 (`database/README.md` restore section).
3. **Frontend/admin:** redeploy the previous build artifact (Vercel "Redeploy" or the prior S3/CloudFront object version).
4. **Cache/infra:** rotate back the ALB target if blue/green; re-verify `/api/v1/health/ready`.

---

## Verdict

**NOT READY** for production. The application and its automated verification are healthy and production-grade; the blockers are infrastructure codification (S3/CloudFront, ECS service, SES→SNS webhook, `rds.force_ssl`), a hosting-target decision, dev-dependency upgrades, and the fact that **no live external system has been exercised** (payments, email, storage, AWS deploy/rollback, and the browser matrix).

This is **READY FOR STAGING** once a staging environment (disposable Postgres + Razorpay test keys + SES/S3 sandbox + browser run) exists and the HIGH infra items are at least stubbed.

### Exact remaining tasks before any live deployment
1. Decide and document the hosting target; reconcile `docs/DEPLOYMENT_ENV.md` with `backend/infra`.
2. Resolve blockers **B1, B3, B4, B5, B7** (infra code or documented pre-created resources + live verification).
3. Upgrade `vitest` and `prisma` dev dependencies.
4. Provide all §16 variables/secrets and complete §17 manual configuration.
5. Take and verify a backup, then run the migration → deploy → smoke-test → rollback drill on staging.
6. Execute the live external verification set and the 320–1920px browser matrix; record results.

**No production deployment has been performed. Awaiting explicit approval and the above prerequisites before any live action.**
