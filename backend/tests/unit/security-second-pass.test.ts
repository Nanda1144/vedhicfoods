/**
 * Security Regression Tests — second-pass findings
 *
 * Companion to `hardened-boundaries.test.ts`. Same constraint: entirely DB-free, so
 * it runs in CI without a live PostgreSQL. Each block documents the specific
 * failure it pins down — the exploit path, not just the happy path — because a
 * regression test that only proves the new code works would pass just as happily
 * against the vulnerable version for every case where the exploit is not attempted.
 */

import crypto from 'crypto'
import { describe, it, expect } from 'vitest'
import { RoleName, OrderStatus } from '@prisma/client'

import {
  assertCanManageStaffAccount,
  assertCanAssignPermissions,
  actorRank,
  roleRank,
} from '../../src/utils/privilege'
import { isSecretKey, assertNoSecretKeys, normaliseSettingKey } from '../../src/utils/secret-keys'
import { clampPageSize, clampPageNumber, clampSearchTerm } from '../../src/utils/pagination'
import {
  isValidOrderTransition,
  allowedOrderTransitions,
  shouldRestockOnTransition,
} from '../../src/utils/order-status'
import { getClientIp } from '../../src/utils/client-ip'
import { getRawBody, captureRawBody } from '../../src/utils/raw-body'
import { RazorpayService } from '../../src/integrations/razorpay/razorpay.service'
import { AuthService } from '../../src/services/auth.service'
import { AppError } from '../../src/utils/errors'

// ============================================================
// C-1 — Staff privilege escalation
// ============================================================

