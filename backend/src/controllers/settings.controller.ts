import { Request, Response } from 'express'
import { SettingCategory } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../config/database'
import { AuditService } from '../services/audit.service'
import { logger } from '../config/logger'
import { isSecretKey, assertNoSecretKeys } from '../utils/secret-keys'
import { ValidationError } from '../utils/errors'

/**
 * Keys that may never be persisted in generic settings.
 * These live in AWS Secrets Manager / SSM Parameter Store instead.
 *
 * Retained for backwards compatibility and for the report's remediation trail.
 * NOTE: this list alone was never a sufficient control — it is an exact-match
 * denylist and failed open for every name not enumerated here. Detection now
 * lives in `utils/secret-keys.ts` and is pattern-based.
 */
export const FORBIDDEN_SETTING_KEYS = [
  'razorpay_secret',
  'razorpay_key_secret',
  'razorpay_webhook_secret',
  'razorpaysecret',
  'aws_secret',
  'aws_secret_access_key',
  'awsaccesskeyid',
  'jwt_secret',
  'jwtsecret',
  'db_password',
  'database_password',
  'databaseurl',
  'encryption_key',
  'encryptionkey',
] as const

const settingValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null(), z.record(z.any()), z.array(z.any())])

export const bulkSettingsSchema = z.object({
  settings: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(120),
        value: settingValueSchema,
        category: z.nativeEnum(SettingCategory).optional(),
        description: z.string().max(300).optional(),
        isPublic: z.boolean().optional(),
      }),
    )
    .min(1, 'At least one setting is required')
    .max(100, 'Too many settings in a single request'),
})

export const singleSettingSchema = z.object({
  value: settingValueSchema,
  category: z.nativeEnum(SettingCategory).optional(),
  description: z.string().max(300).optional(),
  isPublic: z.boolean().optional(),
})

/**
 * Rejects any attempt to store credentials inside generic settings.
 *
 * Now delegates to the pattern-based detector, which walks nested objects and
 * blocks credential-shaped names rather than a fixed enumeration.
 */
function assertNotSecret(key: string, value: unknown): void {
  assertNoSecretKeys(key, value)
}

/**
 * SECURITY: refuses to mark a credential-shaped key as publicly readable.
 *
 * The write path already refuses to *store* known secret names, but it accepted
 * `isPublic: true` unconditionally, so any key that slipped past the (then
 * exact-match) denylist could be published to the unauthenticated storefront
 * endpoint in the same request. Public is now a separate decision that cannot
 * be combined with credential-shaped configuration.
 */
function assertNotPublishableAsPublic(key: string, isPublic: boolean | undefined): void {
  if (isPublic && isSecretKey(key)) {
    throw new ValidationError(`"${key}" cannot be published as a public setting.`)
  }
}

