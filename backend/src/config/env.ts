import dotenv from 'dotenv'
import path from 'path'
import { z } from 'zod'

export const ENVIRONMENT_NAMES = ['development', 'test', 'staging', 'production'] as const
export type EnvironmentName = (typeof ENVIRONMENT_NAMES)[number]

/**
 * Resolves which environment this process is running as, *before* any dotenv file
 * is read.
 *
 * Only `process.env.NODE_ENV` is consulted, never a dotenv file, because the file
 * name we are about to load depends on the answer. Reading `NODE_ENV` from a file
 * would be circular.
 *
 * An unrecognised or empty value falls back to `development`, matching the schema
 * default below. The consequence is deliberate and fail-closed: an operator who
 * forgets `NODE_ENV=production` in a deployed container gets the *development*
 * env files, not the production ones, and every production secret placeholder is
 * then missing — so the process refuses to boot instead of quietly serving
 * localhost defaults to the internet.
 */
function resolveEnvironmentName(): EnvironmentName {
  const raw = (process.env.NODE_ENV ?? '').trim()
  if (!raw) return 'development'
  return (ENVIRONMENT_NAMES as readonly string[]).includes(raw)
    ? (raw as EnvironmentName)
    : 'development'
}

const environmentName = resolveEnvironmentName()

/**
 * Loads `.env.<environment>` then `.env`.
 *
 * The order is load-bearing and reversed relative to the usual convention.
 * `dotenv.config` never overwrites a variable that is already set, so whichever
 * file is read *first* wins. The environment-specific file therefore has to be
 * read first, and `.env` second, purely as a fallback of last resort:
 *
 *   real environment variables  (ECS task definition, CI, docker run -e)
 *   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
 *   .env.<environment>          (committed as .env.<env>.example)
 *   .env                        (legacy single-file local setup)
 *
 * Anything already exported by the platform wins over both files, which is what
 * lets the ECS task definition override a baked-in value.
 */
export const loadedEnvFiles: string[] = []

for (const file of [`.env.${environmentName}`, '.env']) {
  const resolved = path.resolve(process.cwd(), file)
  const result = dotenv.config({ path: resolved })
  if (!result.error) loadedEnvFiles.push(file)
}

/**
 * Placeholder values that ship in `.env.example` and in the old Zod defaults.
 *
 * SECURITY: these must never reach a production process. A deployment that
 * forgets to set one of them would otherwise silently sign tokens, decrypt
 * stored payment credentials, or accept forged webhooks with a key that is
 * published in this repository. They are rejected outright below when
 * NODE_ENV=production.
 */
export const INSECURE_PLACEHOLDER_SECRETS = [
  'vedhicfoods_jwt_secret_must_be_at_least_32_characters_long_in_production',
  'vedhicfoods_secure_32bit_key_2026_aes!',
  'rzp_test_placeholder_key',
  'rzp_test_placeholder_secret',
  'rzp_webhook_secret_placeholder',
] as const

