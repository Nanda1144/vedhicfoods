# VEDHIC FOODS — Database Layer (`database/`)

Comprehensive PostgreSQL database architecture, Prisma schemas, seed scripts, and migration documentation for **Vedhic Foods**.

---

## 1. Architecture Design

The database layer targets **PostgreSQL 15+** and is provider-agnostic. The
managed deployment uses **Supabase PostgreSQL**; the CloudFormation RDS template
provisions a self-managed `ap-south-1` (Mumbai) alternative with Postgres 16.4,
and local development uses the loopback `postgres:16` from
`backend/docker-compose.yml`. Both managed paths are backed up with the standard
client tools (`pg_dump`); see [Automated backups](#5-automated-backups-to-amazon-s3).

```mermaid
erDiagram
    User ||--o{ Order : places
    User ||--o{ Address : has
    Order ||--|{ OrderItem : contains
    Product ||--o{ OrderItem : references
    Category ||--o{ Product : categorizes
    Product ||--o{ ProductImage : includes

    User {
        string id PK
        string email UK
        string phone
        string fullName
        string passwordHash
        enum role "ADMIN, STAFF, CUSTOMER"
        boolean isActive
    }

    Category {
        string id PK
        string slug UK
        string name
        string tagline
        string image
        string accent
        boolean featured
    }

    Product {
        string id PK
        string slug UK
        string name
        string categoryId FK
        float price
        float mrp
        int stock
        string sku UK
        float rating
        boolean isOrganic
        boolean isFeatured
        boolean isActive
    }

    Order {
        string id PK
        string orderNumber UK
        string userId FK
        float subtotal
        float shipping
        float tax
        float total
        enum status
        enum paymentStatus
        enum paymentMethod
        string invoiceId
    }

    PaymentSettings {
        string id PK
        string provider
        string razorpayKeyId
        string encryptedKeySecret
        string encryptedWebhookSecret
        string[] enabledMethods
        boolean testMode
        boolean codEnabled
    }
```

### Direct Session vs Connection Pooling

| Connection Mode | Port | Target Use Case | Prepared Statements |
|---|---|---|---|
| **Direct Session** | `5432` | Schema migrations, DDL updates (`prisma migrate deploy`), seeding scripts | Full support (`PREPARE`, `EXECUTE`) |
| **PgBouncer Pooler** | `6543` | High-concurrency runtime API traffic | Session-less transaction pooling |

---

## 2. Directory Contents

`database/` is an npm workspace package (`vedhicfoods-database`) and the single
source of truth for the schema, migrations, seed data and the shared Prisma
client. The backend consumes it as a dependency instead of keeping its own copy.

```
database/
├── prisma/
│   ├── schema.prisma     # Master Prisma schema (44 models) - the ONLY schema
│   └── migrations/       # Authoritative migration history (14 migrations)
├── scripts/
│   └── backup-to-s3.mjs  # pg_dump -> S3 backup with retention (see section 5)
├── client.ts             # PrismaClient singleton (single instance per process)
├── encryption.ts         # Shared AES-256-GCM helpers (encrypt32/decrypt32/maskSecret)
├── index.ts              # Package entrypoint re-exporting client, crypto and @prisma/client
├── seed.ts               # Standalone seeder (roles, permissions, catalogue, settings)
├── dev-catalog-seed.ts   # Optional local catalogue fixtures
├── tsconfig.json         # Builds the package to dist/
├── package.json          # Build + Prisma scripts
└── README.md             # Architecture, schema guide, and execution steps
```

> Migrations live **inside** `prisma/` because Prisma resolves the migrations
> directory relative to the schema file.

---

## 3. Data Dictionary

| Table | Description |
|---|---|
| `users` | Administrator, Staff, and Customer accounts with bcrypt password hashes. |
| `roles` / `permissions` / role-permission joins | RBAC definitions, including the `support.*` and `contacts.*` permissions. |
| `categories` | Product collections (Spices, Ghee & Oils, Millets & Grains, Sweeteners, etc.). |
| `products` | Product catalog with selling price, MRP, stock count, nutrition data, and badges. |
| `product_images` | Gallery images per product with display ordering. |
| `addresses` | Customer delivery addresses with pin code validation. |
| `orders` | Customer orders, totals, fulfillment status, and payment flags. |
| `order_items` | Snapshot of ordered products preserving historical prices. |
| `inventories` / `inventory_logs` | Authoritative stock levels, reservations and movement audit trail. |
| `carts` / `cart_items` | Server-side cart backing the Cart -> Checkout workflow. |
| `coupons` / `discount_coupons` usage | Promo codes with discount percentage/fixed amount and usage counters. |
| `payments` | Payment lifecycle records (Razorpay order id, status, amount). |
| `payment_settings` | Razorpay credentials encrypted with 32-byte AES-256-GCM. |
| `system_settings` | Key-value application configurations. |
| `contact_submissions` | Customer Contact form submissions with triage state. |
| `support_tickets` / `support_messages` / `support_attachments` | Customer Support ticket thread, internal notes and attachments. |
| `support_notifications` | Support notification delivery state. |

---

## 4. Step-by-Step Execution Guide

### Prerequisites
* Node.js >= 20.x
* PostgreSQL 15+ database URL

### Step 1: Install Dependencies
Install from the **repository root** so the workspace links are created:
```bash
npm install
```

### Step 2: Configure Environment
Create or verify `database/.env` (gitignored). For the loopback PostgreSQL in
`backend/docker-compose.yml`, match its `POSTGRES_USER` / `POSTGRES_PASSWORD`:
```env
DATABASE_URL="postgresql://vedhi_admin:POSTGRES_PASSWORD@localhost:5432/vedhicfoods?sslmode=disable"
ENCRYPTION_KEY="(generate one — see below)"
```
Generate, never copy, the `ENCRYPTION_KEY` (`openssl rand -base64 48`), and keep
it ≥ 32 chars — `backend/src/config/env.ts` enforces that in production and
rejects placeholder values. In production the value comes from AWS Secrets
Manager (`vedhicfoods/backend/ENCRYPTION_KEY`), never from a committed file.

### Step 3: Build the Package
```bash
npm run build:database
```
Generates the Prisma client from `prisma/schema.prisma` and compiles the package
to `dist/`, which is what the backend imports.

### Step 4: Validate Schema and Migration Status
```bash
npm run prisma:validate
npm run prisma:status
```
Always inspect status before applying anything. Migrations are the source of
truth for schema changes - do **not** use `prisma db push` against production.

### Step 5: Apply Migrations (when intentionally deploying)
```bash
npm run prisma:deploy
```

### Step 6: Seed Foundation Data
```bash
npm run prisma:seed
```
Seeds roles/permissions, the administrator user, encrypted payment settings and
the product catalogue. Safe to re-run.

### Step 7: Launch Database GUI (Prisma Studio)
```bash
npm run prisma:studio
```
Opens Prisma Studio web interface at `http://localhost:5555`.

---

## 5. Automated backups to Amazon S3

`database/scripts/backup-to-s3.mjs` is a dependency-free Node script (standard
library only) that:

1. runs `pg_dump` against `DATABASE_URL` in PostgreSQL **custom format**
   (`-Fc`). Custom format is already compressed by `pg_dump`, so no separate
   gzip pass runs for it; a plain-text dump (`BACKUP_FORMAT=plain`) is piped
   through gzip unless compression is disabled;
2. validates the archive with `pg_restore --list` before uploading, so a
   truncated dump fails here instead of at restore time;
3. uploads it to `s3://BACKUP_S3_BUCKET/BACKUP_S3_PREFIX/` with the AWS CLI and
   re-reads the object metadata to confirm the uploaded byte count matches the
   local file;
4. deletes backups under the prefix older than `BACKUP_RETENTION_DAYS`.

It fails loudly (non-zero exit, timestamped log line) on any error and never
places the database password on a command line - `pg_dump` receives it through
`PGPASSWORD`.

It is scheduled by [`.github/workflows/db-backup.yml`](../.github/workflows/db-backup.yml),
which runs daily at 19:00 UTC (00:30 IST) and can also be dispatched manually.

**It runs inside the VPC.** The production database is not publicly reachable and
this repository provisions no bastion, so a GitHub-hosted runner cannot reach it.
The workflow therefore builds `database/backup.Dockerfile` (postgresql-client +
AWS CLI + this script) and runs it as a **Fargate one-off task** in the same
cluster, subnets and security group as the service - the same private path the
migration task uses. `DATABASE_URL` is injected by the backup task definition's
`secrets` block and never touches the runner.

### Configuration

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | yes* | - | PostgreSQL connection string. Use the direct (5432) or session-pooler string, never the transaction pooler (6543). In the workflow this is injected by the task definition, not set on the runner. |
| `BACKUP_DATABASE_URL` | no | - | Overrides `DATABASE_URL` for the backup only. |
| `BACKUP_S3_BUCKET` | yes | - | Destination bucket. Use a dedicated, versioned, encrypted, non-public bucket - not the media bucket. |
| `BACKUP_S3_PREFIX` | no | `database-backups/` | Key prefix; a trailing slash is added if missing. |
| `BACKUP_RETENTION_DAYS` | no | `30` | Delete backups older than this. `0` disables retention. |
| `BACKUP_FORMAT` | no | `custom` | `custom` (`-Fc`, restorable with `pg_restore`) or `plain`. |
| `BACKUP_COMPRESS` | no | `true` | Gzip a `plain` dump. Ignored for `custom` (already compressed). |
| `BACKUP_AWS_REGION` / `AWS_REGION` | no | AWS CLI default | Region for every `aws` call. |
| `BACKUP_DRY_RUN` | no | `false` | Dump and validate only; skip upload and retention. |
| `PG_DUMP` / `PG_RESTORE` / `AWS_CLI` | no | `pg_dump` / `pg_restore` / `aws` | Binary path overrides. |

\* Set either `DATABASE_URL` or `BACKUP_DATABASE_URL`; the script exits 1 if
neither is present.

### GitHub Actions setup

Set these repository **variables** (Settings -> Secrets and variables -> Actions
-> Variables; none is confidential). No GitHub secret is needed: the database
credential stays in AWS Secrets Manager and is injected into the task.

| Variable | Purpose |
|---|---|
| `AWS_REGION` | Region for the OIDC session and every `aws` call. |
| `AWS_BACKUP_ROLE_ARN` | OIDC role the workflow assumes. It pushes the backup image to ECR (`ecr:GetAuthorizationToken`, `BatchCheckLayerAvailability`, `InitiateLayerUpload`, `UploadLayerPart`, `CompleteLayerUpload`, `PutImage`), runs the task (`ecs:RunTask`, `ecs:DescribeTasks`, `ecs:DescribeTaskDefinition`) and passes the task's execution/task roles (`iam:PassRole`). It no longer needs `secretsmanager:GetSecretValue`. |
| `ECR_REGISTRY` | ECR registry endpoints, e.g. `<account>.dkr.ecr.<region>.amazonaws.com`. |
| `ECR_REPOSITORY` | ECR repo the backup image is pushed to (distinct `backup-<sha>` tag). |
| `ECS_CLUSTER_NAME` | Cluster the one-off backup task runs in. |
| `ECS_BACKUP_TASK_DEFINITION` | Backup task definition family: private VPC subnets, `DATABASE_URL` in its `secrets` block, and a task role scoped to the backup bucket (`s3:PutObject`, `s3:GetObject`, `s3:ListBucket`, `s3:DeleteObject`, `s3:AbortMultipartUpload`). |
| `PRIVATE_SUBNET_IDS` | Comma-separated private subnet ids for the task's awsvpc config. |
| `TASK_SECURITY_GROUP_ID` | Security group with egress to the database and S3. |
| `BACKUP_S3_BUCKET` | Destination bucket. |
| `BACKUP_S3_PREFIX` | Optional key prefix. |
| `BACKUP_RETENTION_DAYS` | Optional retention (default 30). |

The backup role needs an OIDC trust policy like the deploy role's (see
`backend/infra/README.md`), scoped to this repository and to the branch the
schedule runs on (the default branch). As an alternative to script retention you
can attach an S3 lifecycle rule to expire objects under the prefix; the two are
independent and either alone is sufficient.

