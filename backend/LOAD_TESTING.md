# Load Testing & Production Traffic Runbook

Backend: `backend/` (Express + Prisma + PostgreSQL)
Status: **measurements collected** against a disposable Postgres 17 on a scaled
dataset (10,000 products, 50,000 orders, 100,000 order items) — see §0.
Benchmarks: `C:\Users\NANDAK~1\AppData\Local\Temp\opencode\perf-bench.cjs`
(sequential), `perf-concurrent.cjs` (concurrency). Raw JSON snapshots:
`perf-results-baseline.json`, `perf-results-after-reports.json`,
`perf-results-after-trgm.json`.

---

## 0. Measured results (2026-10-11)

Environment: local Postgres 17 on the same machine, `NODE_ENV=test` (all rate
limiter ceilings raised to 10,000/IP; SES/Brevo mocked), pool
`connection_limit=10&pool_timeout=30`. Medians are p50; "deep" = page 50/20.

### 0.1 Optimizations shipped during the measurement pass

| Change | Location |
| --- | --- |
| Reports SQL pushdown: `reportSales` / `reportOrders` / `reportCustomers` now run `COUNT(*)`/`SUM()`/day-GROUP-BY aggregates in Postgres instead of pulling + aggregating full row sets in JS | `backend/src/services/report.service.ts` |
| Product search: `pg_trgm` GIN indexes on `name`, `shortDescription`, `description`, `sku` **plus** a GIN array index on `tags` — without the `tags` index PostgreSQL refuses to use any index for the search OR (whole OR becomes non-indexable) | `database/prisma/migrations/20261012000000_pg_trgm_product_search/migration.sql`, `20261012000001_product_tags_gin/migration.sql` |

### 0.2 Before → after (sequential, p50)

| Endpoint | Before | After | Δ |
| --- | ---: | ---: | ---: |
| `GET /products` q=zzznomatch (search miss) | 285 ms | 12 ms | **−96%** |
| `GET /products` q=organic (wide hit) | 114 ms | 63–92 ms | −19–45% |
| `GET /products` page 1 l20 | 49 ms | 37–39 ms | −20% |
| `GET /products/:slug` detail | 25 ms | 19–20 ms | −22% |
| `GET /orders/my-orders` p1 | 39 ms | 29 ms | −26% |
| report sales `range=month` | 49 ms | 23–27 ms | −50% |
| report sales `range=all` | 836 ms | 62–67 ms | **−92%** |
| report sales custom 400d | 890 ms | 70–140 ms | −84–92% |
| report orders `range=all` | 729 ms | 73–81 ms | **−89%** |
| report products `range=all` | 160 ms | 98–101 ms | −37% |
| report revenue `range=all` | 68 ms | 52–60 ms | −12% |
| report customers `range=all` | 76 ms | 108–113 ms | ≈ (wider) |
| dashboard | 109 ms | 83–104 ms | −5–24% |
| admin products l100 | 99 ms | 74–80 ms | −20% |
| checkout COD | 137 ms (201) | 68–115 ms | −16–50% |

The remaining hot spots — invoice regeneration (~2.06 s, PDF + S3) and Razorpay
order prep — cannot be meaningfully improved without real external keys (dummy
keys return HTTP 500) or non-mocked S3.

### 0.3 Under concurrency (20 parallel × 50 iterations, p50 / p95 / p99 / errors)

| Endpoint | p50 | p95 | p99 | err |
| --- | ---: | ---: | ---: | ---: |
| products p1 l20 | 75 ms | 102 ms | 251 ms | 0 |
| products q=zzznomatch | 28 ms | 35 ms | 40 ms | 0 |
| products q=organic | 235 ms | 269 ms | 289 ms | 0 |
| product detail | 30 ms | 38 ms | 44 ms | 0 |
| customer orders p1 | 71 ms | 87 ms | 135 ms | 0 |
| report sales `range=all` | 185 ms | 204 ms | 225 ms | 0 |
| dashboard | 314 ms | 348 ms | 368 ms | 0 |

Only HOURLY-load caveat: the pub-wide search term (`q=organic` matches ~9,500 of
10,000 rows) is the heaviest storefront query — p95 ~270–325 ms at 20 VUs.

### 0.4 Verification (functional tests after each change)

- Unit: 176/176 pass. Reporting API integration: 53/53. Product/catalog/S3:
  39/39. RBAC matrix: 270/270.
- Full backend integration suite on a fresh disposable DB: **32/32 files,
  1,067 passed, 3 skipped (live SES/Razorpay only), 0 failed**.
- `npx tsc --noEmit` clean; `npx oxlint` clean.

> Note: some suites (RBAC matrix, checkout IDOR) require pre-existing order and
> address fixtures from the DB seed. When running against a pruned DB seed, run
> them after a suite that creates orders (e.g., `product-workflow.test.ts`) or
> seed the fixtures, otherwise they abort with "No pre-existing order/address".

### 0.5 Remaining production risks

1. **pg_trgm / GIN extension privilege** — `CREATE EXTENSION pg_trgm` needs
   owner/superuser; the Supabase pooler role used by `migrate deploy` must be
   allowed, else the migration fails (drop both `20261012*` migrations from the
   deploy plan or grant first).
