# Application QA and security audit status — 2026-10-18

This report records source changes and checks completed in the current worktree.
It does not claim a production or staging penetration test.

## Implemented

- Customer and admin refresh credentials use separate `HttpOnly`, `SameSite=Strict`
  cookies. Browser-readable access tokens stay in memory. Admin login, refresh,
  and logout are limited to the configured admin origin; customer and admin
  refresh cookies are checked against their owning SPA. Logging out of one SPA
  clears only its own cookie.
- Customer and staff sessions survive network errors, throttling, and server
  outages. A definite credential rejection still expires the session.
- Added database ownership relations and foreign keys for order addresses,
  invoice owners, coupon usage orders, inventory log orders, delivery assignments,
  product review authors, and support notification messages. Migration
  preflights reject existing orphaned or cross-customer rows before constraints
  are applied. Coupon redemption history restricts deletion of its order.
- Product detail no longer refetches the product solely to request related
  products; the existing product object is reused. Weekly admin dashboard
  totals are aggregated in PostgreSQL instead of loading the full time window
  into application memory.
- Form error descriptions and dialog focus restoration were corrected, and
  product search cancels obsolete requests. SEO metadata and structured data are
  set for routed pages; the sitemap is refreshed after builds, with an opt-in
  public catalog fetch for product URLs.
- Corrected the invoice PDF test fixture whose stated total did not match its
  line items, discount, shipping, and tax.

## Checks completed

| Check | Result |
|---|---|
| Prisma schema validation | PASS |
| Backend TypeScript build | PASS |
| Storefront and admin TypeScript checks and production builds | PASS |
| Backend unit suite | PASS — 232 tests |
| Admin unit suite | PASS — 99 tests |
| Storefront unit suite | PASS — 13 tests |
| Cookie origin isolation regression | PASS — admin origin accepted for admin cookie; storefront/admin cross-use rejected |
| ESLint/Oxlint | PASS with existing warnings recorded in command output |
| Git/repository secret scan | No confirmed exposed secret found; values were not printed |

## Security severity assessment

| Severity | Finding/status |
|---|---|
| Critical | None confirmed in the source and unit-test scope. This is not a claim that a live penetration test found no critical issues. |
| High | Fixed: a storefront origin could use credentialed CORS to call the admin refresh endpoint and read a rotated admin access token on sibling subdomains. Admin auth routes now reject non-admin origins before CORS, refresh cookies are bound to their owning SPA, and a regression test covers cross-SPA refresh attempts. Logout also clears only the matching SPA cookie. |
| Medium | End-to-end staff RBAC/IDOR probes, upload attacks, session manipulation, frontend CSP response headers, and provider/webhook abuse were not run against a deployed test stack. Existing backend unit coverage passes; the live and database-backed matrix remains pending. Product SEO metadata is client-injected and needs host-side prerender/SSR for reliable social crawlers. |
| Low | No low-severity security issue was confirmed within the reviewed scope. Lint has separate non-blocking cleanup warnings. |

## Pending verification and known limits

- **PostgreSQL:** no local PostgreSQL or Docker engine is available. Do not run
  migrations, seed, direct-write integrity tests, rollback/concurrency tests, or
  empty/existing-data migration tests until a disposable PostgreSQL database is
  available. No production database was contacted. Prisma client generation and
  migration diff also hit Windows `EPERM` when Prisma tried to start/replace its
  query-engine subprocess.
- **Staff browser workflow:** role-by-role login, navigation visibility, URL/API
  tampering, 403 responses, customer-data isolation, logout, and session expiry
  need the seeded disposable database and a running browser app. API authorization
  regression tests pass, but the manual browser/API matrix is not complete.
- **Payments, email, S3 and invoice delivery:** backend unit/mocked tests pass;
  live Razorpay test credentials, SES test mailbox, and S3 test bucket were not
  supplied. Webhook reconciliation, provider failure/timeouts, real uploads,
  email delivery and refund behavior remain unverified against vendors.
- **Performance:** source-level improvements are confirmed: product detail saves
  one product GET per visit (2 to 1 in the audited path), and dashboard query
  result memory is bounded to weekly buckets rather than matching order count.
  Real latency, large datasets and concurrent-user measurements need a running
  app and representative disposable data; no before/after runtime timings are
  claimed.
- **Accessibility/SEO:** code-level labels, error announcements, focus handling,
  route metadata, structured data, robots and sitemap were reviewed and builds
  pass. Keyboard/screen-reader/contrast checks and social crawler fetches were
  not run in a browser. Product-specific metadata is currently injected after
  client JavaScript runs; static hosting must support route fallback, and
  product URLs enter the sitemap only when `GENERATE_PRODUCT_SITEMAP=true` and
  `VITE_API_URL` are supplied at build time. Frontend hosting CSP headers are
  outside the repository and remain unverified.

The database-only checklist and its integration test files are tracked in
[`DB_QA_STATUS_2026-10-18.md`](../database/DB_QA_STATUS_2026-10-18.md). The
product sitemap release command is documented in
[`SEO_DEPLOYMENT.md`](SEO_DEPLOYMENT.md).
