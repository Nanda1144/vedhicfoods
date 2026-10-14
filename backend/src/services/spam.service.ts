import { createHash } from 'crypto'
import { prisma } from '../config/database'
import { logger } from '../config/logger'
import { env } from '../config/env'

export interface SpamSignalContext {
  /** Honeypot field value. Any non-empty value is a hard bot signal. */
  honeypot?: unknown
  /** Combined free text (subject + message). */
  text: string
  email: string
  /** Client IP, used for burst/duplicate detection. */
  ipAddress?: string | null
  /** Wall-clock time the client claims the form was rendered. */
  renderedAt?: number | null
  userAgent?: string | null
}

export interface SpamVerdict {
  isSpam: boolean
  score: number
  reasons: string[]
  /** Stable fingerprint used to detect verbatim resubmissions. */
  fingerprint: string
}

/**
 * Score at or above which a submission is treated as spam.
 * Tuned so that a single strong signal (honeypot, blocklisted keyword, burst
 * duplicate) is enough, while weak signals need to accumulate.
 */
const SPAM_SCORE_THRESHOLD = 5

/** Submissions from the same fingerprint inside this window count as duplicates. */
const DUPLICATE_WINDOW_HOURS = 24

/** A form completed faster than this is assumed to be automated. */
const MIN_HUMAN_FILL_MS = 3000

const BLOCKED_KEYWORDS = [
  'crypto',
  'bitcoin',
  'viagra',
  'casino',
  'porn',
  'escort',
  'payday loan',
  'seo service',
  'backlink',
  'buy followers',
  'weight loss pill',
  'replica watch',
  'airdrop',
  'nft giveaway',
  'click here now',
  'make money fast',
  'work from home',
  'telegram channel',
  'whatsapp +',
] as const

/** Characters that indicate an attempt to smuggle markup through a text field. */
const MARKUP_PATTERN = /<\s*(script|iframe|object|embed|style|img|svg|a)\b[^>]*>|javascript:|data:text\/html|vbscript:/i

/** Repeated-character runs, e.g. "aaaaaaa" or "!!!!!!!!". */
const REPEATED_CHARS_PATTERN = /(.)\1{7,}/

/** Obfuscated digit runs used to dodge naive keyword filters, e.g. "crYpTo". */
const OBFUSCATED_SPACING_PATTERN = /[a-z][\s._-][a-z][\s._-][a-z][\s._-][a-z][\s._-][a-z]/i

