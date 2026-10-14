# VEDHIC FOODS — Database Layer (`database/`)

Comprehensive PostgreSQL database architecture, Prisma schemas, seed scripts, and migration documentation for **Vedhic Foods**.

---

## 1. Architecture Design

The database layer targets **PostgreSQL 15+** and is provider-agnostic: the
CloudFormation RDS template defaults to `ap-south-1` with Postgres 16.4, while
local development uses the loopback `postgres:16` from
`backend/docker-compose.yml`. Nothing in this repo is wired to Supabase or to
the Tokyo region.

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
│   ├── schema.prisma     # Master Prisma schema (39 models) - the ONLY schema
│   └── migrations/       # Authoritative migration history (8 migrations)
├── client.ts             # PrismaClient singleton (single instance per process)
├── encryption.ts         # Shared AES-256-GCM helpers (encrypt32/decrypt32/maskSecret)
├── index.ts              # Package entrypoint re-exporting client, crypto and @prisma/client
├── seed.ts               # Standalone seeder (roles, permissions, catalogue, settings)
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

## 5. TODO & Next Milestones

- [ ] Create automated daily database backup script to Amazon S3.
- [ ] Add database read-replica routing configuration for high-traffic read operations.
- [ ] Implement database table partitioning for historical orders.
- [ ] Add PostgreSQL Full-Text Search (tsvector/tsquery) indexes on product names and descriptions.
- [ ] Configure row-level security (RLS) policies for multi-tenant isolation.