const envSchema = z.object({
  NODE_ENV: z.enum(ENVIRONMENT_NAMES).default(environmentName),
  PORT: z.coerce.number().default(5000),

  // HTTP server timeouts.
  //
  // PERFORMANCE / resilience: these bound how long a single socket can occupy an
  // instance. `REQUEST_TIMEOUT_MS` must be greater than the slowest legitimate
  // operation (invoice PDF generation plus S3 upload) and less than the load
  // balancer idle timeout, otherwise the proxy tears down the connection while
  // the app is still working and the client sees a 502 for a request that
  // succeeded. `KEEP_ALIVE_TIMEOUT_MS` is set just under a typical 60s ALB idle
  // timeout so the server closes idle sockets first and never races the proxy.
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  HEADERS_TIMEOUT_MS: z.coerce.number().int().positive().default(66_000),
  KEEP_ALIVE_TIMEOUT_MS: z.coerce.number().int().positive().default(65_000),
  // How long in-flight requests may finish during a rolling deploy before the
  // process is killed. Must be less than the orchestrator's own termination
  // grace period (ECS `stopTimeout`, Kubernetes `terminationGracePeriodSeconds`).
  SHUTDOWN_GRACE_MS: z.coerce.number().int().positive().default(25_000),

  // Database connection pooling.
  //
  // PERFORMANCE / MULTI-INSTANCE: total connections = instances x pool size, and
  // that must stay under the database's `max_connections`, leaving headroom for
  // migrations and operator access. See `database/client.ts`.
  DATABASE_POOL_SIZE: z.coerce.number().int().positive().optional(),
  DATABASE_CONNECT_TIMEOUT_S: z.coerce.number().int().positive().optional(),
  DATABASE_SOCKET_TIMEOUT_S: z.coerce.number().int().positive().optional(),
  // Set when connecting through PgBouncer / Supabase transaction mode so Prisma
  // disables prepared statements.
  DATABASE_PGBOUNCER: z.coerce.string().optional(),

  // Shared Redis for rate limiting.
  //
  // SECURITY: required in production. `express-rate-limit`'s default store is
  // per-process, so with N instances the effective limit is `limit x N`. Absent
  // this variable the rate-limiter middleware refuses to boot in production.
  // Optional in development/test, where there is only one process.
  REDIS_URL: z.coerce.string().optional(),

  // Database URL (PostgreSQL on AWS RDS or local)
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // JWT configuration
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters long for security'),
  JWT_EXPIRES_IN: z.string().default('7d'),

  // CORS origins
  FRONTEND_URL: z.string().default('http://localhost:5173'),
  ADMIN_FRONTEND_URL: z.string().default('http://localhost:5173'),

  // AWS Configuration (Region defaults to ap-south-1 Mumbai)
  AWS_REGION: z.string().default('ap-south-1'),
  // Optional in production if using AWS IAM Instance / ECS Task Roles
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_S3_BUCKET: z.string().default('vedhifoods-media-dev'),
  // Public base URL that object keys are served from. In production the media
  // bucket is private behind CloudFront (OAC), so the raw
  // `{bucket}.s3.{region}.amazonaws.com` URL returns 403. Set this to the
  // distribution origin, e.g. `https://cdn.vedhicfoods.com` (no trailing slash).
  // When unset, the direct S3 virtual-hosted URL is used, which is what local
  // development and a public-read bucket expect.
  AWS_S3_PUBLIC_BASE_URL: z.preprocess(
    v => (v === '' ? undefined : v),
    z.string().url().optional()
  ),

  // Razorpay configuration
  RAZORPAY_KEY_ID: z.string().default('rzp_test_placeholder_key'),
  RAZORPAY_KEY_SECRET: z.string().default('rzp_test_placeholder_secret'),
  RAZORPAY_WEBHOOK_SECRET: z.string().default('rzp_webhook_secret_placeholder'),

  // 32-Byte (256-bit) Encryption Key for Payment Gateway Credentials.
  // In production this MUST be supplied from AWS Secrets Manager / SSM
  // Parameter Store — the historical default is a public constant.
  ENCRYPTION_KEY: z.string().default('vedhicfoods_secure_32bit_key_2026_aes!'),

  // Brevo (Sendinblue) Transactional Email Service
  BREVO_API_KEY: z.string().optional(),
  BREVO_SENDER_EMAIL: z.string().email().default('care@vedhicfoods.com'),
  BREVO_SENDER_NAME: z.string().default('Vedhic Foods'),

  // Operational alert inbox (new paid orders, failures). Optional: when unset
  // the SES/Brevo sender address is used, so no deployment is forced to set it.
  ADMIN_NOTIFICATION_EMAIL: z.preprocess(
    v => (v === '' ? undefined : v),
    z.string().email().optional()
  ),

  // Email provider selection: 'ses' (AWS, production) | 'brevo' | 'auto'.
  //
  // 'auto' prefers SES and falls back to Brevo, which keeps local development
  // working without AWS credentials while production uses the in-region
  // transport with IAM-scoped auth instead of a long-lived API key.
  EMAIL_PROVIDER: z.enum(['ses', 'brevo', 'auto']).default('auto'),

  // Amazon SES. The sender must be on a domain verified in this account, or an
  // individually verified address. SES_REGION is optional: when unset the SDK
  // follows AWS_REGION from the task role's region.
  SES_REGION: z.string().optional(),
  // `.optional()` in Zod v3 still validates an empty string, and every env
  // example ships `SES_SENDER_EMAIL=` blank for local runs. Normalise blank to
  // undefined instead of failing the boot on a variable nobody has to set.
  SES_SENDER_EMAIL: z.preprocess(v => (v === '' ? undefined : v), z.string().email().optional()),
  SES_SENDER_NAME: z.string().default('Vedhic Foods'),
  // Optional. Publishes send/bounce/complaint events to CloudWatch, which is
  // what makes the bounce-rate alarm in the deployment checklist possible.
  SES_CONFIGURATION_SET: z.string().optional(),

  // SNS topic that receives SES bounce/complaint events. When set, the webhook
  // refuses messages whose TopicArn does not match, so a stray publisher cannot
  // add addresses to the suppression list.
  SNS_EMAIL_TOPIC_ARN: z.preprocess(v => (v === '' ? undefined : v), z.string().optional()),
  // Verify the SNS message signature on the inbound webhook. Only disable in a
  // throwaway environment; leaving it on stops a forged POST from suppressing
  // arbitrary recipient addresses.
  SNS_VERIFY_SIGNATURE: z
    .preprocess(v => (v === undefined || v === '' ? 'true' : v), z.enum(['true', 'false']))
    .transform(v => v === 'true'),

  // Durable email outbox.
  //
  // When enabled, `EmailQueue.enqueue` persists the message to the
  // `email_outbox` table before returning and a background worker delivers it
  // with retry/backoff, so queued mail is not lost when an instance restarts or
  // a rolling deploy replaces it. Left unset it defaults to enabled everywhere
  // except the unit-test environment, which has no database and exercises the
  // in-memory queue instead.
  EMAIL_OUTBOX_ENABLED: z
    .preprocess(v => (v === undefined || v === '' ? undefined : v), z.enum(['true', 'false']).optional())
    .transform(v => (v === undefined ? undefined : v === 'true')),
  EMAIL_OUTBOX_INTERVAL_MS: z.coerce.number().int().positive().default(15_000),
  EMAIL_OUTBOX_BATCH_SIZE: z.coerce.number().int().positive().max(500).default(25),

  // Abandoned-checkout reservation reaper.
  //
  // Orders left in PENDING_PAYMENT longer than RESERVATION_TTL_MS have their
  // held stock released and are cancelled, so an abandoned Razorpay checkout
  // does not lock inventory forever. `RESERVATION_SWEEP_ENABLED` defaults on.
  RESERVATION_SWEEP_ENABLED: z
    .preprocess(v => (v === undefined || v === '' ? undefined : v), z.enum(['true', 'false']).optional())
    .transform(v => (v === undefined ? undefined : v === 'true')),
  RESERVATION_TTL_MS: z.coerce.number().int().positive().default(30 * 60 * 1000),
  RESERVATION_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(5 * 60 * 1000),
  RESERVATION_SWEEP_BATCH: z.coerce.number().int().positive().max(1000).default(100),

  // Logging
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),

  /**
   * Reverse-proxy trust configuration for `app.set('trust proxy', …)`.
   *
   * SECURITY: this used to be hardcoded to `1` in `app.ts`. Express then treats
   * the *leftmost* `X-Forwarded-For` entry as the client address, and every
   * rate limiter keys on `req.ip`. Two consequences:
   *
   *   - With no proxy in front (local, staging-as-container, or a target group
   *     wired straight to the container), that leftmost entry is entirely
   *     attacker-supplied. A single `X-Forwarded-For` header per request gave a
   *     caller an unlimited supply of identities, so the login, password-reset,
   *     contact-form and guest-checkout limits could all be bypassed at will —
   *     they were no longer a control.
   *   - Behind a proxy that rewrites rather than appends the header, the same
   *     spoof applied.
   *
   * Accepted values:
   *   false                      trust nothing (correct when directly exposed)
   *   <integer>                  trust exactly N hops (correct behind one ALB)
   *   <ip / CIDR list>           trust only hops inside these ranges
   *   loopback                   trust only the local machine
   *
   * Defaults to `false`. Production behind a load balancer must set this
   * explicitly; boot fails otherwise so the choice cannot be forgotten silently.
   */
  TRUST_PROXY: z
    .string()
    .optional()
    // `TRUST_PROXY=false` is a documented value in .env.*.example, so the
    // literal string has to be normalised to the boolean before the refine
    // below — otherwise the documented value is rejected by its own validator.
    .transform(v => (v === undefined || v === '' || v.toLowerCase() === 'false' ? false : v))
    .refine(
      v =>
        v === false ||
        v === 'loopback' ||
        /^\d+$/.test(String(v)) ||
        // A single IP or comma-separated CIDR/IP list.
        /^[\d./,\s]+$/.test(String(v)),
      {
        message:
          'TRUST_PROXY must be "false", "loopback", a hop count, or an IP/CIDR list.',
      }
    ),
})

