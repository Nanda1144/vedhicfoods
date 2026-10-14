import { prisma } from '../../config/database'
import { logger } from '../../config/logger'

/**
 * Recipient suppression list for transactional email.
 *
 * SES reports hard bounces and spam complaints to the SNS topic configured on
 * the sending configuration set. Continuing to send to those addresses is what
 * degrades a sending domain's reputation and eventually gets the account
 * throttled or suspended, so every reported address must be remembered and
 * skipped on future sends.
 *
 * Storage is the generic `system_settings` key/value table rather than a new
 * table: the list is small, read-mostly and does not need relational querying,
 * and reusing it avoids a migration for a single JSON blob. The trade-off is
 * that concurrent writers can clobber each other; suppression is low-volume
 * (bounce/complaint callbacks) so a read-modify-write is acceptable. If volume
 * grows, move this to a dedicated `email_suppression` table.
 */
export interface SuppressionEntry {
  reason: string
  at: string
  source?: string
}

const SETTING_KEY = 'email_suppression_list'
const CACHE_TTL_MS = 60_000

let cache: { map: Record<string, SuppressionEntry>; expiresAt: number } | null = null

function normalize(email: string): string {
  return email.trim().toLowerCase()
}

export class EmailSuppressionService {
  /** Loads the suppression map, using a short-lived cache. */
  private static async load(): Promise<Record<string, SuppressionEntry>> {
    if (cache && cache.expiresAt > Date.now()) return cache.map

    let map: Record<string, SuppressionEntry> = {}
    try {
      const row = await prisma.systemSetting.findUnique({ where: { key: SETTING_KEY } })
      if (row?.value) {
        const parsed = JSON.parse(row.value)
        if (parsed && typeof parsed === 'object') map = parsed as Record<string, SuppressionEntry>
      }
    } catch (error: any) {
      // Fail-open: a settings read failure must not silently stop all mail.
      // Sending to a hard-bounced address is recoverable; dropping every email
      // because of a transient DB blip is not.
      logger.error({ error: error?.message }, 'Failed to load email suppression list; proceeding without it')
    }

    cache = { map, expiresAt: Date.now() + CACHE_TTL_MS }
    return map
  }

  public static async isSuppressed(email: string): Promise<boolean> {
    if (!email) return false
    const map = await EmailSuppressionService.load()
    return Boolean(map[normalize(email)])
  }

  public static async list(): Promise<Array<{ email: string } & SuppressionEntry>> {
    const map = await EmailSuppressionService.load()
    return Object.entries(map).map(([email, entry]) => ({ email, ...entry }))
  }

  /** Adds addresses to the list. Returns how many were newly suppressed. */
  public static async suppress(
    emails: string[],
    reason: string,
    source = 'ses'
  ): Promise<number> {
    const cleaned = emails.map(normalize).filter(Boolean)
    if (!cleaned.length) return 0

    const map = { ...(await EmailSuppressionService.load()) }
    const at = new Date().toISOString()
    let added = 0
    for (const email of cleaned) {
      if (map[email]) continue
      map[email] = { reason, at, source }
      added += 1
    }

    if (added > 0) {
      await prisma.systemSetting.upsert({
        where: { key: SETTING_KEY },
        update: { value: JSON.stringify(map), description: 'Recipients suppressed from transactional email (bounces/complaints)' },
        create: {
          key: SETTING_KEY,
          value: JSON.stringify(map),
          description: 'Recipients suppressed from transactional email (bounces/complaints)',
        },
      })
      cache = { map, expiresAt: Date.now() + CACHE_TTL_MS }
      logger.warn({ added, reason, source }, 'Addresses added to email suppression list')
    }

    return added
  }

  /** Removes an address (manual un-suppression). Returns true when removed. */
  public static async remove(email: string): Promise<boolean> {
    const map = { ...(await EmailSuppressionService.load()) }
    const key = normalize(email)
    if (!map[key]) return false
    delete map[key]

    await prisma.systemSetting.upsert({
      where: { key: SETTING_KEY },
      update: { value: JSON.stringify(map) },
      create: { key: SETTING_KEY, value: JSON.stringify(map) },
    })
    cache = { map, expiresAt: Date.now() + CACHE_TTL_MS }
    return true
  }

  /**
   * Translates an SES event delivered via SNS into suppression actions.
   *
   * Only **Permanent** bounces are suppressed: a transient bounce (mailbox
   * full, greylisting) is retried by SES and must not blacklist a valid address.
   */
  public static async applySesEvent(event: any): Promise<number> {
    const type = event?.eventType || event?.notificationType
    if (type === 'Bounce') {
      if (event?.bounce?.bounceType !== 'Permanent') return 0
      const emails = (event?.bounce?.bouncedRecipients ?? [])
        .map((r: any) => r?.emailAddress)
        .filter(Boolean)
      return EmailSuppressionService.suppress(emails, 'hard-bounce', 'ses')
    }
    if (type === 'Complaint') {
      const emails = (event?.complaint?.complainedRecipients ?? [])
        .map((r: any) => r?.emailAddress)
        .filter(Boolean)
      return EmailSuppressionService.suppress(emails, 'complaint', 'ses')
    }
    return 0
  }

  /** Test seam: seed the in-memory map without touching the database. */
  public static __seedForTests(map: Record<string, SuppressionEntry>): void {
    cache = { map, expiresAt: Date.now() + CACHE_TTL_MS }
  }

  /** Test seam: drop the cache so the next call reloads from storage. */
  public static __resetCacheForTests(): void {
    cache = null
  }
}
