import { describe, expect, it } from 'vitest'
import { adminAuthService } from '@/services/adminAuthService'
import type { AdminSession } from '@/services/adminAuthService'
import { PERMISSIONS, permissionLabel } from '@/data/admin'
import type { Permission } from '@/types'

/**
 * Regression coverage for the admin console gating every control on a permission
 * slug the backend can never grant.
 *
 * This is the third time this repository has shipped a slug mismatch between the
 * console and `requirePermission` (the previous two are documented at
 * `backend/src/routes/admin.routes.ts` around the dashboard and customers routes).
 * All three failed the same way: the slug existed only on one side, so the UI
 * check and the API check disagreed and the failure was invisible in review.
 *
 * The original instance was total. `Permission` used a colon-separated
 * read/write-collapsed scheme (`products:read`) while the database seeds
 * dot-separated, verb-specific slugs (`products.read`, `products.update`).
 * `toPermissions()` cast the server response to that type without translating and
 * `can()` did a literal `includes()`, so every check returned false for every
 * role. With the old `isOwner` bypass gone, the owner was locked out of their own
 * console alongside everyone else.
 *
 * These tests treat the backend's vocabulary as the contract:
 *   1. `can()` must match the exact slugs the server sends.
 *   2. No colon-style slug may reappear anywhere in the console's source.
 *   3. Every slug the nav and route table gate on must be one the API enforces.
 */

/**
 * Mirrors the slugs `requirePermission(...)` is actually called with across
 * `backend/src/routes/*.routes.ts`. Kept literal rather than read from the backend
 * so a mismatch fails loudly here instead of silently passing wherever the
 * backend happens to be checked out.
 */
const BACKEND_ENFORCED_SLUGS = new Set([
  'products.read',
  'products.create',
  'products.update',
  'products.delete',
  'categories.read',
  'categories.create',
  'categories.update',
  'categories.delete',
  'inventory.read',
  'inventory.update',
  'orders.read',
  'orders.update',
  'orders.cancel',
  'customers.read',
  'customers.update',
  'delivery.read',
  'delivery.update',
  'delivery.assign',
  'invoices.read',
  'invoices.create',
  'discounts.read',
  'discounts.create',
  'discounts.update',
  'discounts.delete',
  'support.read',
  'support.reply',
  'support.update',
  'support.assign',
  'support.close',
  'contacts.read',
  'contacts.manage',
  'settings.read',
  'settings.update',
  'staff.read',
  'staff.create',
    'staff.update',
    'staff.delete',
    'reports.read',
    'audit_logs.read',
    'content.read',
    'content.update',
  ])

/** Exactly what `GET /api/v1/admin/auth/login` puts in `user.permissions`. */
const SERVER_GRANTS = [
  'products.read',
  'products.create',
  'products.update',
  'products.delete',
  'categories.read',
  'categories.create',
  'categories.update',
  'categories.delete',
  'inventory.read',
  'inventory.update',
  'orders.read',
  'orders.update',
  'orders.cancel',
  'customers.read',
  'customers.update',
  'delivery.read',
  'delivery.update',
  'delivery.assign',
  'invoices.read',
  'invoices.create',
  'discounts.read',
  'discounts.create',
  'discounts.update',
  'discounts.delete',
  'support.read',
  'support.reply',
  'support.update',
  'support.assign',
  'support.close',
  'contacts.read',
  'contacts.manage',
  'settings.read',
  'settings.update',
  'staff.read',
  'staff.create',
    'staff.update',
    'staff.delete',
    'reports.read',
    'audit_logs.read',
    'content.read',
    'content.update',
  ]

function sessionWith(permissions: string[]): AdminSession {
  return {
    id: 'usr_1',
    name: 'Vedhic Krishnan',
    email: 'vedhic@vedhifoods.example',
    role: 'owner',
    title: 'Owner',
    permissions: permissions as Permission[],
    token: 'token-abc',
    remember: true,
    signedInAt: new Date(0).toISOString(),
  }
}