### Restoring a backup

```bash
# Custom format
pg_restore --clean --if-exists --no-owner --dbname "$DATABASE_URL" vedhicfoods-YYYYMMDDTHHMMSSZ.dump

# Plain / gzipped format
gunzip -c vedhicfoods-YYYYMMDDTHHMMSSZ.sql.gz | psql "$DATABASE_URL"
```

Validate a restore before repointing production at it, exactly as in
`backend/PRODUCTION_RUNBOOK.md` section 10.1 (`prisma validate`, `prisma status`,
`prisma migrate diff --exit-code`).

### Supabase notes

`pg_dump` from the standard client tools is Supabase's supported export path; the
client major version must be >= the server's. Supabase **PITR** is a separate,
complementary control - it restores the whole instance to a moment and lives with
the provider, whereas this pipeline produces a logical dump you own and can keep
off-provider. Run both; do not treat them as substitutes. (On the self-managed
RDS path, `vedhicfoods-database.yaml` sets a 35-day `BackupRetentionPeriod` for
the same reason.)

---

## 6. TODO & Next Milestones

- [x] Create automated daily database backup script to Amazon S3 - see section 5.
- [ ] Add database read-replica routing configuration for high-traffic read operations.
- [ ] Implement database table partitioning for historical orders.
- [ ] Add PostgreSQL Full-Text Search (tsvector/tsquery) indexes on product names and descriptions.
- [ ] Configure row-level security (RLS) policies for multi-tenant isolation.