2. **Search OR cost** — every other ILIKE branch (customer/invoice/staff
   `search=` fields on `fullName`/`email`) has no trigram index; only the
   storefront product search was indexed.
3. **Deep offsets** — `page=50/100` still uses `OFFSET`; fine at this scale,
   keyset pagination is the fix at 10× data.
4. **Invoice regeneration** — ~2 s (PDF + S3) regardless of DB work; cache or
   background the PDF render before scaling further.
5. **Razorpay create-order** — response time governed by the external API; can
   only be measured with real test keys.
6. **Rate limiter ceilings in dev** — the 200/15-min/IP dev limiter will 429 a
   load generator; run load against `NODE_ENV=test` as this runbook does.
7. **Report day buckets are UTC-day** (matches existing test assertions and
   prod UTC containers); an IST-tz operator comparing to their local midnight
   will see boundary-day differences on `range=month`.

---

## 1. What we changed and why

Production traffic problems were addressed in layers. Each item below states the
symptom it fixes so the load test can assert on it.

| Area | Change | Symptom addressed |
| --- | --- | --- |
| Connection pooling | `connection_limit`, `connect_timeout`, `socket_timeout`, PgBouncer detection (`database/client.ts`) | `Too many connections` / pool exhaustion under concurrency |
| Checkout | Batched product lookup (`findMany` + `Map`) instead of one query per cart line; primary image only; concurrent idempotency/user/address reads | Latency growing linearly with cart size |
| Inventory | Row locks via `SELECT ... FOR UPDATE` inside transactions | Oversell / lost updates under parallel checkouts |
| Orders | Pagination + narrower `select` on admin and customer order lists | Full-table reads and unbounded payloads |
| Invoices / delivery / promotions | Hard caps on page size, history rows, and nested relations | Memory blowups and timeouts on large tenants |
| Support | List projections exclude message bodies; 16 queries → 6 parallel aggregates | Slow staff dashboard, over-fetching |
| Reconciliation | O(N+M) set reconciliation, 5000-row caps, `findMany` mismatch counts | Job stalling on large payment sets |
| Permissions | 60s cache of the static permission catalogue | Repeated catalogue scan on every authenticated request |
| HTTP | `requestTimeout` / `headersTimeout` / `keepAliveTimeout`, graceful drain with `closeIdleConnections()` | Socket exhaustion; dropped requests during rolling deploys |
| Rate limiting | Shared Redis store, production **fails closed** without `REDIS_URL` | Effective limits silently multiplied by replica count |
| Email | Documented as in-process/non-durable | Known gap: queued mail lost if its instance dies |

---

## 2. Prerequisites

```bash
# A disposable database — NEVER the Supabase instance in .env
docker run -d --name vf-loadtest \
  -e POSTGRES_PASSWORD=loadtest -e POSTGRES_USER=vf -e POSTGRES_DB=vf_loadtest \
  -p 5433:5432 postgres:16-alpine

# Migrations + seed against the disposable DB
cd database
npx prisma migrate deploy
```

Required environment for a load run:

```
NODE_ENV=production
DATABASE_URL=postgresql://vf:loadtest@localhost:5433/vf_loadtest?connection_limit=20
JWT_SECRET=<32+ chars>
REDIS_URL=redis://localhost:6379
AWS_S3_BUCKET=<disposable-bucket>       # or exercise a stub
RAZORPAY_KEY_ID=<test key>
RAZORPAY_KEY_SECRET=<test secret>
TRUST_PROXY=1                            # required in production
```

> **Safety.** `backend/tests/integration/_safety.ts` refuses to run when
> `DATABASE_URL` points at a non-disposable host. Keep that guard on. If you
> disable it to run a load test you are one `prisma migrate reset` away from
> deleting production orders.

---

## 3. Test scenarios

Prioritised by expected production impact. Each scenario states its **pass
criterion**, so results are objective rather than "felt fast".

### T1 — Product listing (highest read volume)
`GET /api/v1/products?page=1&limit=24`

- 50 VUs, 5 min, ramp 2 min.
- Assert: p95 < 400 ms, p99 < 900 ms, error rate < 0.5%, DB queries/request
  constant regardless of page depth.
- Watch: `EXPLAIN` uses `products_pkey`/category index; no sequential scan on
  `products` once `pg_stat_statements` warms up.

### T2 — Product detail
`GET /api/v1/products/:slug`

- 50 VUs, 5 min. Assert p95 < 250 ms.
- Watch: N+1 on related products/images. Should be a fixed query count.

### T3 — Checkout (correctness under concurrency)
`POST /api/v1/orders/checkout` with a 3-item cart.

- 10 VUs, 10 min, **unique `Idempotency-Key` per virtual user**.
- Assert: p95 < 2 s; zero oversell (`quantity < 0`); orders created equals
  successful requests; replaying the same idempotency key returns the original
  order and creates nothing new.
- Watch: `Too many connections`; lock waits on `inventories` / `carts`.

