/**
 * Integration test bootstrap — safety guard.
 *
 * SECURITY: this file exists to prevent the single most dangerous footgun in
 * this repository's test setup.
 *
 * `backend/.env` points DATABASE_URL at a live Supabase Postgres pooler, and
 * `src/config/env.ts` loads that file into `process.env` via dotenv at import
 * time. The integration suites create and then DELETE users, orders, order
 * items, payments, carts, addresses and products. There was no guard
 * distinguishing a test database from a production one, so a routine
 * `npm test` would mutate production data — and the very tests meant to protect
 * the system would be the thing that damaged it.
 *
 * Every integration suite imports this module first. It resolves the database
 * URL itself (independent of import order) and aborts unless the target is an
 * unambiguously disposable database.
 *
 * Resolution order:
 *   1. TEST_DATABASE_URL  — preferred; must be set for CI
 *   2. DATABASE_URL       — accepted only if it passes the disposable checks
 */

import path from 'path'
import dotenv from 'dotenv'

// Load dotenv the same way src/config/env.ts does — `.env.<environment>` first,
// then `.env` — so this guard inspects the URL the application would actually
// use rather than an unset variable.
//
// The order matters twice over:
//   1. dotenv never overwrites a variable that is already set, so whichever
//      file is read first wins. `.env.test` carries the disposable local
//      DATABASE_URL; reading `.env` (which points at the production pooler)
//      first would pin `DATABASE_URL` to production for the whole process and
//      every subsequent `.env.test` load in src/config/env.ts would be a no-op.
//   2. This module is imported before anything else in every integration file,
//      so it is the thing that decides what `DATABASE_URL` means for the app.
//
// The environment name is resolved exactly as src/config/env.ts resolves it
// (NODE_ENV only, never a dotenv file) so guard and app can never disagree
// about which file is authoritative.
function resolveEnvironmentName(): string {
  const raw = (process.env.NODE_ENV ?? '').trim()
  if (!raw) return 'development'
  return ['development', 'test', 'staging', 'production'].includes(raw) ? raw : 'development'
}

for (const file of [`.env.${resolveEnvironmentName()}`, '.env']) {
  dotenv.config({ path: path.resolve(process.cwd(), file) })
}

const FORBIDDEN_HOST_PATTERNS: RegExp[] = [
  /supabase\.(co|com)/i,
  /rds\.amazonaws\.com/i,
  /\.rds\./i,
  /\.elb\.amazonaws\.com/i,
  /\.compute\.amazonaws\.com/i,
]

/** Words in the host or database name that indicate a live environment. */
const FORBIDDEN_NAME_WORDS = ['prod', 'production', 'live', 'primary', 'main']

/** Hostnames that are unambiguously local throwaway databases. */
const ALLOWED_LOCAL_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  'host.docker.internal',
])

export function assertDisposableTestDatabase(): void {
  const usingTestUrl = Boolean(process.env.TEST_DATABASE_URL)
  const raw = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL

  if (!raw) {
    throw new Error(
      '[test-safety] No database URL available for integration tests.\n' +
        'Set TEST_DATABASE_URL in backend/.env (or the environment) to a disposable ' +
        'test database, e.g. the docker-compose Postgres.'
    )
  }

  // Parse before any error message is produced so a password embedded in the
  // connection string is never echoed into CI logs.
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error('[test-safety] The configured database URL is not a valid connection URL.')
  }

  const { hostname, pathname } = parsed
  const databaseName = pathname.replace(/^\//, '')

  const refuse = (reason: string): never => {
    throw new Error(
      `[test-safety] REFUSING TO RUN INTEGRATION TESTS.\n` +
        `  source      : ${usingTestUrl ? 'TEST_DATABASE_URL' : 'DATABASE_URL'}\n` +
        `  host        : ${hostname}\n` +
        `  database    : ${databaseName}\n` +
        `  reason      : ${reason}\n\n` +
        `These suites issue DELETE / deleteMany against users, orders, payments, ` +
        `carts, addresses and products. Point TEST_DATABASE_URL at a disposable ` +
        `database (a local docker-compose Postgres or a dedicated provider branch) ` +
        `before running them.`
    )
  }

  if (ALLOWED_LOCAL_HOSTS.has(hostname)) {
    return
  }

  for (const pattern of FORBIDDEN_HOST_PATTERNS) {
    if (pattern.test(hostname)) {
      refuse(`"${hostname}" matches a known production/managed-database hostname pattern.`)
    }
  }

  const haystack = `${hostname} ${databaseName}`.toLowerCase()
  for (const word of FORBIDDEN_NAME_WORDS) {
    if (new RegExp(`(^|[^a-z])${word}([^a-z]|$)`).test(haystack)) {
      refuse(`host or database name contains "${word}", which indicates a live environment.`)
    }
  }

  // Unknown remote host: still refuse. An explicit allowlist beats
  // allow-by-omission for a suite that performs destructive operations.
  refuse(
    `"${hostname}" is an unrecognized remote host. Only localhost is accepted by default. ` +
      `If this is genuinely a throwaway test database, add it to ALLOWED_LOCAL_HOSTS ` +
      `in tests/integration/_safety.ts with a comment justifying why.`
  )
}

// Fail fast at import time, before any test file body executes.
assertDisposableTestDatabase()