describe('staff authority: rank-based privilege escalation', () => {
  const staff = { id: 'staff-1', role: RoleName.STAFF, roles: [RoleName.STAFF], permissions: ['staff.update'] }
  const admin = { id: 'admin-1', role: RoleName.ADMIN, roles: [RoleName.ADMIN], permissions: [] }
  const owner = { id: 'owner-1', role: RoleName.OWNER, roles: [RoleName.OWNER], permissions: [] }

  it('ranks roles so that authority is strictly ordered', () => {
    expect(roleRank(RoleName.OWNER)).toBeGreaterThan(roleRank(RoleName.ADMIN))
    expect(roleRank(RoleName.ADMIN)).toBeGreaterThan(roleRank(RoleName.STAFF))
    expect(roleRank(RoleName.STAFF)).toBeGreaterThan(roleRank(RoleName.CUSTOMER))
  })

  it('uses the highest role held, not just the primary role', () => {
    // A user demoted to CUSTOMER but retaining an ADMIN assignment is still an
    // ADMIN for authorisation purposes; ranking on `role` alone would under-rank them.
    expect(actorRank({ id: 'x', role: RoleName.CUSTOMER, roles: [RoleName.ADMIN] })).toBe(
      roleRank(RoleName.ADMIN)
    )
  })

  it('BLOCKS a STAFF account promoting itself to ADMIN', () => {
    // The original exploit: `staff.update` was enough, because the only guard
    // special-cased OWNER. ADMIN then bypasses every permission check.
    expect(() =>
      assertCanManageStaffAccount({
        actor: staff,
        targetId: 'staff-1',
        targetRole: RoleName.STAFF,
        requestedRole: RoleName.ADMIN,
        action: 'updateStaff',
      })
    ).toThrow(AppError)
  })

  it('BLOCKS a STAFF account promoting a colleague to ADMIN', () => {
    expect(() =>
      assertCanManageStaffAccount({
        actor: staff,
        targetId: 'staff-2',
        targetRole: RoleName.STAFF,
        requestedRole: RoleName.ADMIN,
        action: 'updateStaff',
      })
    ).toThrow(/at or above your own authority level/)
  })

  it('BLOCKS a STAFF account editing, resetting or deleting an ADMIN', () => {
    for (const action of ['updateStaff', 'resetStaffPassword', 'deleteStaff'] as const) {
      expect(() =>
        assertCanManageStaffAccount({
          actor: staff,
          targetId: 'admin-1',
          targetRole: RoleName.ADMIN,
          action,
        })
      ).toThrow(AppError)
    }
  })

  it('BLOCKS an ADMIN editing a peer ADMIN (no lateral reach)', () => {
    expect(() =>
      assertCanManageStaffAccount({
        actor: admin,
        targetId: 'admin-2',
        targetRole: RoleName.ADMIN,
        action: 'updateStaff',
      })
    ).toThrow(/at or above your own authority level/)
  })

  it('BLOCKS an ADMIN creating or promoting an OWNER', () => {
    expect(() =>
      assertCanManageStaffAccount({
        actor: admin,
        targetId: '',
        targetRole: RoleName.CUSTOMER,
        requestedRole: RoleName.OWNER,
        action: 'createStaff',
      })
    ).toThrow(AppError)
  })

  it('BLOCKS an ADMIN creating another ADMIN', () => {
    expect(() =>
      assertCanManageStaffAccount({
        actor: admin,
        targetId: '',
        targetRole: RoleName.CUSTOMER,
        requestedRole: RoleName.ADMIN,
        action: 'createStaff',
      })
    ).toThrow(AppError)
  })

  it('ALLOWS an OWNER to create an ADMIN and another OWNER', () => {
    expect(() =>
      assertCanManageStaffAccount({
        actor: owner,
        targetId: '',
        targetRole: RoleName.CUSTOMER,
        requestedRole: RoleName.ADMIN,
        action: 'createStaff',
      })
    ).not.toThrow()

    expect(() =>
      assertCanManageStaffAccount({
        actor: owner,
        targetId: '',
        targetRole: RoleName.CUSTOMER,
        requestedRole: RoleName.OWNER,
        action: 'createStaff',
      })
    ).not.toThrow()
  })

  it('ALLOWS an OWNER to manage an ADMIN, but never another OWNER', () => {
    expect(() =>
      assertCanManageStaffAccount({
        actor: owner,
        targetId: 'admin-1',
        targetRole: RoleName.ADMIN,
        action: 'updateStaff',
      })
    ).not.toThrow()

    expect(() =>
      assertCanManageStaffAccount({
        actor: owner,
        targetId: 'owner-2',
        targetRole: RoleName.OWNER,
        action: 'updateStaff',
      })
    ).toThrow(AppError)
  })

  it('BLOCKS a self role change even for the highest-privileged actor', () => {
    expect(() =>
      assertCanManageStaffAccount({
        actor: owner,
        targetId: 'owner-1',
        targetRole: RoleName.OWNER,
        requestedRole: RoleName.ADMIN,
        action: 'updateStaff',
      })
    ).toThrow(/cannot change your own role/)
  })

  it('ALLOWS a user to correct their own non-privileged details', () => {
    // Self-service edits must keep working: name/phone changes would otherwise
    // require another account to perform them.
    expect(() =>
      assertCanManageStaffAccount({
        actor: staff,
        targetId: 'staff-1',
        targetRole: RoleName.STAFF,
        action: 'updateStaff',
      })
    ).not.toThrow()
  })

  it('rejects an unauthenticated actor outright', () => {
    expect(() =>
      assertCanManageStaffAccount({
        actor: null,
        targetId: 'staff-2',
        targetRole: RoleName.STAFF,
        action: 'updateStaff',
      })
    ).toThrow(/Authentication required/)
  })

  it('fails closed on the per-user permission grant endpoint', () => {
    // The handler used to reply 200 and change nothing while recording a
    // `STAFF_PERMISSIONS_UPDATED` audit entry. Those rows are now real, so the
    // unit contract for the WRITER is its authority checks: nobody may write
    // their own permission set, and a non-privileged grantor may only hand out
    // slugs it already holds.
    expect(() =>
      assertCanAssignPermissions({
        actor: { id: 'me', role: RoleName.ADMIN, permissions: [] },
        targetId: 'me',
        requestedSlugs: ['staff.delete'],
        grantorPermissions: [],
      })
    ).toThrow(/cannot change your own permissions/)

    expect(() =>
      assertCanAssignPermissions({
        actor: { id: 'staff-1', role: RoleName.STAFF, permissions: ['orders.read'] },
        targetId: 'staff-2',
        requestedSlugs: ['orders.read', 'settings.update'],
        grantorPermissions: ['orders.read'],
      })
    ).toThrow(/do not hold that permission/)

    // An OWNER or ADMIN grantor bypasses the holds-check (they inherit every
    // permission) but still cannot target themselves.
    expect(() =>
      assertCanAssignPermissions({
        actor: { id: 'admin-1', role: RoleName.ADMIN, permissions: [] },
        targetId: 'staff-2',
        requestedSlugs: ['settings.update'],
        grantorPermissions: [],
      })
    ).not.toThrow()

    expect(() =>
      assertCanAssignPermissions({
        actor: { id: 'staff-1', role: RoleName.STAFF, permissions: ['orders.read'] },
        targetId: 'staff-2',
        requestedSlugs: ['orders.read'],
        grantorPermissions: ['orders.read'],
      })
    ).not.toThrow()

    expect(() =>
      assertCanAssignPermissions({
        actor: null,
        targetId: 'staff-2',
        requestedSlugs: ['orders.read'],
        grantorPermissions: [],
      })
    ).toThrow(/Authentication required/)
  })
})

