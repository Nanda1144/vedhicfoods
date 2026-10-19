# VEDHIC FOODS — Production Domain Runbook

Custom domain: **`vedhicfoods.com`**, DNS in **Route 53, same AWS account**.

| Role | Hostname | Served by |
| --- | --- | --- |
| Storefront (customers) | `vedhicfoods.com` | Amplify / S3 + CloudFront |
| Admin portal (staff) | `admin.vedhicfoods.com` | Amplify / S3 + CloudFront |
| Backend API | `api.vedhicfoods.com` | ALB → ECS Fargate → RDS/S3/SES/Razorpay |

Status: **configuration complete, nothing deployed.** No AWS API call has been made
from this repository, no record created, no certificate issued, no health endpoint
reached. See [What is NOT verified](#what-is-not-verified).

---

## 1. Architecture and the TLS boundary

```
Customer browser
   │  HTTPS 443                      ← TLS ends here (ACM certificate)
   ▼
Route 53  vedhicfoods.com / api.vedhicfoods.com / admin.vedhicfoods.com
   │
   ├── ap-southeast / ap-south-1 CloudFront (or Amplify default domain)
   │        storefront + admin: static assets only, no origin server
   │
   ▼
Application Load Balancer  vedhicfoods-api   (internet-facing, 2 AZs)
   │  port 80  → 301 redirect to HTTPS, serves nothing
   │  port 443 → ACM cert for api.vedhicfoods.com, TLS 1.2/1.3 only
   │  path /api/* → target group, /api/v1/health/ready
   │  everything else → 404 (deliberately, see below)
   ▼
ECS Fargate  (private subnets, awsvpc, container port 5000)
   │  port 5000 reachable ONLY from the ALB security group
   ▼
RDS PostgreSQL  ·  S3 (presigned)  ·  SES  ·  Razorpay
```

**One hostname, one certificate.** The ALB certificate covers `api.vedhicfoods.com`
alone — not `*.vedhicfoods.com`. A wildcard would also validate any other name
under the domain, which widens the blast radius of a dangling-CNAME takeover for no
benefit. The storefront and admin certificates belong to the CDN that serves them,
not to this load balancer.

**The API hostname appears nowhere in the CORS allowlist.** `FRONTEND_URL` and
`ADMIN_FRONTEND_URL` are the two *browser* origins. The API is not a browser origin
and must not be listed.

### Why port 80 exists at all

Only to redirect. A 301 to HTTPS is better than a bare refusal: a customer who types
`vedhicfoods.com` or follows an old `http://` link in a bookmark gets to the secure
site instead of a browser error. Nothing is served over plaintext, so there is no
HTTP-only authentication anywhere in the chain. `301` is used rather than `308`
because some corporate proxies and older mobile browsers mishandle `308`, and a
broken redirect on a checkout costs a real order.

Once you are confident nothing links to `http://`, remove the port-80 ingress from
`LoadBalancerSecurityGroup` in the edge stack.

---

## 2. DNS records

**These are documented, not applied.** The only record this repository's
CloudFormation creates is the `api.` alias. Do not paste the rest into Route 53
until the corresponding resource exists — an alias pointing at a load balancer that
does not exist yet resolves to nothing, and a storefront alias pointing at a
distribution that has not been deployed serves a CloudFront 404 to every customer.

### 2.1 `api.vedhicfoods.com` — created by CloudFormation

```yaml
Type: A
Name: api.vedhicfoods.com
AliasTarget:
  DNSName:        <LoadBalancer DNS name, from the stack output>
  HostedZoneId:   <LoadBalancer CanonicalHostedZoneId, from the stack output>
  EvaluateTargetHealth: false
```

An **alias**, not a CNAME and not the ALB's raw addresses. A CNAME adds a second DNS
resolution step and an extra failure mode; the addresses behind an ALB change and
cannot be hardcoded.

No `AAAA` record is created, because the load balancer is created with
`IpAddressType: ipv4`. To go dual-stack: associate an IPv6 CIDR with the subnets,
switch the load balancer to `dualstack`, then add a second `RecordSet` with
`Type: AAAA` and the identical `AliasTarget`.

### 2.2 ACM certificate validation

CloudFormation creates this CNAME automatically because `HostedZoneId` is passed to
the certificate's `DomainValidationOptions`. If the certificate stays
`PENDING_VALIDATION` after the stack completes, the zone was not visible to this
account and you must add it by hand:

```bash
aws acm describe-certificate --certificate-arn <ARN> --query 'Certificate.DomainValidationOptions[0].ResourceRecord'
```

```yaml
Type: CNAME
Name:  <the value of Name from the command above, e.g. _xxxx.vedhicfoods.com>
Value: _yyyy.acm-validations.aws.
TTL:   60
```

Set the TTL low *before* requesting the certificate. Validation retries for
up to 72 hours, and a 5-minute TTL on an existing record means an operator who
needs to add it manually gets a working certificate in minutes instead of waiting
out a long cache.

### 2.3 `vedhicfoods.com` and `www.vedhicfoods.com` — storefront

Depends on the hosting choice. With **Amplify**, the console's *Domain management*
adds both records itself; confirm rather than create them by hand, or you will end up
with a duplicate record and a confusing half-applied change.

```yaml
Type: A
Name: vedhicfoods.com
AliasTarget:
  DNSName:      <Amplify/CloudFront distribution domain>
  HostedZoneId: Z2FDTNDATAQYW2   # CloudFront's hosted zone, always this value
```

```yaml
Type: AAAA
Name: vedhicfoods.com
AliasTarget:
  DNSName:      <same distribution>
  HostedZoneId: Z2FDTNDATAQYW2
```

```yaml
Type: CNAME
Name: www
Value: <same distribution domain>
```

### 2.4 `admin.vedhicfoods.com` — admin portal

```yaml
Type: A
Name: admin.vedhicfoods.com
AliasTarget:
  DNSName:      <admin distribution domain>
  HostedZoneId: Z2FDTNDATAQYW2
```

Keep the admin portal on its **own origin**. Served from the storefront origin, any
XSS on the public site would also inherit admin session reach. Two origins means two
entries in the backend CORS allowlist and two in the S3 CORS rule — the admin one is
required, because it is the admin portal that requests presigned image-upload URLs.

### 2.5 Mail and third-party DNS

Not created by this stack, and unrelated to the API:

- **SES domain verification** for `vedhicfoods.com` — the DKIM CNAMEs and SPF TXT
  record SES prints. Without these, `EMAIL_PROVIDER=ses` cannot send and the app
  drops transactional mail. SES is also in the sandbox until production access is
  granted, and while sandboxed it will only send *to* verified addresses.
- **Razorpay webhook** — Razorpay calls back to
  `https://api.vedhicfoods.com/api/v1/payments/razorpay/webhook`. Configure it in the Razorpay
  dashboard; there is no DNS record for it. The path is inside `/api/*`, so the
  existing listener rule forwards it with no change.

  The `/razorpay/` segment is part of the path. It is declared once as
  `RAZORPAY_WEBHOOK_PATH` in `backend/src/utils/raw-body.ts`, and that constant is
  what gates raw-body capture for HMAC signature verification — so a webhook
  configured at `/api/v1/payments/webhook` is not merely a 404. The browser-side
  `/razorpay/verify` call is only the secondary confirmation path, so orders would
  silently sit unpaid. Check the value pasted into the Razorpay dashboard against
  the constant before going live.

### 2.6 Records that must NOT exist

- No `A`/`AAAA` for `api.vedhicfoods.com` pointing anywhere other than the ALB.
- No wildcard `*` DNS record. A wildcard certificate on the CDN plus a wildcard DNS
  record means any name under the domain presents a trusted certificate for a
  distribution you did not intend.
- No DNS record may leave the S3 media bucket publicly reachable. Product imagery and
  customer invoices are served through CloudFront with Origin Access Control; see
  `AWS_DEPLOYMENT.md` §4.2.

---

## 3. CORS

The production allowlist is **exactly two origins**, both `https`:

| Variable | Value | Applies to |
| --- | --- | --- |
| `FRONTEND_URL` | `https://vedhicfoods.com` | storefront |
| `ADMIN_FRONTEND_URL` | `https://admin.vedhicfoods.com` | admin portal |

Set in `backend/infra/ecs-task-definition.json`. `buildAllowedOrigins()` in
`src/app.ts` adds **nothing** in production — no wildcard, no localhost fallbacks —
and a request whose `Origin` is not on the list is denied silently rather than
throwing, so the error handler cannot be used to enumerate valid origins.

`src/config/env.ts` refuses to boot when either value is:

- not `https://` — a plaintext origin is the same-origin boundary removed;
- `*` — a wildcard with `credentials: true` hands every site on the internet
  authenticated cross-origin access;
- a loopback or reserved host (`*.example`, `*.invalid`, `*.test`, `*.localhost`) —
  these pass the `https` check but can never resolve, and the resulting failure is
  silent: the storefront loads, CORS passes, and every write is discarded. This is
  not hypothetical: `vedhifoods.example` was the shipped value in
  `frontend/src/config/site.ts` while this was unconfigured.

### S3 bucket CORS — a separate rule, easy to miss

The browser uploads product images straight to S3 with a presigned `PUT`. A
presigned URL authorises the request, but the browser still enforces CORS on the
**response**. Without this rule the upload succeeds server-side and the admin page
cannot read the result — the image appears to fail while it actually saved.

`backend/infra/s3-cors.json` lists the storefront, www alias, and admin portal as
complete HTTPS origins. S3 matches these against the browser's `Origin` header;
keep the scheme and host in sync with the production frontend URLs.

```bash
aws s3api put-bucket-cors \
  --bucket vedhifoods-media-production \
  --cors-configuration file://backend/infra/s3-cors.json
```

---

## 4. Environments

| | development | test | staging | production |
| --- | --- | --- | --- | --- |
| Backend template | `.env.development.example` | `.env.test.example` | `.env.staging.example` | `.env.production.example` |
| `NODE_ENV` | `development` | `test` | `staging` | `production` |
| Origin enforcement | configured + localhost | configured + localhost | configured only | configured only, `https` mandatory |
| `TRUST_PROXY` | `false` | `false` | `1` | `1` |
| `REDIS_URL` | unset (in-process) | unset (in-process) | required | **required** |
| Email | `auto` → Brevo | simulated | `auto` | `ses` |
| Razorpay | test keys | test keys | **test keys** | **live keys** |
| Database | local | disposable local | separate instance | RDS production |

`src/config/env.ts` loads `.env.<environment>` first and `.env` second, because
`dotenv` never overwrites a variable that is already set — so whichever file is read
first wins, and the environment-specific file has to be it. Anything exported by the
platform (ECS task definition, CI, `docker run -e`) beats both, which is how a
deployed task overrides a baked-in value. The boot log reports which files were
read, by name only.

Fail-closed by construction: an unset `NODE_ENV` resolves to `development`, so a
deployed task that forgot it loads the *development* files, finds none of the
production secrets, and exits rather than serving defaults to the internet.

### Copying a template

```powershell
Copy-Item backend\.env.development.example backend\.env.development
```

Real files stay untracked (root `.gitignore` re-admits only `*.example`).

---

## 5. Frontend production API URL

`frontend/.env.production` and `admin/.env.production`, both **tracked in git**:

```
VITE_API_URL=https://api.vedhicfoods.com/api/v1
```

Tracked deliberately. `VITE_*` is inlined into the bundle at build time and is public
by construction, so there is no secret to leak. Tracking the file is what prevents a
deploy that forgets to export the variable from shipping a site pointed at
`http://localhost:5000` — which loads, renders, shows a catalogue, and then fails on
login, cart, checkout and payment.

Three guards enforce it:

1. `frontend/vite.config.ts` and `admin/vite.config.ts` **fail the build** when
   `VITE_API_URL` is missing, non-`https`, loopback, a reserved name, or missing the
   `/api/v1` prefix.
2. `src/services/http.ts` in both apps refuses at runtime in a production bundle.
3. `frontend/.env.example` documents it.

The build guard caught a real instance of this during setup: the local
`frontend/.env` (`VITE_API_URL=http://localhost:5000/api/v1`) is loaded by
`loadEnv` even in production mode, so a build on a developer machine picks it up in
preference to nothing and would have shipped a plaintext localhost bundle.

---

## 6. Deployment order

The ordering matters: several steps fail confusingly if run out of sequence.

### 6.1 Pre-flight (no AWS calls)

```powershell
powershell -ExecutionPolicy Bypass -File backend\infra\validate-task-definition.ps1
```

Exits non-zero while any `REPLACE_ME` marker remains. Currently expected to fail on
19 markers, all of which are genuinely account-specific: account id, region, IAM role
ARNs, image URI, log group, S3 bucket, SES sender, Redis URL and seven secret ARNs.
`FRONTEND_URL` and `ADMIN_FRONTEND_URL` are **no longer placeholders** — they are
pinned to the real production origins.

```bash
aws cloudformation validate-template \
  --template-body file://backend/infra/cloudformation/vedhicfoods-edge.yaml
```

### 6.2 Secrets (before any task starts)

Create all seven secrets idempotently with the helper script — one command,
nothing hand-typed, no values in this file or in the task definition:

```powershell
powershell -ExecutionPolicy Bypass -File backend\infra\scripts\create-secrets.ps1
```

The seven secrets, under the `vedhicfoods/backend/` prefix:
`DATABASE_URL`, `JWT_SECRET`, `ENCRYPTION_KEY`, `RAZORPAY_KEY_ID`,
`RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `BREVO_API_KEY`.

Generate, never invent: `openssl rand -base64 48` (the script also generates
`JWT_SECRET`/`ENCRYPTION_KEY` from a CSPRNG when not supplied).

> `ENCRYPTION_KEY` rotation is **not** self-service. Stored payment credentials are
> AES-256-GCM encrypted under this single key and the ciphertext carries no key
> version. Rotating without first decrypting with the old key and re-encrypting with
> the new one makes those credentials permanently unreadable, which disables online
> payment for the business. Add key versioning to the ciphertext before the first
> rotation.

### 6.3 Edge stack

```bash
aws cloudformation deploy \
  --template-file backend/infra/cloudformation/vedhicfoods-edge.yaml \
  --stack-name vedhicfoods-edge \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
      HostedZoneId=Z1D633PJN98FT9 \
      ApiDomainName=api.vedhicfoods.com \
      PublicSubnetIds=subnet-aaaa,subnet-bbbb \
      TaskSecurityGroupId=sg-0task \
      LogBucketName=vedhicfoods-alb-logs
```

Record the outputs — `LoadBalancerDnsName`, `LoadBalancerCanonicalHostedZoneId`,
`ApiCertificateArn`, `TargetGroupArn`. The certificate takes a minute or two to
issue; watch it rather than assuming:

```bash
aws acm describe-certificate --certificate-arn <ApiCertificateArn> \
  --query 'Certificate.Status'
```

### 6.4 Database, storage, email

`prisma migrate deploy` as a **separate one-off task**, never on every task start —
six tasks migrating concurrently race. See `AWS_DEPLOYMENT.md` §3. Then S3 CORS
(§3 above) and SES domain verification (§2.5).

### 6.5 Service

```bash
docker build -f backend/Dockerfile -t ACCOUNT.dkr.ecr.REGION.amazonaws.com/vedhicfoods-backend:latest .
docker push ACCOUNT.dkr.ecr.REGION.amazonaws.com/vedhicfoods-backend:latest

aws ecs register-task-definition --cli-input-json file://backend/infra/ecs-task-definition.json
aws ecs update-service --cluster vedhicfoods --service vedhicfoods-backend \
  --task-definition vedhicfoods-backend:REVISION
aws ecs wait services-stable --cluster vedhicfoods --services vedhicfoods-backend
```

### 6.6 Frontends

```powershell
npm run build --prefix frontend   # reads frontend/.env.production
npm run build --prefix admin
```

Deploy `frontend/dist` and `admin/dist` to their hosts, then run the verification
script below.

---

## 7. Timeout relationships

Getting these wrong produces intermittent 502s that a single `curl` cannot reproduce,
because they only bite on an idle keep-alive socket under real load.

```
ALB idle timeout          120 s   >  KEEP_ALIVE_TIMEOUT_MS    65 s
ALB idle timeout          120 s   >  REQUEST_TIMEOUT_MS       60 s
ALB deregistration delay   90 s   >  ECS stopTimeout          60 s
                                         >  SHUTDOWN_GRACE_MS     25 s
```

The AWS default ALB idle timeout is **60 s**, which is *below* the backend's 65 s
keep-alive. Left at the default the proxy tears down idle sockets the server was
still willing to reuse and the customer sees a 502 for a request that never ran. The
edge template sets 120 s, and
`infra/validate-task-definition.ps1` §5 now fails the pre-flight if the relationship
inverts — the two numbers live in different files that no compiler sees together.

---

## 8. Verification

```powershell
powershell -ExecutionPolicy Bypass -File backend\scripts\verify-production.ps1
```

Read-only. No AWS credentials, no writes, no state change. It covers HTTPS and
certificate validity, the HTTP→HTTPS redirect, HSTS, the health endpoints, CORS
acceptance for both production origins, CORS rejection for a foreign origin, public
catalogue access, and that every administrative and customer-private route answers
`401`/`403` without a token rather than `200`.

Authenticated flows (login, cart, checkout, payment, invoice) are **not** automated —
they need real credentials and real money movement. The script prints the exact
commands for each, to be run manually against a live card.

---

---

## 9. Rolling back a bad deploy

Rollback is only safe because of one design decision: `deploy.yml` runs migrations
as a **separate one-off task before** the service is updated, and ECS performs a
rolling replacement rather than a stop-and-start. So there are two independent
things to undo, and they must be undone in a specific order.

**Decide which one broke first.** Check whether the fault is in the code or the
schema. `SELECT version, applied_at, rolled_back_at FROM _prisma_migrations ORDER BY
finished_at DESC LIMIT 10;` answers it. If the newest migration is the one that
landed with this deploy, you are in case B.

### Case A - the code is bad, the schema is fine

The overwhelmingly common case, and the one that needs no ceremony.

1. **Redeploy the previous image.** Re-run `Deploy` from the commit *before* the bad
   one (`workflow_dispatch` on that SHA, or roll back the task definition
   revision). Do not edit the service by hand.
2. **Leave the database alone.** The migration already applied is backward
   compatible by the expand-and-contract rule, so the old code still runs against
   the new schema.
3. **Confirm recovery** before closing the incident: `Invoke-RestMethod
   https://api.vedhicfoods.com/api/v1/health/ready` returns `status: healthy`, and
   the CloudWatch `error-ratio` alarm returns to `OK`.

Reversing a migration is **not** supported. There is no `prisma migrate down`, and
adding one would be worse than useless - it cannot undo data that was written while
the new schema was live. This is precisely why the migration ordering in section 6 is
expand-and-contract: it is what keeps rollback a code-only operation.

### Case B - the migration itself is the fault

Take the instance out of MultiAZ serving first, or you will restore a standby that
was not the source of the bad write.

```powershell
# 1. Freeze writes. Scale to zero so nothing writes while you recover.
aws ecs update-service --cluster $ECS_CLUSTER --service $ECS_SERVICE --desired-count 0

# 2. Restore the database to the last snapshot taken BEFORE the bad migration.
#    `RestoreType: copy-on-write` keeps the original instance recoverable.
aws rds restore-db-instance-from-db-snapshot `
  --db-instance-identifier vedhicfoods-restored `
  --db-snapshot-identifier <snapshot-id> `
  --db-subnet-group-name <subnet-group> `
  --multi-az --no-deletion-protection `
  --restore-type copy-on-write

# 3. Swap the endpoint. Prefer updating the secret over editing the task definition.
#    Never repoint production by hand-editing a task definition revision you did
#    not register.
```

Because the database is a CloudFormation resource, a restore that creates a *new*
instance leaves the stack pointing at the old one. Either restore over the same
identifier (destroys the original) or re-import the restored instance. Decide which
before you start - see section 10.

### What you cannot roll back

- **Data written under the bad deploy.** Restoring the database discards it. Take a
  manual snapshot *before* any restore so the evidence survives the recovery.
- **External side effects.** Razorpay charges, sent email, and S3 objects created by
  the bad build are not undone by rolling back code. Reconcile payments by hand
  against the Razorpay dashboard; do not assume a database rollback reverses a charge.
- **Already-delivered mail.** There is no unsend.

---

## 10. Database recovery (PITR)

`vedhicfoods-database.yaml` sets a 35-day `BackupRetentionPeriod` with automatic
backups and storage autoscaling. Point-in-time recovery replays WAL from the most
recent snapshot, so the recoverable window is seconds, not days - as long as the
retention period has not lapsed.

```powershell
# Earliest restorable time. Anything older than this is NOT recoverable.
aws rds describe-db-instances --db-instance-identifier <id> `
  --query 'DBInstances[0].EarliestRestorableTime'

# Snapshots currently retained.
aws rds describe-db-snapshots --db-snapshot-identifier <stack>-* --query 'DBSnapshots[*].[DBSnapshotIdentifier,SnapshotCreateTime]'
```

**PITR procedure.** Same shape as case B above: freeze writes, restore to a new
identifier with `--use-latest-restorable-time` (or an explicit
`--restore-type` timestamp), validate, then swap. Two details that are easy to get
wrong:

1. **Restore is slow and PITR restores take longer than snapshot restores** - expect
   tens of minutes, not minutes. The instance is created `multi-az`, so the standby
   is built too.
2. **`DeletionPolicy: Retain` is on the database.** A `aws cloudformation delete-stack`
   will therefore *not* delete the instance. That is deliberate - it is what stops a
   stack rollback from destroying production data - but it means a stack delete
   leaves a running, billed, still-reachable database. Delete it explicitly, once
   you are certain.

### 10.1 Validating a restored database

Do not point production at it until all of these pass. A restored database is
structurally complete and may still be logically wrong.

```powershell
$env:DATABASE_URL = '<restored-url>'
npm run prisma:validate                 # schema matches the code
npm run prisma:status                  # no failed/pending migration
npx prisma migrate diff `
  --from-url $env:DATABASE_URL `
  --to-schema-datamodel database/prisma/schema.prisma `
  --exit-code                          # non-zero => drift; investigate before cutover
```

Then confirm row counts are plausible against the pre-incident figure, that the most
recent orders and payments are present, and that `select count(*) from "User"` is not
zero. A restore that silently came up short is worse than an outage, because it looks
healthy.

---

## 11. Responding to alarms

`vedhicfoods-monitoring.yaml` publishes to one SNS topic and one alarm per
subsystem. The alarm name identifies the cause; this table is the first five minutes.

| Alarm | Usual cause | First action |
| --- | --- | --- |
| `healthy-host-count` | Tasks crash-looping; image or env broken | `aws ecs describe-services` then the task's stopped-reason |
| `error-ratio` | Partial outage, or a bad deploy | Compare the deploy timestamp to the alarm timestamp first |
| `application-error-spike` | Unhandled exceptions in one route | Filter the app log group on `level=error` |
| `payment-failure` / `payment-security` | Razorpay misconfigured, or an attack | Do **not** retry blindly; check for duplicate charge risk |
| `email-failure` | SES identity or quota | A task that cannot send mail will not boot in production by design |
| `ecs-cpu` / `ecs-memory` | Memory trending up usually means an OOM kill is imminent | Scale out, then find the leak |
| `alb-p99-latency` | Usually the database | Cross-check `rds-cpu` and `rds-connections` |
| `rds-*` | Database saturation or failover | Check for a failover before assuming load |

The admin portal shows backend and database status directly on the dashboard
(`BackendConnectionCard` and `SessionDetailsCard`), so an operator can confirm the
API and database are reachable without opening CloudWatch.

### 11.1 When the database is the problem

`rds-connections` near `max_connections` (200, set in the parameter group) means the
pool, not the queries, is the constraint. Raise `max_connections` only with headroom
on the instance class - oversubscribing memory turns a clean pool error into an OOM.
`rds-storage` alarms during growth are expected; investigate the *rate*, because
storage autoscaling has a 24-hour floor and cannot rescue a run-away insert.

### 11.2 When Redis is the problem (the rate limiter fails closed)

**Decision: fail closed.** If the shared rate-limit store is unreachable, every
request except the two health probes is rejected with `503 SERVICE_UNAVAILABLE`
rather than being allowed through. `express-rate-limit` has no shared memory of
its own: with the store gone, each instance would fall back to counting on its
own, so a 20-per-15-minute login budget becomes `20 x replica count` — exactly
when an attacker is most likely to be trying it. An outage of a protective
control does not justify disabling it, so availability yields to enforcement.
The alternative (`passOnStoreError: true`, i.e. fail open) is a one-line change
and is *not* the current posture; switching to it is a security decision, not a
troubleshooting step.

**What it looks like.**

| Signal | Value |
| --- | --- |
| `GET /api/v1/health` | `200` — the process is fine, and health probes are exempt from the limiter |
| `GET /api/v1/health/ready` | `200` with `"status":"degraded"` and `"checks":{"rateLimiter":"disconnected"}` |
| Any other `/api/v1/*` | `503` with `code: SERVICE_UNAVAILABLE`, returned in ~1s (the bounded command timeout) |
| App log (once, not per request) | `[rate-limit] Redis store unavailable; requests now fail closed with 503 until it recovers` |
| App log on recovery | `[rate-limit] Redis store recovered; distributed rate limiting resumed` |

`degraded` still answers `200` on purpose: the instance is healthy and the load
balancer should keep serving it. Only `"status":"unhealthy"` (no database) pulls
it from rotation — otherwise one broken dependency would take the whole fleet
out.

**Confirm before anything else.**

```bash
# Is Redis itself up?
redis-cli -u "$REDIS_URL" PING          # expect PONG

# Is it only this task?
aws ecs execute-command --cluster "$CLUSTER" --task "$TASK" \
  --container backend --interactive --command "/bin/sh"
```

**Recovery.** Nothing to do on the application side: the client retries with
exponential backoff and the limiter re-arms the moment a command succeeds — no
restart and no connection state to clear. Restore Redis, watch for the
`recovered` log line, then re-check readiness.

**Detection gap.** `vedhicfoods-monitoring.yaml` has no Redis alarm (ElastiCache
is managed outside the stack), so this condition is currently silent unless
someone reads readiness. Add an alarm on the ALB 503 target-response count, or
on `checks.rateLimiter == "disconnected"` in the readiness payload.

---

## What is NOT verified

Stated plainly, because none of this can be true from the authoring environment.

- **No AWS account was contacted.** No stack was created, no certificate requested,
  no DNS record written, no IAM role attached, no SES identity verified. Every
  template here is validated but **undeployed**.
- **Docker is not installed.** The image has never been built.
- **`aws cloudformation validate-template` was never run**, because the AWS CLI is
  absent. This is now materially less of a gap than it looks: all three templates
  were run through `cfn-lint` against the `ap-south-1` schema and are clean at
  **0 errors, 0 warnings**, which covers property names, types and required
  properties - the same classes of defect `validate-template` catches. What remains
  uncovered is *runtime* validation (resource-level API semantics such as whether a
  named parameter group family exists in the chosen region).
- **The integration suites have never been run against a live database here.** They
  run in CI against a Postgres service container; locally only the guard's verdict
  on the CI URL was confirmed.
- **No live health endpoint was contacted.** `/api/v1/health` and
  `/api/v1/health/ready` are covered by the existing integration suite against a
  local database; they have never been reached through a load balancer.
- **No CORS behaviour was observed in production.** The allowlist logic is unit
  tested, but an `Origin` header round-trip through the real ALB has not been seen.
- **No payment was taken.** Razorpay live keys, webhook signature verification and
  invoice generation through the ALB are unverified end to end.
- **The monitoring template's log filter patterns are unproven against real log
  lines.** They are syntactically valid and match the pino shape, but a metric
  filter that never matches is indistinguishable from one that has not fired. Check
  each filter produced data before trusting the alarms in section 11.
- **The deploy workflow has never executed.** It is structurally valid and its
  credential handling is verified by inspection, but GitHub Actions expression
  semantics (the `workflow_run` gate, the pinned `head_sha`) are unproven until a
  real run.
- **Storefront and admin are not deployed by `deploy.yml`.** It ships the backend
  image only. Publishing the two static bundles is a separate, still-unbuilt step.

What *was* executed here: `cfn-lint` clean across all three CloudFormation templates;
the frontend, admin, database and backend builds; the backend unit suite (100) and
the admin suite (38); `oxlint` clean (warnings only) in all three packages; Prisma
generate and validate; and the verification pre-flight.

---

## Follow-ups not addressed here

- **Storefront and admin are never published.** `deploy.yml` builds and rolls the
  backend image only. Nothing uploads either static bundle, so a green deploy still
  leaves the two frontends on whatever CDN revision was last uploaded by hand. This
  is the largest remaining gap in the pipeline.
- **The PostgreSQL parameter group family needs confirming per region.**
  `Family` is built as `postgres${DatabaseEngineVersion}`; if that yields
  `postgres16.4` rather than `postgres16`, stack creation fails. Verify with
  `aws rds describe-db-engine-versions --engine postgres` before the first deploy.
- **`MaxAllocatedStorage` equals the initial allocation**, so storage autoscaling
  currently has no headroom. Give it real headroom or drop the autoscaling block.
- **ALB egress is unrestricted.** The edge stack creates the ALB security group with
  an explicit egress rule to the task group only, but the task group is passed in and
  its egress is left at the AWS default (allow all). Locking it to 5432, 6379, 443
  and SMTP requires the RDS/Redis security group IDs, which live outside this stack.
- **No WAF.** A WAF regional web ACL with the managed rule groups in front of this
  ALB would blunt credential-stuffing and injection attempts before they reach the
  rate limiter. The rate limiter is the current control and is per-IP, which is not
  the same thing.
- **`S3Service.buildPublicUrl`** constructs a direct bucket URL unless
  `AWS_S3_PUBLIC_BASE_URL` is set to the CloudFront distribution origin; set it so
  product images and invoices resolve through the OAC distribution. See
  `AWS_DEPLOYMENT.md` §4.4.
- **`admin/src/data/admin.ts`** now holds only the `PERMISSIONS` catalogue (the
  slugs seeded by `database/seed.ts` and enforced by `requirePermission`). The
  placeholder staff rows and the former `frontend/src/data/admin.ts` are gone, so
  the admin console renders no sample operators.