export type EnvConfig = z.infer<typeof envSchema>

let validatedEnv: EnvConfig

try {
  validatedEnv = envSchema.parse(process.env)
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error('❌ Critical Environment Configuration Error:')
    error.errors.forEach((err) => {
      console.error(`  - ${err.path.join('.')}: ${err.message}`)
    })
  } else {
    console.error('❌ Unknown error loading environment variables:', error)
  }
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Production-only guard rail: refuse to boot on published placeholder secrets.
// ---------------------------------------------------------------------------
if (validatedEnv.NODE_ENV === 'production') {
  const offenders: string[] = []

  /**
   * @param required when false, an empty value is accepted (the credential may
   *   instead be stored encrypted in the database) but a *placeholder* value is
   *   still a hard failure. A placeholder is never a legitimate choice — it
   *   means the deployment forgot to supply a real value.
   */
  const check = (name: string, value: string, minLength: number, required = true): void => {
    if (!value || value.trim().length === 0) {
      if (required) {
        offenders.push(`${name} is missing or empty (minimum ${minLength} characters)`)
      }
      return
    }

    if (value.trim().length < minLength) {
      offenders.push(`${name} is shorter than ${minLength} characters`)
      return
    }

    if ((INSECURE_PLACEHOLDER_SECRETS as readonly string[]).includes(value)) {
      offenders.push(
        `${name} still holds the placeholder value published in .env.example — ` +
          'generate a unique secret (e.g. `openssl rand -base64 48`) and store it in ' +
          'AWS Secrets Manager or SSM Parameter Store'
      )
      return
    }

    // Catch the templated `REPLACE_ME_*` values shipped in
    // .env.production.example. Those are longer than the minimum lengths above
    // (e.g. REPLACE_ME_PRODUCTION_JWT_SECRET_...) so they would otherwise pass
    // the length check and boot a production process with a value that is
    // published in this repository.
    const lowered = value.toLowerCase()
    if (
      lowered.includes('replace_me') ||
      lowered.includes('placeholder') ||
      lowered.includes('changeme') ||
      lowered.includes('change_me')
    ) {
      offenders.push(
        `${name} still contains a template placeholder — supply the real value ` +
          'from AWS Secrets Manager or SSM Parameter Store'
      )
    }
  }

  check('JWT_SECRET', validatedEnv.JWT_SECRET, 32)
  check('ENCRYPTION_KEY', validatedEnv.ENCRYPTION_KEY, 32)
  // The webhook secret cannot fall back to the database: it is the only thing
  // proving a callback genuinely came from Razorpay.
  check('RAZORPAY_WEBHOOK_SECRET', validatedEnv.RAZORPAY_WEBHOOK_SECRET, 16)
  // Razorpay API keys may live in the encrypted PaymentSettings table instead,
  // so empty is tolerated here — but the shipped placeholder is not.
  check('RAZORPAY_KEY_ID', validatedEnv.RAZORPAY_KEY_ID, 8, false)
  check('RAZORPAY_KEY_SECRET', validatedEnv.RAZORPAY_KEY_SECRET, 8, false)

  /**
   * A wildcard or plaintext-http CORS origin in production silently disables the
   * same-origin boundary for every state-changing endpoint.
   */
  const insecureOrigins = [validatedEnv.FRONTEND_URL, validatedEnv.ADMIN_FRONTEND_URL].filter(
    (origin) => origin === '*' || !/^https:\/\//i.test(origin)
  )

  if (insecureOrigins.length > 0) {
    offenders.push(
      `FRONTEND_URL/ADMIN_FRONTEND_URL must be explicit https:// origins in production. ` +
        `Got: ${insecureOrigins.join(', ')}`
    )
  }

  /**
   * Reserved / non-resolvable hostnames. These pass the `https://` check above
   * while being incapable of serving the real site, and the failure they cause is
   * silent and expensive to diagnose: the storefront loads, the API answers, CORS
   * passes, and every write from the browser is simply discarded because no such
   * host is ever registered in DNS. `vedhicfoods.example` is the exact value that
   * shipped in `frontend/src/config/site.ts` while this was unconfigured, so this
   * is a known state for this repository rather than a hypothetical.
   */
  const RESERVED_HOST_SUFFIXES = ['.example', '.invalid', '.localhost', '.test']

  const nonProductionOrigins = [validatedEnv.FRONTEND_URL, validatedEnv.ADMIN_FRONTEND_URL]
    .map((origin) => {
      try {
        return new URL(origin).hostname.toLowerCase()
      } catch {
        return ''
      }
    })
    .filter(
      (hostname) =>
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '::1' ||
        RESERVED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
    )

  if (nonProductionOrigins.length > 0) {
    offenders.push(
      `FRONTEND_URL/ADMIN_FRONTEND_URL point at a loopback or reserved hostname in production: ` +
        `${nonProductionOrigins.join(', ')}. Reserved names (${RESERVED_HOST_SUFFIXES.join(', ')}) ` +
        `cannot be registered in DNS, so the storefront would load while every authenticated ` +
        `write silently failed. Use the real public origins.`
    )
  }

/**
   * In production the app is always behind an Application Load Balancer, so the
   * proxy hop count must be stated rather than defaulted. Leaving it unset meant
   * `trust proxy` stayed at `false`, which made Express treat the load balancer
   * as the client: every rate limiter keyed on `req.ip` collapsed into a single
   * global bucket shared by every customer, and audit entries recorded the ALB's
   * address instead of the caller's.
   *
   * `TRUST_PROXY=false` is rejected for the same reason — a production task with
   * no proxy in front of it is a misconfiguration to catch, not a supported
   * topology for this deployment.
   */
  if (validatedEnv.TRUST_PROXY === false) {
    offenders.push(
      'TRUST_PROXY must be set explicitly in production. This deployment always terminates ' +
        'TLS at an Application Load Balancer, so the correct value is TRUST_PROXY=1 ' +
        '(use 2 only if a CDN such as CloudFront sits in front of the ALB). ' +
        'Rate limiting and audit IP attribution depend on it.'
    )
  }

  if (offenders.length > 0) {
    console.error('❌ Refusing to start: insecure production configuration detected.')
    offenders.forEach(msg => console.error(`  - ${msg}`))
    process.exit(1)
  }
}

export const env = validatedEnv

/**
 * Resolves the `TRUST_PROXY` value into the shape Express expects.
 *
 * Express accepts `false`, `true`, a hop count, a CIDR string or a list. The env
 * schema guarantees one of `false | 'loopback' | <integer> | <CIDR list>`, so the
 * only work here is coercing the numeric-string form to a real number — a string
 * `'1'` would be read by Express as a *single CIDR-like entry*, silently changing
 * the trust semantics.
 */
export function resolveTrustProxy(value: string | number | boolean): boolean | number | string {
  if (typeof value === 'boolean' || typeof value === 'number') return value
  if (value === 'loopback') return 'loopback'
  if (/^\d+$/.test(value)) return Number.parseInt(value, 10)
  return value
}