// ============================================================
// H-4 — Deactivated / deleted accounts must not authenticate
// ============================================================

describe('account lifecycle enforcement', () => {
  const decide = (state: { exists: boolean; isActive: boolean; isDeleted: boolean }) => {
    // Mirrors `authenticate`: the token is valid, so only account state can stop it.
    return () => AuthService.assertAccountCanAuthenticate(state)
  }

  it('permits a live account', () => {
    expect(decide({ exists: true, isActive: true, isDeleted: false })).not.toThrow()
  })

  it('REJECTS a deactivated account with an unexpired token', () => {
    expect(decide({ exists: true, isActive: false, isDeleted: false })).toThrow(/deactivated/)
  })

  it('REJECTS a soft-deleted account', () => {
    expect(decide({ exists: true, isActive: true, isDeleted: true })).toThrow(/no longer active/)
  })

  it('REJECTS a hard-deleted account instead of silently downgrading it to CUSTOMER', () => {
    // The previous behaviour returned `{ roles: [CUSTOMER], permissions: [] }` and
    // let the request proceed, so a removed employee still authenticated.
    expect(decide({ exists: false, isActive: false, isDeleted: true })).toThrow(AppError)
  })
})

// ============================================================
// H-3 — Settings must not store or publish credentials
// ============================================================

