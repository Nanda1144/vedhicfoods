/**
 * Demo customer fixture for integration suites.
 *
 * `database/seed.ts` deliberately deletes `customer@vedhicfoods.com` in its
 * privacy cleanup (`purgeMockData`) and never recreates it, so any suite that
 * logs in as the demo customer aborts with `UnauthorizedError: Invalid email or
 * password.` This helper restores that account against the disposable test
 * database only, mirroring the exact User shape both `AuthService.register` and
 * `database/seed.ts` produce:
 *
 *   - a bcryptjs hash at the application's own cost (`AuthService.hashPassword`
 *     -> BCRYPT_ROUNDS = 12), so verification takes the real code path;
 *   - the CUSTOMER role on the `User` row *and* the `user_roles` join row that
 *     `resolveUserPermissions` reads, so RBAC behaves as for any real customer;
 *   - `isActive` / `isVerified` true and `isDeleted` false so login succeeds;
 *   - a unique phone, or none if the fixture number already belongs to another
 *     account (`User.phone` is unique) — never overwriting a real record.
 *
 * Idempotent: keyed on the unique email via `upsert`, so suites that share the
 * un-truncated test database can each call it on every run.
 */

import { RoleName } from '@prisma/client'
import { prisma } from '../../../src/config/database'
import { AuthService } from '../../../src/services/auth.service'

export const DEMO_CUSTOMER_EMAIL = 'customer@vedhicfoods.com'
export const DEMO_CUSTOMER_PASSWORD = 'Customer@Vedhic2026'

const DEMO_CUSTOMER_PHONE = '+919000000101'

/**
 * Returns the fixture phone only when it is free or already owned by the demo
 * account; otherwise undefined. Mirrors `safeSeedPhone` in database/seed.ts.
 */
async function safeDemoPhone(): Promise<string | undefined> {
  const owner = await prisma.user.findUnique({
    where: { phone: DEMO_CUSTOMER_PHONE },
    select: { email: true },
  })
  if (owner && owner.email !== DEMO_CUSTOMER_EMAIL) return undefined
  return DEMO_CUSTOMER_PHONE
}

export async function ensureDemoCustomer() {
  const passwordHash = await AuthService.hashPassword(DEMO_CUSTOMER_PASSWORD)
  const phone = await safeDemoPhone()

  const user = await prisma.user.upsert({
    where: { email: DEMO_CUSTOMER_EMAIL },
    update: {
      passwordHash,
      role: RoleName.CUSTOMER,
      isActive: true,
      isVerified: true,
      isDeleted: false,
      ...(phone ? { phone } : {}),
    },
    create: {
      email: DEMO_CUSTOMER_EMAIL,
      fullName: 'Vedhic Demo Customer',
      phone,
      passwordHash,
      role: RoleName.CUSTOMER,
      isActive: true,
      isVerified: true,
    },
  })

  const customerRole = await prisma.role.findUnique({ where: { name: RoleName.CUSTOMER } })
  if (customerRole) {
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: customerRole.id } },
      update: {},
      create: { userId: user.id, roleId: customerRole.id, assignedBy: 'SYSTEM_TEST' },
    })
  }

  return user
}
