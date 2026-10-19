# AWS Deployment — Vedhic Foods Backend

Status: **configuration and documentation complete. NOT DEPLOYED.**
Nothing in this repository has been deployed to any AWS account, no AWS API call
has been made, and no deployment has been verified. Docker and the AWS CLI are
not installed in the authoring environment, so the container build, the task
definition registration, and the live health checks are all unverified. See
[What is NOT verified](#what-is-not-verified).

---

## 1. Compute architecture: ECS on Fargate

**Chosen: Amazon ECS on AWS Fargate**, behind an Application Load Balancer.

| Option | Verdict | Why |
| --- | --- | --- |
| **ECS + Fargate** | **Chosen** | The app is already a containerised stateless Node service. Fargate gives managed scaling, rolling deploys with configurable drain time, per-task IAM roles, and no host to patch. |
| EC2 | Rejected | Needs AMI hardening, host patching, and a bastion. The operational surface is large and buys nothing for a stateless HTTP API. |
| Elastic Beanstalk | Rejected | Simplest to start, but it hides the deployment model behind a proprietary wrapper and makes the drain behaviour, IAM task roles, and secret injection you need here indirect and hard to reason about. |
| App Runner | Rejected (for now) | Closest fit and the least operational work, but it does not support the Secrets Manager injection you already rely on. Worth revisiting if manual scaling becomes a burden. |

The deciding factor is the graceful-shutdown work in `src/server.ts`. ECS
`stopTimeout` and ALB deregistration delay are explicit, tunable numbers, which is
exactly what a rolling deploy needs so in-flight checkouts finish instead of
being cut off. On Beanstalk that behaviour is implicit.

Scaling: `desiredCount` 2, target group `healthyThreshold` 2, ALB across 2 AZs.

---

## 2. Container

Build from the **monorepo root**:

```bash
docker build -f backend/Dockerfile -t vedhicfoods-backend:latest .
```

Root context is mandatory: `backend` depends on the `vedhicfoods-database`
workspace package, which npm links through the root `node_modules`.

The previous `backend/Dockerfile` could never have built — it ran
`COPY prisma ./prisma/` although no `backend/prisma` directory exists (the schema
is `database/prisma/`). It is now a five-stage build:

| Stage | Purpose |
| --- | --- |
| `base` | `node:22-alpine` (Node LTS), `openssl` for the Prisma engine, `tini` |
| `deps` | `npm ci` with the schema present so Prisma's postinstall runs |
| `build` | compiles `vedhicfoods-database` then `vedhicfoods-backend` |
| `prod-deps` | `npm ci --omit=dev` |
| `runner` | prod `node_modules` + `dist` only, runs as `node` (uid 1000) |

Requirements and how each is met:

- **Node LTS** — `node:22-alpine`.
- **Multi-stage** — dev dependencies and TypeScript toolchain never reach `runner`.
- **Production dependencies only** — `--omit=dev`, cache cleaned.
- **Non-root** — `USER node`; no host file is written, so the container can also
  run with a read-only root filesystem.
- **No secrets in the image** — no `ARG`/`ENV` carries a credential. Root
  `.dockerignore` excludes `.env` and `.env.*` for all five `.env` files in this
  repo (keep the `!.env.example` negation).
- **Health check** — `HEALTHCHECK` on `/api/v1/health`, implemented with Node so
  `curl` is not needed in the image.
- **Configurable PORT** — `ENV PORT=5000`, read from the environment; the ECS
  `portMappings` and `PORT` stay in sync.
- **Small image** — no build tooling, no dev deps, no `curl`; busybox Alpine base.

`tini` is required, not cosmetic: without a real init, `docker stop` / ECS
`SIGTERM` may not reach Node as PID 1 and `server.ts`'s shutdown handler never
runs — which is precisely what drops in-flight checkouts on deploy.

---

## 3. RDS (PostgreSQL)

`DATABASE_URL` lives in Secrets Manager and **must** include `sslmode=require`:

```
postgresql://USER:PASSWORD@HOST:5432/DBNAME?sslmode=require&connection_limit=5
```

`database/client.ts` appends `connect_timeout`, `socket_timeout`, and
`pgbouncer=true` automatically when it detects a pooler host.

Recommended instance: `db.t4g.medium` for production, Multi-AZ with a read
replica once reporting needs it. Storage 100 GB gp3, `performance_insights`
on.

### Pool sizing — the number that breaks under load

Total connections = `DATABASE_POOL_SIZE` × task count, and must stay under the
instance's `max_connections`:

```
5 (pool) × 6 (max tasks) = 30
```

`db.t4g.medium` allows roughly 420, so there is ample headroom for migrations and
operator sessions. **If you raise the task count, re-check this** — exceeding
`max_connections` produces `Too many connections` and takes the whole site down,
which is why the default pool is deliberately small (5).

### Migrations

Migrations run as a **separate one-off task before the service update**, never on
every task start. Concurrent `prisma migrate deploy` from six tasks would race.

```bash
aws ecs run-task --cluster vedhicfoods --task-definition vedhicfoods-backend:latest \
  --launch-type FARGATE --network-configuration 'awsvpcConfiguration={subnets=[...]}'
```

Then `aws ecs wait tasks-stopped --cluster vedhicfoods --tasks <TASK>`, and only
register the new task definition once it has exited 0.

`backend/tests/integration/_safety.ts` must stay enabled. `DATABASE_URL` currently
points at a Supabase pooler host; running migrations or load tests against it
would modify live order data.

### Bootstrap accounts

The repository ships **no default login credentials**. `database/seed.ts` creates
a bootstrap admin only when `SEED_ADMIN_PASSWORD` and the other `SEED_*`
variables are set — when they are not, it warns instead of inventing a default
password. Old documentation values such as `Admin@Vedhic2025` /
`Admin@Vedhic2026` were never used by the current seed; rotate any credential
that was created from them before go-live.

---

## 4. S3

- Bucket: one bucket, private, Block Public Access **on** for both ACL and
  bucket-owner-enforced.
- Object access is entirely presigned (`generatePresignedUploadUrl`,
  `generatePresignedDownloadUrl`). Nothing is public-read.
- IAM: `infra/iam-policies.json` → `TaskRole` scoped to `products/*`, `invoices/*`
  and `catalog/*`. `s3:ListBucket` on the root is deliberately withheld.
- CORS: **required**, because the browser uploads images directly to S3 via a
  presigned `PUT`. A presigned URL authorises the request, but the browser still
  enforces CORS on the response — without CORS the upload succeeds server-side
  and the page fails to read the result.

```bash
aws s3api put-bucket-cors --bucket BUCKET --cors-configuration file://backend/infra/s3-cors.json
```

Allowed origins are explicit; `"*"` is rejected for credentialed requests and
would let any site trigger authenticated uploads.

### 4.1 Bucket policy hardening

Apply a bucket policy that denies non-TLS requests and unencrypted uploads. This
has no console toggle that can be accidentally switched off:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyInsecureTransport",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": [
        "arn:aws:s3:::vedhifoods-media-production",
        "arn:aws:s3:::vedhifoods-media-production/*"
      ],
      "Condition": { "Bool": { "aws:SecureTransport": "false" } }
    },
    {
      "Sid": "DenyUnencryptedObjectUploads",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::vedhifoods-media-production/*",
      "Condition": {
        "StringNotEquals": { "s3:x-amz-server-side-encryption": "aws:kms" }
      }
    }
  ]
}
```

Substitute the real bucket ARN. Also enable S3 Versioning with a rule to expire
noncurrent versions, server access logging into a separate tightly scoped
bucket, and SSE-KMS with bucket keys.

### 4.2 Serve media through CloudFront (Origin Access Control)

Product imagery and customer invoices are served via a **CloudFront
distribution with Origin Access Control (OAC)** — the bucket stays private and
only the distribution can read it. Never use S3 website endpoints (they cannot
use OAC and require public access). Configure the distribution to:

- forward the `Host` header;
- use a cache policy that respects the file extension;
- attach the WAF managed rule group.

### 4.3 No static credentials

Grant the TaskRole in `backend/infra/iam-policies.json` — never an IAM user. Do
**not** set `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` in any deployed
environment; if set, the SDK prefers them over the task role, and a leaked
static key grants access until someone notices and revokes it.

### 4.4 Serving media: `AWS_S3_PUBLIC_BASE_URL`

`S3Service.buildPublicUrl` constructs a direct
`{bucket}.s3.{region}.amazonaws.com/{key}` URL by default. Against a private OAC
bucket that URL returns `403`, so product images and invoices fail to load.

Set **`AWS_S3_PUBLIC_BASE_URL`** to the CloudFront distribution origin (e.g.
`https://cdn.vedhicfoods.com`, no trailing slash) and `buildPublicUrl` emits
`{base}/{key}` instead. It is optional: if unset, the service keeps the direct S3
URL it always produced, so a deployment that serves media through presigned URLs
(`s3.service.ts`) is unaffected. This is wired through the env schema
(`backend/src/config/env.ts`), the task definition
(`backend/infra/ecs-task-definition.json`) and `.env.production.example`.

---

## 5. SES

SES replaces Brevo in production via `EMAIL_PROVIDER=ses`. Brevo remains
supported for local development, where no AWS credentials exist.

- **Verified sender:** verify the domain `vedhicfoods.com` (add the DKIM CNAME
  and SPF TXT records it prints). Verifying the domain — not a single address —
  means any `From` on it works and DKIM/SPF align.
- **Region:** same as the stack (`ap-south-1` in the template), since email
  reputation is region-scoped.
- **IAM:** `ses:SendEmail` / `ses:SendRawEmail` scoped to the verified identity
  ARN and the configuration set. A wildcard resource would allow sending as any
  identity in the account.
- **Configuration set:** `vedhicfoods`, which is what makes bounce and complaint
  events publishable to CloudWatch. Set `SES_CONFIGURATION_SET` so they are.
- **Production access:** the SES account is in the sandbox until production
  access is granted. While sandboxed, SES will only send *to* verified
  addresses, and requests to send elsewhere are rejected.

SES is unreachable from local development, which is why Brevo is kept.

---

## 6. Secrets

**Primary mechanism — ECS native injection.** The task definition's `secrets`
block references ARNs; the ECS agent injects values before the container starts.
No application code is involved, and `describe-task-definition` shows only ARNs.

**Fallback — `config/secrets-manager.ts`.** Active only when
`SECRETS_MANAGER_SECRET_ID` is set, for running the same image on EC2, Beanstalk
or App Runner where no ECS agent exists. It loads secrets *before*
`config/env.ts` validates `process.env` (hence `dist/bootstrap.js` as the entry
point). Failure to load is fatal — never a fallback to a development default.

Two IAM roles, deliberately separate:

- **ExecutionRole** (ECS agent): ECR pull, `GetSecretValue` on
  `vedhicfoods/backend/*`, log writes.
- **TaskRole** (application): S3 and SES only, plus an **explicit Deny** on all
  `secretsmanager` actions. Without that deny a compromised application could
  read every other secret in the account through an SDK it already has installed.

No secret value appears in any committed file. `infra/validate-task-definition.ps1`
fails if a literal value is found in the `secrets` block.

---

## 7. CloudWatch

- **Application logs** — `pino` already writes newline-delimited JSON to stdout in
  production (`pino-pretty` is enabled only outside production), so the `awslogs`
  driver delivers structured JSON with no CloudWatch agent and no code changes.
  Logs Insights queries work directly on it.
- **Error logs** — `error.middleware.ts` / `logging.middleware.ts` emit structured
  errors including the `x-request-id` that the client sees.
- **Startup logs** — `server.ts` logs port, environment, request and keep-alive
  timeouts, and the health endpoint; `email-transport.ts` logs the chosen email
  provider on first use.
- **Health monitoring** — `/api/v1/health` is liveness; `/api/v1/health/ready` also
  checks PostgreSQL. Use liveness for the container health check and readiness
  for the ALB target group, so a database blip removes the task from rotation
  without restarting it.
- **Log group:** `vedhicfoods/backend`. The task definition sets
  `awslogs-create-group: true`, and the ECS execution role in
  `infra/iam-policies.json` now grants `logs:CreateLogGroup` on
  `arn:aws:logs:ap-south-1:*:log-group:/vedhicfoods/backend*`, so the group is
  created on demand. Creating it ahead of time (with retention) via
  `infra/scripts/create-cloudwatch.ps1` is still recommended so retention is set
  before any logs are written.
  Retention is 30 days, set as CloudWatch **log retention** — not a "lifecycle
  rule"; the two are different features and CloudWatch Logs has no lifecycle
  rules.

Recommended alarms:

| Alarm | Metric | Threshold |
| --- | --- | --- |
| 5xx rate | ALB `HTTPCode_Target_5XX_Count` | > 5% for 5 min |
| Latency | ALB `TargetResponseTime` p99 | > 2 s for 5 min |
| Task health | ECS `RunningTaskCount` vs `desiredCount` | any gap for 3 min |
| Email bounces | SES `BounceRate` | > 5% |
| DB saturation | RDS `DatabaseConnections` | > 80% of `max_connections` |

---

## 8. Deployment runbook

### Pre-flight

```bash
# 1. No unsubstituted placeholders may remain. Exits non-zero otherwise.
powershell -ExecutionPolicy Bypass -File backend\infra\validate-task-definition.ps1

# 2. Confirm no .env is staged.
git status --porcelain | findstr /R "\.env$"

# 3. Secrets exist (names and ARNs only - never values). Created idempotently by:
#    infra/scripts/create-secrets.ps1
aws secretsmanager list-secrets \
  --query "SecretList[?starts_with(Name, 'vedhicfoods/backend')].Name" --output table
```

### Deploy

```bash
# Build and push
aws ecr get-login-password --region REGION | docker login --username AWS --password-stdin ACCOUNT.dkr.ecr.REGION.amazonaws.com
docker build -f backend/Dockerfile -t ACCOUNT.dkr.ecr.REGION.amazonaws.com/vedhicfoods-backend:latest .
docker push ACCOUNT.dkr.ecr.REGION.amazonaws.com/vedhicfoods-backend:latest

# Migrations as a one-off task; verify exit code 0 before continuing.

# Register task definition
aws ecs register-task-definition --cli-input-json file://backend/infra/ecs-task-definition.json \
  --query 'taskDefinition.{revision:revision,status:status}' --output table

# Update the service. ECS performs the rolling replacement.
aws ecs update-service --cluster vedhicfoods --service vedhicfoods-backend \
  --task-definition vedhicfoods-backend:REVISION

# Watch it converge
aws ecs wait services-stable --cluster vedhicfoods --services vedhicfoods-backend
```

### Verify

```bash
# Task health
aws ecs describe-services --cluster vedhicfoods --services vedhicfoods-backend \
  --query 'services[0].deployments[*].{status:status,running:runningCount,pending:pendingCount}'

# Readiness through the ALB - the check that actually matters
curl -fsS https://api.example.com/api/v1/health/ready

# Confirm the app resolved its secrets rather than defaulting
aws logs tail vedhicfoods/backend --since 10m --filter-pattern 'Starting Vedhic'
```

### Rollback

```bash
aws ecs update-service --cluster vedhicfoods --service vedhicfoods-backend \
  --task-definition vedhicfoods-backend:LAST_GOOD_REVISION
```

### Timeout relationships (getting these wrong causes 502s)

```
ECS stopTimeout  (60s)  >  SHUTDOWN_GRACE_MS (25s)
ALB idle timeout (60s)  >  KEEP_ALIVE_TIMEOUT_MS (65s)  <-- see note
ALB idle timeout        >  REQUEST_TIMEOUT_MS (60s)
```

Note the keep-alive row: `KEEP_ALIVE_TIMEOUT_MS` is 65 s against a 60 s proxy idle
timeout. If the proxy is 60 s, raise the ALB idle timeout above 65 s or lower
`KEEP_ALIVE_TIMEOUT_MS`. The server must close idle sockets *before* the proxy,
or the proxy tears the connection down and the client sees a 502.

---

## What is NOT verified

Stated plainly, because none of the following can be true from this environment:

- **Docker is not installed.** The Dockerfile has never been built. Its syntax was
  reviewed and the manifest/COPY paths were checked against the filesystem, but no
  `docker build` has run. Expect to fix something on the first build.
- **No AWS account was contacted.** No task definition was registered, no secret
  was created, no IAM role attached, no SES identity verified.
- **No deployment was performed and none is claimed to have succeeded.**
- **`prisma migrate deploy` has never been run** against any database.
- **No load test was executed** — see `LOAD_TESTING.md` for why (no disposable
  PostgreSQL, and the configured `DATABASE_URL` is production Supabase).
- **The integration suite remains blocked** by design: 13 suites refuse to run
  without a disposable `TEST_DATABASE_URL`.
- **`infra/validate-task-definition.ps1` was run and works** — it correctly
  reports all 21 unsubstituted `REPLACE_ME` markers and passes the secret-leakage
  and JSON checks. It is the only part of this deployment path actually executed.

---

## Remaining items from the QA list

Not addressed here; tracked so they are not lost:

- `MERGE` `CartService.mergeGuestCart` still issues one `update` per existing item;
  the `2N+2 -> 3` claim in its comment is wrong.
- `PERFORMANCE ISSUE` inventory N+1 loops: `reserveStock`, `releaseReservation`,
  `confirmDeduction`, `restockOrder`.
- `MISSING` public content API for FAQs, testimonials and product reviews — still
  served from `frontend/src/data/content.ts`.
- `MOCK` `admin/src/services/adminService.ts` (~44 `mockRequest` calls).
- `PERFORMANCE ISSUE` no `EXPLAIN ANALYZE` has been run; index recommendations are
  reasoned from query shapes, not measured.