describe('generic settings secret detection', () => {
  it('normalises separators and casing so lookalikes cannot slip through', () => {
    expect(normaliseSettingKey('  Razorpay.Key-Secret ')).toBe('razorpay_key_secret')
    expect(isSecretKey('Razorpay.Key-Secret')).toBe(true)
  })

  it('flags credential-shaped keys the old 14-item denylist missed', () => {
    // Each of these stored as cleartext `SystemSetting.value` before the fix.
    const previouslyAllowed = [
      'smtp_password',
      'apiKey',
      'brevo_api_key',
      'aws_secret_key',
      'private_key',
      'service_role_key',
      'db_pass',
      'admin_password',
      'STRIPE_SECRET_KEY',
      'client_secret',
      'smtp.credentials',
      'db.connectionString',
    ]

    for (const key of previouslyAllowed) {
      expect(isSecretKey(key), `${key} should be treated as a secret`).toBe(true)
    }
  })

  it('still flags every key the original denylist covered', () => {
    const original = [
      'razorpay_secret',
      'razorpay_key_secret',
      'razorpay_webhook_secret',
      'aws_secret',
      'aws_secret_access_key',
      'jwt_secret',
      'db_password',
      'database_password',
      'databaseurl',
      'encryption_key',
    ]

    for (const key of original) {
      expect(isSecretKey(key), `${key} should be treated as a secret`).toBe(true)
    }
  })

  it('does not flag ordinary configuration', () => {
    const allowed = [
      'support_email',
      'store_opening_hours',
      'free_shipping_threshold',
      'cod_enabled',
      'order_prefix',
      'maintenance_mode',
      'default_tax_rate',
      'inventory_alert_threshold',
    ]

    for (const key of allowed) {
      expect(isSecretKey(key), `${key} should not be treated as a secret`).toBe(false)
    }
  })

  it('does not flag settings that merely mention tokens or passwords as words', () => {
    expect(isSecretKey('tokenization_enabled')).toBe(false)
    expect(isSecretKey('passwordless_checkout_enabled')).toBe(false)
    expect(isSecretKey('password_min_length')).toBe(false)
  })

  it('catches a credential nested inside a benign top-level key', () => {
    // The settings UI nests config objects, which is how a key-name-only check is
    // bypassed: `{ notification_config: { smtp_password: '…' } }`.
    expect(() =>
      assertNoSecretKeys('notification_config', { smtp: { password: 'hunter2' } })
    ).toThrow(/credential/)
  })

  it('catches a credential nested inside an array', () => {
    expect(() =>
      assertNoSecretKeys('payment_channels', [{ name: 'razorpay', api_key: 'rzp_live_x' }])
    ).toThrow(AppError)
  })

  it('allows a nested value that contains no credential keys', () => {
    expect(() =>
      assertNoSecretKeys('notification_config', { smtp: { host: 'smtp.vedhicfoods.com', port: 587 } })
    ).not.toThrow()
  })

  it('bounds recursion instead of overflowing the stack', () => {
    let deep: Record<string, unknown> = { password: 'x' }
    for (let i = 0; i < 50; i += 1) deep = { nested: deep }
    expect(() => assertNoSecretKeys('config', deep)).toThrow(/nested too deeply/)
  })

  it('never echoes the offending value in the error message', () => {
    try {
      assertNoSecretKeys('smtp_password', 'super-secret-value')
      throw new Error('expected a throw')
    } catch (error: any) {
      expect(error.message).not.toContain('super-secret-value')
    }
  })
})

// ============================================================
// M-3 — Unbounded pagination
// ============================================================

describe('pagination clamping', () => {
  it('caps an oversized page size at the hard ceiling', () => {
    // Previously `?limit=1000000` became a `take` of one million rows.
    expect(clampPageSize('1000000')).toBe(100)
    expect(clampPageSize(999999)).toBe(100)
  })

  it('honours a requested size within bounds', () => {
    expect(clampPageSize('50')).toBe(50)
    expect(clampPageSize('1')).toBe(1)
  })

  it('falls back rather than propagating NaN into Prisma', () => {
    expect(clampPageSize('abc', 20)).toBe(20)
    expect(clampPageSize(undefined, 20)).toBe(20)
    expect(clampPageSize('', 20)).toBe(20)
    expect(clampPageSize('0', 20)).toBe(20)
    expect(clampPageSize('-5', 20)).toBe(20)
    expect(Number.isNaN(clampPageSize('not-a-number', 20))).toBe(false)
  })

  it('clamps page numbers to positive integers', () => {
    expect(clampPageNumber('3')).toBe(3)
    expect(clampPageNumber('0')).toBe(1)
    expect(clampPageNumber('-2')).toBe(1)
    expect(clampPageNumber('abc')).toBe(1)
  })

  it('bounds search terms', () => {
    expect(clampSearchTerm('  tea  ')).toBe('tea')
    expect(clampSearchTerm('x'.repeat(5000))).toHaveLength(200)
    expect(clampSearchTerm('   ')).toBeUndefined()
  })
})