function normalizeForFingerprint(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function countLinks(text: string): number {
  const matches = text.match(/https?:\/\/|www\.|\[url\]/gi)
  return matches ? matches.length : 0
}

/**
 * Heuristic spam scoring for the public contact form and customer ticket
 * creation. Purely additive: each rule contributes a weight and the reasons
 * are persisted alongside the submission so staff can audit false positives.
 *
 * Rules are intentionally conservative — a genuine customer describing a
 * payment problem must never be silently discarded, so no single low-signal
 * rule can reject on its own.
 */
export class SpamService {
  /**
   * Pure scoring pass. Performs no I/O, so it is safe to unit test and cheap
   * to run inline in the request path.
   */
  public static score(context: SpamSignalContext): SpamVerdict {
    const reasons: string[] = []
    let score = 0

    const text = context.text || ''
    const fingerprint = SpamService.buildFingerprint(context.email, text)

    // --- Hard signals -------------------------------------------------------

    if (typeof context.honeypot === 'string' && context.honeypot.trim().length > 0) {
      score += 10
      reasons.push('honeypot_field_filled')
    }

    const normalized = normalizeForFingerprint(text)

    for (const keyword of BLOCKED_KEYWORDS) {
      if (normalized.includes(keyword)) {
        score += 5
        reasons.push(`blocked_keyword:${keyword}`)
        break
      }
    }

    if (MARKUP_PATTERN.test(text)) {
      score += 5
      reasons.push('markup_or_script_injection')
    }

    // --- Soft signals -------------------------------------------------------

    const links = countLinks(text)
    if (links >= 3) {
      score += 3
      reasons.push('excessive_links')
    } else if (links >= 1 && text.length < 200) {
      score += 1
      reasons.push('short_message_with_link')
    }

    if (REPEATED_CHARS_PATTERN.test(text)) {
      score += 2
      reasons.push('repeated_character_run')
    }

    if (OBFUSCATED_SPACING_PATTERN.test(text)) {
      score += 2
      reasons.push('obfuscated_spelling')
    }

    // Form completed implausibly fast => automated client.
    if (
      typeof context.renderedAt === 'number' &&
      Number.isFinite(context.renderedAt) &&
      Date.now() - context.renderedAt < MIN_HUMAN_FILL_MS
    ) {
      score += 4
      reasons.push('submitted_too_quickly')
    }

    // Missing user agent on a server-rendered form submission is unusual.
    if (!context.userAgent) {
      score += 1
      reasons.push('missing_user_agent')
    }

    // All-caps shouting, only meaningful for longer bodies.
    const letters = text.replace(/[^a-zA-Z]/g, '')
    if (letters.length >= 40) {
      const upperRatio = letters.replace(/[^A-Z]/g, '').length / letters.length
      if (upperRatio > 0.7) {
        score += 2
        reasons.push('excessive_capitalisation')
      }
    }

    // Very short body padded out with a single repeated word.
    if (text.length < 60) {
      const words = normalized.split(/\s+/).filter(Boolean)
      const unique = new Set(words)
      if (words.length >= 8 && unique.size <= 3) {
        score += 2
        reasons.push('word_repetition')
      }
    }

    return {
      isSpam: score >= SPAM_SCORE_THRESHOLD,
      score,
      reasons,
      fingerprint,
    }
  }

  /**
   * Deterministic fingerprint over (email + normalised body). Used to detect
   * verbatim resubmissions, which are the most common contact-form abuse
   * pattern and cannot be caught with keywords alone.
   */
  public static buildFingerprint(email: string, text: string): string {
    return createHash('sha256')
      .update(`${email.toLowerCase().trim()}|${normalizeForFingerprint(text)}`)
      .digest('hex')
      .slice(0, 32)
  }

  /**
   * Database-backed duplicate detection: the same email submitting an identical
   * message (or the same IP hammering the form) inside the duplicate window.
   */
  public static async findRecentDuplicate(
    fingerprint: string,
    ipAddress?: string | null,
    windowHours: number = DUPLICATE_WINDOW_HOURS
  ): Promise<{ id: string; reference: string; reason: string } | null> {
    const since = new Date(Date.now() - windowHours * 60 * 60 * 1000)

    try {
      const recent = await prisma.contactSubmission.findMany({
        where: { submittedAt: { gte: since } },
        select: {
          id: true,
          reference: true,
          email: true,
          subject: true,
          message: true,
          ipAddress: true,
        },
        take: 500,
        orderBy: { submittedAt: 'desc' },
      })

      // The fingerprint is computed over a normalised form, so it has to be
      // derived in memory rather than pushed into the WHERE clause.
      //
      // The combined text must be reconstructed exactly as the caller built it
      // (`subject\nmessage`); hashing the message alone would never match the
      // fingerprint computed by `evaluate` and duplicate detection would silently
      // never fire.
      for (const row of recent) {
        const text = `${row.subject}\n${row.message}`
        if (SpamService.buildFingerprint(row.email, text) === fingerprint) {
          return { id: row.id, reference: row.reference, reason: 'duplicate_message_content' }
        }
      }

      if (ipAddress) {
        const ipHits = recent.filter((row) => row.ipAddress === ipAddress).length
        if (ipHits >= 5) {
          return { id: recent[0].id, reference: recent[0].reference, reason: 'ip_submission_burst' }
        }
      }
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Spam duplicate lookup failed')
    }

    return null
  }

  /**
   * Combined entry point used by the contact controller: run the pure scorer
   * then layer on the database duplicate check.
   */
  public static async evaluate(
    context: SpamSignalContext
  ): Promise<SpamVerdict & { duplicateReason?: string }> {
    const verdict = SpamService.score(context)

    // A honeypot hit is conclusive; skip the database round-trip.
    if (verdict.reasons.includes('honeypot_field_filled')) {
      return verdict
    }

    const duplicate = await SpamService.findRecentDuplicate(
      verdict.fingerprint,
      context.ipAddress
    )

    if (duplicate) {
      return {
        ...verdict,
        isSpam: true,
        score: verdict.score + 5,
        reasons: [...verdict.reasons, duplicate.reason],
        duplicateReason: duplicate.reason,
      }
    }

    return verdict
  }

  /** Threshold, exposed so tests and admin tooling can assert against it. */
  public static get threshold(): number {
    return SPAM_SCORE_THRESHOLD
  }

  public static get duplicateWindowHours(): number {
    return DUPLICATE_WINDOW_HOURS
  }

  public static get minHumanFillMs(): number {
    return MIN_HUMAN_FILL_MS
  }
}

/**
 * True when rate limiting is effectively disabled (test environment), matching
 * the convention already used by the express-rate-limit definitions.
 */
export function isRateLimitRelaxed(): boolean {
  return env.NODE_ENV === 'test'
}