function parseValue(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

export class SettingsController {
  /**
   * GET /api/v1/settings
   * Public endpoint. Only keys explicitly flagged `isPublic` are returned,
   * so private admin configuration can never leak to the storefront.
   *
   * SECURITY: the `isPublic` flag alone was treated as sufficient authority to
   * publish a value. Because the credential denylist was exact-match (see
   * `utils/secret-keys.ts`), any key that evaded it could be flagged public and
   * served here to an unauthenticated caller — storing and publishing the secret
   * were a single request. The read path now re-applies the pattern-based check,
   * so a credential-shaped row is filtered even if it was written before this
   * control existed. Filtering on read matters: rows persisted under the old
   * rules are still in the database.
   */
  public static async getPublicSettings(_req: Request, res: Response): Promise<void> {
    try {
      const settings = await prisma.systemSetting.findMany({
        where: { isPublic: true },
        orderBy: { key: 'asc' },
      })

      const data: Record<string, unknown> = {}
      let suppressed = 0

      for (const setting of settings) {
        if (isSecretKey(setting.key)) {
          // Never echo the value; the key alone is enough to act on.
          logger.error(
            { settingKey: setting.key },
            'Blocked a credential-shaped setting from the public settings endpoint'
          )
          suppressed++
          continue
        }

        const parsed = parseValue(setting.value)

        // Second layer: a credential nested inside a benign-looking public value.
        try {
          assertNoSecretKeys(setting.key, parsed)
        } catch {
          logger.error(
            { settingKey: setting.key },
            'Blocked a public setting containing nested credential keys'
          )
          suppressed++
          continue
        }

        data[setting.key] = parsed
      }

      if (suppressed > 0) {
        logger.warn(
          { suppressed },
          'Public settings response suppressed credential-shaped entries — audit these rows and migrate them to AWS Secrets Manager'
        )
      }

      res.status(200).json({ success: true, data })
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to fetch public settings')
      res.status(500).json({ error: 'Failed to retrieve public settings.' })
    }
  }

  /**
   * GET /api/v1/admin/settings
   * Admin-only. Returns the full settings registry including private keys.
   */
  public static async listSettings(_req: Request, res: Response): Promise<void> {
    try {
      const settings = await prisma.systemSetting.findMany({
        orderBy: [{ category: 'asc' }, { key: 'asc' }],
      })

      res.status(200).json({
        success: true,
        items: settings.map((s) => ({
          key: s.key,
          category: s.category,
          value: parseValue(s.value),
          description: s.description,
          isPublic: s.isPublic,
          updatedBy: s.updatedBy,
          updatedAt: s.updatedAt.toISOString(),
        })),
      })
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to list settings')
      res.status(500).json({ error: 'Failed to retrieve settings.' })
    }
  }

  /**
   * GET /api/v1/admin/settings/:key
   */
  public static async getSetting(req: Request, res: Response): Promise<void> {
    try {
      const key = String(req.params.key)
      const setting = await prisma.systemSetting.findUnique({ where: { key } })

      if (!setting) {
        res.status(404).json({ error: 'Setting not found.' })
        return
      }

      res.status(200).json({
        success: true,
        setting: {
          key: setting.key,
          category: setting.category,
          value: parseValue(setting.value),
          description: setting.description,
          isPublic: setting.isPublic,
          updatedBy: setting.updatedBy,
          updatedAt: setting.updatedAt.toISOString(),
        },
      })
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to fetch setting')
      res.status(500).json({ error: 'Failed to retrieve setting.' })
    }
  }

  /**
   * PUT /api/v1/admin/settings/:key
   * Upserts a single setting and audits the change.
   */
  public static async upsertSetting(req: Request, res: Response): Promise<void> {
    try {
      const key = String(req.params.key)
      const parsed = singleSettingSchema.safeParse(req.body)

      if (!parsed.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: parsed.error.errors.map((e) => e.message),
        })
        return
      }

      try {
        assertNotSecret(key, parsed.data.value)
        assertNotPublishableAsPublic(key, parsed.data.isPublic)
      } catch (error: any) {
        res.status(400).json({ error: error.message })
        return
      }

      const previous = await prisma.systemSetting.findUnique({ where: { key } })
      const serialised =
        typeof parsed.data.value === 'string' ? parsed.data.value : JSON.stringify(parsed.data.value)

      const setting = await prisma.systemSetting.upsert({
        where: { key },
        update: {
          value: serialised,
          category: parsed.data.category,
          description: parsed.data.description,
          isPublic: parsed.data.isPublic,
          updatedBy: req.user?.email,
        },
        create: {
          key,
          value: serialised,
          category: parsed.data.category ?? SettingCategory.GENERAL,
          description: parsed.data.description,
          isPublic: parsed.data.isPublic ?? false,
          updatedBy: req.user?.email,
        },
      })

      await AuditService.record({
        action: previous ? 'SETTING_UPDATED' : 'SETTING_CREATED',
        entity: 'SystemSetting',
        entityId: key,
        metadata: {
          key,
          category: setting.category,
          isPublic: setting.isPublic,
          previousValue: previous ? parseValue(previous.value) : null,
          newValue: parseValue(setting.value),
          updatedBy: req.user?.email,
        },
        req,
      })

      res.status(200).json({
        success: true,
        message: 'Setting saved.',
        setting: {
          key: setting.key,
          category: setting.category,
          value: parseValue(setting.value),
          description: setting.description,
          isPublic: setting.isPublic,
          updatedAt: setting.updatedAt.toISOString(),
        },
      })
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to update setting')
      res.status(500).json({ error: 'Failed to save setting.' })
    }
  }

  /**
   * PUT /api/v1/admin/settings
   * Bulk upsert used by the admin settings screens.
   */
  public static async bulkUpsertSettings(req: Request, res: Response): Promise<void> {
    try {
      const parsed = bulkSettingsSchema.safeParse(req.body)

      if (!parsed.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: parsed.error.errors.map((e) => e.message),
        })
        return
      }

      for (const entry of parsed.data.settings) {
        try {
          assertNotSecret(entry.key, entry.value)
          assertNotPublishableAsPublic(entry.key, entry.isPublic)
        } catch (error: any) {
          res.status(400).json({ error: error.message })
          return
        }
      }

      const previousSettings = await prisma.systemSetting.findMany({
        where: { key: { in: parsed.data.settings.map((s) => s.key) } },
      })
      const previousMap = new Map(previousSettings.map((s) => [s.key, s]))

      const operations = parsed.data.settings.map((entry) =>
        prisma.systemSetting.upsert({
          where: { key: entry.key },
          update: {
            value: typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value),
            category: entry.category,
            description: entry.description,
            isPublic: entry.isPublic,
            updatedBy: req.user?.email,
          },
          create: {
            key: entry.key,
            value: typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value),
            category: entry.category ?? SettingCategory.GENERAL,
            description: entry.description,
            isPublic: entry.isPublic ?? false,
            updatedBy: req.user?.email,
          },
        }),
      )

      await prisma.$transaction(operations)

      await AuditService.record({
        action: 'SETTINGS_BULK_UPDATED',
        entity: 'SystemSetting',
        metadata: {
          keys: parsed.data.settings.map((s) => s.key),
          changes: parsed.data.settings.map((s) => ({
            key: s.key,
            previousValue: previousMap.has(s.key) ? parseValue(previousMap.get(s.key)!.value) : null,
            newValue: s.value,
            isPublic: s.isPublic,
          })),
          updatedBy: req.user?.email,
        },
        req,
      })

      res.status(200).json({ success: true, message: 'Settings saved.' })
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to bulk update settings')
      res.status(500).json({ error: 'Failed to save settings.' })
    }
  }
}