// ============================================================
// M-4 — Order status must follow a state machine
// ============================================================

describe('order status transitions', () => {
  it('BLOCKS taking an unpaid order straight to DELIVERED', () => {
    // The exploit: `status` came straight from the request body, so any enum value
    // was reachable from any state.
    expect(isValidOrderTransition(OrderStatus.PENDING_PAYMENT, OrderStatus.DELIVERED)).toBe(false)
    expect(isValidOrderTransition(OrderStatus.PENDING, OrderStatus.SHIPPED)).toBe(false)
    expect(isValidOrderTransition(OrderStatus.PENDING_PAYMENT, OrderStatus.PACKED)).toBe(false)
  })

  it('BLOCKS skipping the fulfilment sequence', () => {
    expect(isValidOrderTransition(OrderStatus.CONFIRMED, OrderStatus.SHIPPED)).toBe(false)
    expect(isValidOrderTransition(OrderStatus.PROCESSING, OrderStatus.OUT_FOR_DELIVERY)).toBe(false)
    expect(isValidOrderTransition(OrderStatus.PACKED, OrderStatus.DELIVERED)).toBe(false)
  })

  it('permits the normal progression', () => {
    expect(isValidOrderTransition(OrderStatus.PENDING_PAYMENT, OrderStatus.CONFIRMED)).toBe(true)
    expect(isValidOrderTransition(OrderStatus.CONFIRMED, OrderStatus.PROCESSING)).toBe(true)
    expect(isValidOrderTransition(OrderStatus.PROCESSING, OrderStatus.PACKED)).toBe(true)
    expect(isValidOrderTransition(OrderStatus.PACKED, OrderStatus.SHIPPED)).toBe(true)
    expect(isValidOrderTransition(OrderStatus.SHIPPED, OrderStatus.OUT_FOR_DELIVERY)).toBe(true)
    expect(isValidOrderTransition(OrderStatus.OUT_FOR_DELIVERY, OrderStatus.DELIVERED)).toBe(true)
  })

  it('permits cancellation from any non-terminal fulfilment state', () => {
    for (const from of [
      OrderStatus.PENDING,
      OrderStatus.PENDING_PAYMENT,
      OrderStatus.CONFIRMED,
      OrderStatus.PROCESSING,
      OrderStatus.PACKED,
    ]) {
      expect(isValidOrderTransition(from, OrderStatus.CANCELLED)).toBe(true)
    }
  })

  it('treats terminal states as terminal', () => {
    expect(allowedOrderTransitions(OrderStatus.CANCELLED)).toHaveLength(0)
    expect(allowedOrderTransitions(OrderStatus.FAILED)).toHaveLength(0)
    expect(allowedOrderTransitions(OrderStatus.DELIVERED)).toHaveLength(0)
    expect(isValidOrderTransition(OrderStatus.CANCELLED, OrderStatus.CONFIRMED)).toBe(false)
  })

  it('restocks only on entry to a restocking state', () => {
    expect(shouldRestockOnTransition(OrderStatus.CONFIRMED, OrderStatus.CANCELLED)).toBe(true)
    expect(shouldRestockOnTransition(OrderStatus.PROCESSING, OrderStatus.FAILED)).toBe(true)
    // Already released — must not double-restock.
    expect(shouldRestockOnTransition(OrderStatus.CANCELLED, OrderStatus.CANCELLED)).toBe(false)
    // Never released.
    expect(shouldRestockOnTransition(OrderStatus.CONFIRMED, OrderStatus.SHIPPED)).toBe(false)
  })
})

// ============================================================
// H-6 — Client IP must not be client-controlled
// ============================================================

