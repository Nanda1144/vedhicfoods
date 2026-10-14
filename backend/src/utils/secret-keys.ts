/**
 * Secret detection for the generic settings store.
 *
 * SECURITY: this module replaces an exact-match denylist of 14 key names.
 *
 * The previous check compared a normalised key against a fixed array:
 *
 *   FORBIDDEN_SETTING_KEYS.map(normalise).includes(normalise(key))
 *
 * That is a denylist, so it fails open by default — it blocks only the names
 * somebody remembered to enumerate. `smtp_password`, `apiKey`,
 * `brevo_api_key`, `aws_secret_key`, `private_key`, `service_role_key` and
 * `db_pass` all normalised to strings absent from the list and were stored as
 * cleartext `SystemSetting.value` rows.
 *
 * Two things made that materially worse rather than theoretical:
 *
 *   1. The store is generic — the same table backs SMTP, payment and feature
 *      configuration — so `smtp_password` is precisely the shape of key an
 *      operator would reach for.
* 2. Nothing prevented the same request setting `isPublic: true`, and
 *      `GET /api/v1/settings` is unauthenticated. Writing the credential and
 *      publishing it were a single call.
 *
 * Detection is therefore pattern-based: any key that *looks like* a credential
 * is refused. Generic settings are for configuration, not secrets — the real
 * credentials belong in AWS Secrets Manager / SSM Parameter Store, which is
 * also where they are rotatable without a code deploy.
 */

import { ValidationError } from './errors'

/**
 * Substrings that mark a key as credential-bearing.
 *
 * Matched against the lower-cased key with separators collapsed to `_`, so
 * `Smtp-Password`, `smtp_password` and `smtp.password` are all equivalent.
 */
/**
 * Any key that ends in `_key` is treated as credential-bearing by default.
 *
 * Generic settings have no use for a bare `<something>_key` — the legitimate
 * cases are identifiers, not credentials, and they are enumerated below. Failing
 * closed here is what stops `service_role_key`, `signing_key` and the next name
 * somebody invents, which is precisely how the previous fixed list was bypassed.
 */
const NON_SECRET_KEY_NAMES: readonly RegExp[] = [
  /sort_?key/,
  /partition_?key/,
  /cache_?key/,
  /translation_?key/,
  /locale_?key/,
  /object_?key/,
  /storage_?key_?name/,
  /key_?name/,
]

const SECRET_KEY_PATTERNS: readonly RegExp[] = [
  /secret/,
  /passw(or)?d/,
  /passphrase/,
  /credential/,
  /private_?key/,
  /api_?key/,
  /access_?key/,
  /secret_?key/,
  /key_?secret/,
  /client_?secret/,
  /signing_?key/,
  /encryption_?key/,
  /webhook_?secret/,
  /bearer/,
  /authorization/,
  /auth_?token/,
  /refresh_?token/,
  /session_?token/,
  /private_?salt/,
  /connection_?string/,
  /database_?url/,
  // `pass` is too short to treat as a substring on its own — `bypass_enabled`
  // would match — so it is anchored to the credential position it actually takes.
  /(^|_)pass(word|wd)?$/,
  /_key$/,
  /[a-z0-9]token[a-z0-9]/,
]

/**
 * Keys that merely *contain* one of the patterns above but are unambiguously
 * not credentials. Without these, a legitimate `tokenization_enabled` or
 * `passwordless_hint` setting would be impossible to store.
 */
const SECRET_KEY_ALLOWLIST: readonly RegExp[] = [
  /^tokeniz/,
  /tokenization/,
  /passwordless/,
  /password_?policy/,
  /password_?requirements?/,
  /password_?reset_?enabled/,
  /password_?min_?length/,
  /api_?key_?required/,
]

/** Collapses a key to a canonical comparable form. */
export function normaliseSettingKey(key: string): string {
  return String(key)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

/**
 * True when a key must never be persisted in (or served from) generic settings.
 *
 * Exports a *pattern* test rather than a fixed list so that naming it
 * `stripe_secret_key` or adding a field cannot bypass it.
 */
export function isSecretKey(key: string): boolean {
  const normalised = normaliseSettingKey(key)

  if (!normalised) return false

  if (SECRET_KEY_ALLOWLIST.some(pattern => pattern.test(normalised))) {
    return false
  }

  if (NON_SECRET_KEY_NAMES.some(pattern => pattern.test(normalised))) {
    return false
  }

  return SECRET_KEY_PATTERNS.some(pattern => pattern.test(normalised))
}

/**
 * Recursively asserts that no secret-shaped key appears anywhere in a value.
 *
 * A structured value is walked to arbitrary depth because storing
 * `{ "smtp": { "password": "…" } }` under a benign top-level key — such as
 * `notification_config` — is the obvious way around a key-name-only check, and
 * is what the settings UI produces.
 *
 * Throws `ValidationError` so the global error handler maps it to a 400 with the
 * offending key named, but never the value.
 */
export function assertNoSecretKeys(key: string, value: unknown, depth = 0): void {
  // Bound the recursion: a deeply nested or self-referential structure should be
  // rejected as validation failure, not blow the stack.
  if (depth > 10) {
    throw new ValidationError('Setting value is nested too deeply to validate safely.')
  }

  if (isSecretKey(key)) {
    throw new ValidationError(
      `"${key}" is a secret credential and cannot be stored in generic settings. ` +
        'Use AWS Secrets Manager or SSM Parameter Store instead.'
    )
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (entry && typeof entry === 'object') {
        assertNoSecretKeys(key, entry, depth + 1)
      }
    }
    return
  }

  if (value && typeof value === 'object') {
    for (const nestedKey of Object.keys(value as Record<string, unknown>)) {
      assertNoSecretKeys(nestedKey, (value as Record<string, unknown>)[nestedKey], depth + 1)
    }
  }
}