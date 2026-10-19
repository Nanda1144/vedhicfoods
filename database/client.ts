import { PrismaClient } from '@prisma/client'

/**
 * The single PrismaClient for the whole platform.
 *
 * Cached on globalThis so `tsx watch` reloads and Vite-driven dev restarts do
 * not open a new connection pool on every reload.
 */
declare global {
  // eslint-disable-next-line no-var
  var __vedhicfoods_prisma: PrismaClient | undefined
}

const isDev = process.env.NODE_ENV === 'development'

function readPositiveInt(name: string): number | undefined {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return undefined
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer, received "${raw}".`)
  }
  return parsed
}

/**
 * PERFORMANCE / MULTI-INSTANCE: size the Prisma connection pool explicitly.
 *
 * Prisma's default pool is `num_cpus * 2 + 1`. That is fine for a single process
 * on a single box and wrong for this deployment: on AWS the API runs as several
 * containers/ECS tasks, each with its own pool, all pointing at one RDS instance
 * or one Supabase pooler. A 64-vCPU task alone opens 129 connections per replica,
 * while `max_connections` on a small instance is commonly 50–100. Under load
 * that produces `FATAL: sorry, too many clients already` — every route 500s at
 * once, a hard outage instead of graceful degradation.
 *
 * Size it as roughly `max_connections / max_instances`, leaving headroom for
 * migrations, seeding and manual operator access. A deliberately small pool
 * also stops one process monopolising server CPU during bursts: queueing a few
 * requests in the app is far cheaper than thrashing an already-saturated
 * database.
 */
const DEFAULT_POOL_SIZE = 5

/**
 * PERFORMANCE: bound connection acquisition and per-query socket time.
 *
 * `connect_timeout` stops a request hanging when the database is unreachable;
 * `socket_timeout` stops one pathological query (an unindexed sort, a `contains`
 * scan that slipped past validation) from holding a pool slot open forever.
 * Without the latter, that single query exhausts the pool and stalls every other
 * request, turning one bad plan into a site-wide outage.
 */
const DEFAULT_CONNECT_TIMEOUT_S = 10
const DEFAULT_SOCKET_TIMEOUT_S = 30

/**
 * Returns DATABASE_URL with pooling parameters applied.
 *
 * Existing query parameters on the supplied URL are preserved; the values here
 * are defaults that an operator can still override explicitly, so an urgent
 * incident can widen the pool without a code change.
 */
function withPoolParams(url: string | undefined): string | undefined {
  if (!url) return undefined

  const poolSize = readPositiveInt('DATABASE_POOL_SIZE') ?? DEFAULT_POOL_SIZE
  const connectTimeout = readPositiveInt('DATABASE_CONNECT_TIMEOUT_S') ?? DEFAULT_CONNECT_TIMEOUT_S
  const socketTimeout = readPositiveInt('DATABASE_SOCKET_TIMEOUT_S') ?? DEFAULT_SOCKET_TIMEOUT_S

  // PgBouncer in TRANSACTION mode does not support prepared statements, so
  // Prisma must be told; leaving this off against a transaction pooler causes
  // random "prepared statement already exists" failures at exactly the wrong
  // moment. The SESSION-mode pooler (port 5432) pins a server connection for the
  // life of the client session and therefore DOES support prepared statements,
  // so the flag is both unnecessary and harmful there.
  //
  // PERFORMANCE: `pgbouncer=true` is not free. Prisma routes each statement
  // through extra `BEGIN` / `DEALLOCATE ALL` round trips to sidestep server-side
  // prepared statements. On a high-latency link (this project's Supabase pooler
  // lives in ap-northeast-1, ~150-200ms RTT) that overhead pushed every trivial
  // query from ~0.15s to ~1s — enough to make an admin page that fans out a
  // dozen queries take 12-15 seconds to render. Auto-enable only for the
  // transaction-mode pooler (port 6543); an operator can still force either
  // behaviour explicitly with DATABASE_PGBOUNCER=true|false.
  const isTransactionPooler = /pooler\./i.test(safeHost(url)) && safePort(url) === '6543'
  const usePgbouncer =
    process.env.DATABASE_PGBOUNCER === 'true' ||
    (process.env.DATABASE_PGBOUNCER !== 'false' && isTransactionPooler)

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    // Not a parseable URL (some providers use socket-style DSNs). Pass through
    // untouched rather than crashing boot; the defaults are then simply absent.
    return url
  }

  const defaults: Record<string, string> = {
    connection_limit: String(poolSize),
    connect_timeout: String(connectTimeout),
    socket_timeout: String(socketTimeout),
  }
  if (usePgbouncer) defaults.pgbouncer = 'true'

  for (const [key, value] of Object.entries(defaults)) {
    if (!parsed.searchParams.has(key)) parsed.searchParams.set(key, value)
  }

  return parsed.toString()
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

function safePort(url: string): string {
  try {
    // An explicit ":5432" is present in DATABASE_URL; default to the Postgres
    // port when the URL omits it so the check is not defeated by a bare host.
    return new URL(url).port || '5432'
  } catch {
    return ''
  }
}

const datasourceUrl = withPoolParams(process.env.DATABASE_URL)

export const db =
  global.__vedhicfoods_prisma ||
  new PrismaClient({
    log: isDev ? ['query', 'error', 'warn'] : ['error', 'warn'],
    ...(datasourceUrl ? { datasourceUrl } : {}),
  })

if (process.env.NODE_ENV !== 'production') {
  global.__vedhicfoods_prisma = db
}

export default db