describe('client IP resolution', () => {
  const reqWith = (ip: string | undefined, forwarded?: string) =>
    ({
      ip,
      headers: forwarded ? { 'x-forwarded-for': forwarded } : {},
      socket: { remoteAddress: '10.0.0.9' },
    }) as any

  it('uses the proxy-aware address Express derived', () => {
    expect(getClientIp(reqWith('203.0.113.7'))).toBe('203.0.113.7')
  })

  it('ignores a spoofed X-Forwarded-For leftmost entry', () => {
    // `trust proxy` has already resolved the trusted hop count by the time
    // `req.ip` is computed, so the client-chosen entry cannot survive.
    expect(getClientIp(reqWith('203.0.113.7', '1.2.3.4'))).toBe('203.0.113.7')
  })

  it('falls back to the socket address when Express cannot resolve one', () => {
    expect(getClientIp(reqWith(undefined, '1.2.3.4'))).toBe('10.0.0.9')
  })

  it('returns null when there is nothing trustworthy to report', () => {
    expect(getClientIp({ headers: {}, socket: {} } as any)).toBeNull()
  })
})

// ============================================================
// M-8 / H-1 — Webhook signature must cover the exact bytes
// ============================================================

describe('Razorpay webhook signature verification', () => {
  const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1' } } } })
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET || ''

  const sign = (payload: Buffer | string) =>
    crypto.createHmac('sha256', secret).update(payload).digest('hex')

  it('accepts a correctly signed Buffer payload', () => {
    const buf = Buffer.from(body, 'utf8')
    expect(RazorpayService.verifyWebhookSignature(buf, sign(buf))).toBe(true)
  })

  it('produces the same digest for Buffer and string forms of valid UTF-8', () => {
    // Confirms the signature check itself is unchanged; only the transport is stricter.
    const buf = Buffer.from(body, 'utf8')
    expect(sign(buf)).toBe(sign(body))
  })

  it('does not hash the UTF-8 replacement character in place of invalid bytes', () => {
    // The old path decoded to a string and re-encoded it, substituting U+FFFD for
    // every invalid byte. This asserts the digest is taken over the raw bytes.
    const invalid = Buffer.from([0xff, 0xfe, 0x00, 0x41])
    const naive = crypto
      .createHmac('sha256', secret)
      .update(Buffer.from(invalid.toString('utf8'), 'utf8'))
      .digest('hex')
    const exact = crypto.createHmac('sha256', secret).update(invalid).digest('hex')

    expect(exact).not.toBe(naive)
    // And the verifier must agree with the exact digest, not the lossy one.
    expect(RazorpayService.verifyWebhookSignature(invalid, exact)).toBe(true)
    expect(RazorpayService.verifyWebhookSignature(invalid, naive)).toBe(false)
  })

  it('rejects a tampered payload', () => {
    const buf = Buffer.from(body, 'utf8')
    const signature = sign(buf)
    const tampered = Buffer.from(body.replace('pay_1', 'pay_2'), 'utf8')
    expect(RazorpayService.verifyWebhookSignature(tampered, signature)).toBe(false)
  })

  it('rejects a malformed signature without throwing', () => {
    expect(RazorpayService.verifyWebhookSignature(Buffer.from(body), 'not-hex')).toBe(false)
    expect(RazorpayService.verifyWebhookSignature(Buffer.from(body), '')).toBe(false)
  })

  it('fails closed when no raw body was preserved', () => {
    expect(getRawBody({ headers: {}, url: '' } as any)).toBeUndefined()
  })

  it('returns the exact bytes that were received', () => {
    const buf = Buffer.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0xff, 0x7d])
    const req: any = { originalUrl: '/api/v1/payments/razorpay/webhook', headers: {} }
    captureRawBody(req, {} as any, buf)
    expect(getRawBody(req)).toEqual(buf)
  })

  it('only captures for the webhook path', () => {
    const req: any = { originalUrl: '/api/v1/orders', headers: {} }
    captureRawBody(req, {} as any, Buffer.from('{}'))
    expect(getRawBody(req)).toBeUndefined()
  })
})