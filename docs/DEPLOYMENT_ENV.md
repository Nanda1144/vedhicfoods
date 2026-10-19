# Environment Variables — What to Set Where

This repo contains many `*.env*` files. Only a few matter, and **none of them are
uploaded to a hosting provider**. Vercel and Render take variables one by one in
their dashboards. The files exist to tell you the *names* of the variables and
their shape.

For every deploy there are two questions:

1. **Which file do I copy the key names from?**
2. **What value goes in each key for my environment?**

---

## TL;DR table

| Service | Host | Copy key names from | Where to type them |
| --- | --- | --- | --- |
| Storefront | Vercel | `frontend/.env.production` | Vercel → Project → Settings → Environment Variables (Production) |
| Admin portal | Vercel | `admin/.env.production` | Vercel → Project → Settings → Environment Variables (Production) |
| API | Render | `backend/.env.production.example` | Render → service → Environment |
| Database | not deployed | `database/.env` (local only) | — (paste `DATABASE_URL` into Render) |

**Never deploy:** `.env.test`, `.env.test.example` (tests), `.env.staging*`
(only if you create a staging environment), and any `*.example` file (a template).

---

## 1. Storefront (Vercel)

Reference file: `frontend/.env.production`.

Set these three variables (Production scope):

| Variable | Value |
| --- | --- |
| `VITE_API_URL` | `https://<render-service>.onrender.com/api/v1` |
| `VITE_ENABLE_PRODUCT_FALLBACK` | `false` |
| `VITE_ENABLE_SETTINGS_FALLBACK` | `false` |

- The committed `frontend/.env.production` points at `https://api.vedhicfoods.com/api/v1`.
  A Vercel variable **overrides** that file at build time, which is how you point
  the deployed site at Render without editing committed code.
- `VITE_API_URL` must be `https://`, must end with `/api/v1`, and must not be a
  `localhost` / `*.example` host, or the production build fails on purpose
  (`frontend/vite.config.ts`).
- Everything prefixed `VITE_` is inlined into the JavaScript bundle, so these are
  **public**. Never put a secret here.

## 2. Admin portal (Vercel)

Reference file: `admin/.env.production`. Set:

| Variable | Value |
| --- | --- |
| `VITE_API_URL` | same Render URL as the storefront |

Same build validation applies. The admin portal is a separate origin on purpose;
it must also be listed in the backend's CORS allowlist (see `ADMIN_FRONTEND_URL`
below).

## 3. API (Render)

Reference file: `backend/.env.production.example` (production-shaped) or
`backend/.env.example` (full key list). Render runs your `start` script; it does
**not** read any `.env` file, so every value below must be set in the Render
dashboard.

### Minimum to boot

| Variable | Notes |
| --- | --- |
| `NODE_ENV` | `production` (see the warning below) |
| `PORT` | Render injects this; leave it out or set `5000` |
| `DATABASE_URL` | Your Supabase PostgreSQL URL |
| `JWT_SECRET` | 32+ chars, unique — `openssl rand -base64 48` |
| `ENCRYPTION_KEY` | 32+ chars, unique — encrypts stored Razorpay credentials |
| `FRONTEND_URL` | `https://<storefront>.vercel.app` (https, real host) |
| `ADMIN_FRONTEND_URL` | `https://<admin>.vercel.app` (https, real host) |
| `TRUST_PROXY` | `1` (Render terminates TLS at its own proxy) |

### Required because `NODE_ENV=production`

With `NODE_ENV=production` the app **refuses to start** (`backend/src/config/env.ts`)
unless all of these are real, non-placeholder values:

| Variable | Notes |
| --- | --- |
| `JWT_SECRET`, `ENCRYPTION_KEY` | not the values shipped in `.env.example` |
| `RAZORPAY_WEBHOOK_SECRET` | the real webhook secret |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | `rzp_live_*` (or leave blank to use DB-stored creds) |
| `FRONTEND_URL`, `ADMIN_FRONTEND_URL` | valid `https://` origins, not loopback/reserved |
| `TRUST_PROXY` | must be set (not `false`) |
| `REDIS_URL` | **required in production** — add a Render Key Value (Redis) instance and paste its internal URL |

> If you don't have Redis, live Razorpay keys, or the real domain yet: leave
> `NODE_ENV` unset. The app then runs with development defaults and skips the
> production guard rails, but you still must set `DATABASE_URL` and
> `JWT_SECRET`. Treat this as temporary.

### Media storage (only if you upload product images)

| Variable | Notes |
| --- | --- |
| `AWS_REGION` | e.g. `ap-south-1` |
| `AWS_S3_BUCKET` | your bucket |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Render has no IAM role, so static keys are needed here (unlike ECS) |
| `AWS_S3_PUBLIC_BASE_URL` | CDN origin, or blank for a public bucket |

### Email (optional)

| Variable | Notes |
| --- | --- |
| `EMAIL_PROVIDER` | `brevo` (simplest on Render) or `ses` |
| `BREVO_API_KEY` | required when `EMAIL_PROVIDER=brevo` |
| `BREVO_SENDER_EMAIL` | a verified Brevo sender |

## 4. Database

`database/.env` is **local only** — it is read by `npm run prisma:migrate` and
`npm run prisma:seed` on your machine, pointed at the same Supabase database. It
is not deployed. On Render (and in any migration job you run there) the same
value is set as the `DATABASE_URL` environment variable.

---

## Local development

`backend/.env`, `frontend/.env`, `admin/.env` and `database/.env` are the files
your machine actually reads; they are gitignored and hold local values. Every key
they need is already present.

Backend load order (`backend/src/config/env.ts`), highest priority first:

1. real environment variables (shell, CI, `docker run -e`)
2. `.env.<NODE_ENV>` (e.g. `.env.development`)
3. `.env` (last-resort fallback)

So a real exported variable always beats a file, which is exactly why the same
names work on Render without any file.

---

## File-by-file purpose

| File | Tracked? | Purpose |
| --- | --- | --- |
| `backend/.env` | no | local backend values |
| `backend/.env.example` | yes | full list of backend variable names |
| `backend/.env.development.example` | yes | local development template |
| `backend/.env.production.example` | yes | production key list / values for Render |
| `backend/.env.staging.example` | yes | only if you run a staging environment |
| `backend/.env.test.example` | yes | tests only |
| `frontend/.env`, `admin/.env` | no | local dev values |
| `frontend/.env.example`, `admin/.env.example` | yes | key list |
| `frontend/.env.production`, `admin/.env.production` | yes | committed production default (no secret) |
| `database/.env` | no | local migrations/seed |
| `database/.env.example` | yes | key list |