### T4 — Concurrent checkout on the SAME product (contention)
All VUs buy the same SKU with deliberately insufficient stock.

- 10 VUs, 5 min. Assert: no negative stock, no lost updates, every rejection is a
  clean 4xx, no 500s.
- This is the scenario that proves the `FOR UPDATE` inventory path.

### T5 — Admin orders list (was unbounded)
`GET /api/v1/admin/orders?page=N`

- 10 VUs, 5 min, on a seeded dataset of ~100k orders.
- Assert: p95 < 500 ms and **flat** as page number increases — a flat curve is
  the proof the pagination landed. Before the change this degraded with offset.

### T6 — Admin dashboard / staff support overview
- 10 VUs, 5 min. Assert p95 < 700 ms. Watch query count per request (target 6
  for `getStaffOverview`, previously 16).

### T7 — Payment webhook replay
`POST /api/v1/payments/razorpay/webhook` with duplicate Razorpay events.

- 5 VUs, 5 min, replaying the same event IDs.
- Assert: exactly one state transition; replays are idempotent no-ops; HMAC
  signature still enforced on every request.

### T8 — Rate limiting across instances (multi-instance only)
Hit an auth endpoint from 2 app instances behind a load balancer.

- Assert: the limit is enforced **globally**, not per instance. With 20 attempts
  configured, the 21st request must fail no matter which instance serves it.
- This test fails on the pre-fix in-memory store, which is why `REDIS_URL` is
  mandatory in production.

### T9 — Soak / connection stability
- 20 VUs, 30 min steady.
- Assert: no connection-count growth, no memory leak, event-loop lag p95
  < 100 ms, no `MaxListenersExceeded` warnings.
- Watch: pool saturation as the clearest signal that `connection_limit` is wrong
  for the instance count.

### T10 — Graceful drain (rolling deploy simulation)
Send SIGTERM to an instance **while** T3/T5 traffic is running.

- Assert: in-flight checkouts complete successfully; zero 502s; the instance
  exits within `SHUTDOWN_GRACE_MS`.

---

## 4. Running it

`k6` is the suggested tool (single binary, scriptable assertions).

```bash
k6 run --out json=results-t1.json load-tests/product-list.js
k6 run --out json=results-t3.json load-tests/checkout.js
```

Minimal T1 shape:

```js
import http from 'k6/http'
import { check } from 'k6'

export const options = {
  vus: 50,
  duration: '5m',
  thresholds: {
    http_req_duration: ['p(95)<400', 'p(99)<900'],
    http_req_failed: ['rate<0.005'],
  },
}

export default function () {
  const res = http.get(`${__ENV.BASE_URL}/api/v1/products?page=1&limit=24`)
  check(res, { 'status is 200': (r) => r.status === 200 })
}
```

---

## 5. Before / after results

| Scenario | Metric | Before | After | Delta |
| --- | --- | --- | --- | --- |
| T1 product listing | p95 | _TBD_ | _TBD_ | |
| T3 checkout (3 items) | p95 | _TBD_ | _TBD_ | |
| T3 checkout queries | count | _TBD_ | _TBD_ | |
| T5 admin orders p95 | p95 | _TBD_ | _TBD_ | |
| T6 staff overview | queries | 16 | 6 | -63% |
| T9 pool saturation | conns | _TBD_ | _TBD_ | |

---

## Blocked measurements

These numbers **cannot** be produced in the current environment, and the table
above is intentionally left as `TBD` rather than filled with estimates:

- **No disposable PostgreSQL.** No `docker`, `psql`, `pglite`, `pg-mem`, or
  Testcontainers is available, and the configured `DATABASE_URL` points at a
  **Supabase pooler host in production**. Load testing against it would generate
  real load on a real database and could corrupt live order data.
- **No `EXPLAIN ANALYZE`.** Real query plans require a live PostgreSQL
  connection. Index recommendations in the QA report are therefore reasoned from
  the query shapes and schema, not measured.
- **No load generator installed.** `k6` is not present in this environment.
- **No Razorpay/S3/SES test credentials**, so T7 and the S3 upload paths can be
  exercised only against stubs.

Once a disposable database is available, run T1–T10 and fill in section 5. Do not
populate it with estimates — a fabricated benchmark is worse than a missing one.

---

## 6. Multi-instance deployment checklist

- [ ] `REDIS_URL` set — rate limiting fails closed without it.
- [ ] `TRUST_PROXY` set explicitly to the ALB/ingress hop count.
- [ ] `connection_limit × instance count + headroom ≤ PostgreSQL `max_connections``.
- [ ] ECS `stopTimeout` (or K8s `terminationGracePeriodSeconds`) **>** `SHUTDOWN_GRACE_MS`.
- [ ] ALB idle timeout **>** `KEEP_ALIVE_TIMEOUT_MS`.
- [ ] ALB idle timeout **>** `REQUEST_TIMEOUT_MS` so the proxy never kills a
      request the app is still finishing.
- [ ] Target group health check uses `/api/v1/health` and honours deregistration
      delay long enough for the drain.
- [ ] Reviewed: the email queue is in-process, so mail queued at deploy time is lost.