describe('adminAuthService.can() against real server grants', () => {
  // THE REGRESSION. A full grant set must satisfy the checks the nav performs,
  // otherwise the console hides its whole navigation and redirects every guarded
  // route for every role, including the owner.
  it('grants access when the server returns its own slug vocabulary', () => {
    const session = sessionWith(SERVER_GRANTS)

    for (const slug of SERVER_GRANTS) {
      expect(adminAuthService.can(session, slug as Permission)).toBe(true)
    }
  })

  it('grants the specific permissions the navigation gates on', () => {
    const session = sessionWith(SERVER_GRANTS)

    // One representative per nav entry, as they are actually written today.
      const navPermissions: Permission[] = [
        'products.read',
        'categories.read',
        'inventory.read',
        'orders.read',
        'customers.read',
        'delivery.read',
        'invoices.read',
        'discounts.read',
        'support.read',
        'settings.read',
        'staff.read',
        'audit_logs.read',
        'reports.read',
        'content.read',
      ]

    for (const permission of navPermissions) {
      expect(adminAuthService.can(session, permission)).toBe(true)
    }
  })

  it('still refuses a slug the server did not grant', () => {
    const session = sessionWith(['products.read'])

    expect(adminAuthService.can(session, 'products.read')).toBe(true)
    expect(adminAuthService.can(session, 'products.delete')).toBe(false)
    expect(adminAuthService.can(session, 'staff.update')).toBe(false)
  })

  it('refuses everything when there is no session', () => {
    expect(adminAuthService.can(null, 'products.read')).toBe(false)
  })

  // A grant of `products.update` must not imply `products.delete`. Collapsing
  // read/write was part of the original scheme; verb-specific grants are the
  // reason the backend can scope deletes and creates separately.
  it('does not treat an update grant as a delete or create grant', () => {
    const session = sessionWith(['products.update'])

    expect(adminAuthService.can(session, 'products.update')).toBe(true)
    expect(adminAuthService.can(session, 'products.delete')).toBe(false)
    expect(adminAuthService.can(session, 'products.create')).toBe(false)
  })
})

describe('permission slug vocabulary', () => {
  it('never uses the colon-separated scheme anywhere in the console source', async () => {
    const { readdir, readFile } = await import('node:fs/promises')
    const { join } = await import('node:path')

    const root = new URL('../src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
    const offenders: string[] = []

    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          await walk(full)
        } else if (/\.(ts|tsx)$/.test(entry.name)) {
          const source = await readFile(full, 'utf8')
          // A quoted `word:word` pair is the old permission scheme. Anything else
          // using a colon (a URL, a time) does not match this shape.
          const matches = source.match(/'[a-z_]+:[a-z]+'/g)
          if (matches) offenders.push(`${full}: ${[...new Set(matches)].join(', ')}`)
        }
      }
    }

    await walk(root)

    expect(
      offenders,
      `Colon-separated permission slugs reintroduced. Use the seeded dot slugs, e.g. 'products.read':\n${offenders.join('\n')}`,
    ).toEqual([])
  })

  it('only gates the console on slugs the backend actually enforces', async () => {
    const { readFile } = await import('node:fs/promises')

    const navPath = new URL('../src/data/adminNavigation.ts', import.meta.url).pathname.replace(
      /^\/([A-Za-z]:)/,
      '$1',
    )
    const nav = await readFile(navPath, 'utf8')

    const used = [...nav.matchAll(/permission:\s*'([^']+)'/g)].map(m => m[1])

    expect(used.length).toBeGreaterThan(0)

    for (const slug of used) {
      expect(
        BACKEND_ENFORCED_SLUGS.has(slug),
        `'${slug}' is gated in the navigation but no backend route enforces it, so the ` +
          'item would render and then be refused with a 403. Point it at the slug the ' +
          'corresponding route actually requires.',
      ).toBe(true)
    }
  })

  it('declares each permission exactly once', () => {
    const seen = new Set<string>()

    for (const permission of PERMISSIONS) {
      expect(
        seen.has(permission),
        `'${permission}' is listed more than once in PERMISSIONS. Duplicates are not merely redundant: PERMISSIONS drives the permission-matrix table, so each repeat renders a second <tr> with the same React key and a duplicate row.`,
      ).toBe(false)
      seen.add(permission)
    }
  })

  it('derives the module name by splitting on the dot, not the old colon', async () => {
    const { readdir, readFile } = await import('node:fs/promises')
    const { join } = await import('node:path')

    const root = new URL('../src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
    const offenders: string[] = []

    // This closes a hole in the test above. That one matches quoted `word:word`
    // pairs, which catches a reintroduced `'products:read'` literal but cannot see
    // `split(':')` — the colon there has no word before it. So the `split(':')[0]`
    // leftover in the permissions matrix passed CI while rendering every module
    // label as the full slug ("products.read" instead of "products").
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          await walk(full)
        } else if (/\.(ts|tsx)$/.test(entry.name)) {
          const source = await readFile(full, 'utf8')
          if (/permission\s*\.\s*split\(\s*['"]:/i.test(source)) offenders.push(full)
        }
      }
    }

    await walk(root)

    expect(
      offenders,
      `Permissions are dot-separated; split on '.', e.g. permission.split('.')[0]:\n${offenders.join('\n')}`,
    ).toEqual([])
  })

  it('labels permissions by splitting on the dot', () => {
    expect(permissionLabel('audit_logs.read')).toBe('Audit Logs · Read')
    expect(permissionLabel('products.update')).toBe('Products · Update')

    // A slug without an action segment must render as readable text rather than
    // "Module · undefined".
    expect(permissionLabel('staff' as Permission)).toBe('Staff')
  })
})