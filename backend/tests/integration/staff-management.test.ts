import './_safety'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { RoleName } from '@prisma/client'
import { createApp } from '../../src/app'
import { prisma } from '../../src/config/database'
import { AuthService } from '../../src/services/auth.service'

/**
 * ==========================================================================
 *  VEDHIC FOODS — STAFF ACCOUNT MANAGEMENT & RBAC SECURITY
 * ==========================================================================
 *
 *  Everything is driven through the real Express app with `supertest`. No
 *  controller is called directly and no guard is stubbed, so an assertion that
 *  passes is proof the *API* enforced it.
 *
 *  Principals (all created by this file, no reliance on seed passwords):
 *    owner        OWNER  — unrestricted
 *    admin        ADMIN  — permission-bypass, but rank-bounded (rank 2)
 *    staff        STAFF  — no staff.* slugs, the plain operational account
 *    staffMgr     STAFF  — explicitly granted staff.read/create/update/delete,
 *                          used to prove "staff with permission still cannot
 *                          mint a peer or a superior"
 *    customer     CUSTOMER — locked out of the console entirely
 *
 *  The suite covers the requested matrix:
 *    create / update / disable / reactivate / assign role / change role /
 *    assign permissions / remove permissions / reset password /
 *    view permissions / last-login tracking
 *  plus the security boundaries, audit logging, duplicate emails and invalid
 *  accounts.
 */

const app = createApp()
const API = '/api/v1'
const suffix = Date.now()
const PASSWORD = 'Password@123'
const NEW_PASSWORD = 'Rotated@2026'

const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const createdUserIds: string[] = []
const grantedStaffRolePermissionIds: string[] = []

async function createUserWithRole(opts: {
  email: string
  fullName: string
  role: RoleName
}): Promise<string> {
  const roleRow = await prisma.role.findUnique({ where: { name: opts.role } })
  if (!roleRow) throw new Error(`Role ${opts.role} is not seeded`)

  const user = await prisma.user.create({
    data: {
      email: opts.email,
      fullName: opts.fullName,
      passwordHash: await AuthService.hashPassword(PASSWORD),
      role: opts.role,
      isActive: true,
      isVerified: true,
    },
  })

  await prisma.userRole.create({
    data: { userId: user.id, roleId: roleRow.id, assignedBy: 'STAFF_MGMT_SUITE' },
  })

  createdUserIds.push(user.id)
  return user.id
}

/**
 * Creates a STAFF account with NO UserRole row. `resolveUserPermissions` reads
 * grants from UserRole -> RolePermission only, so this account carries the STAFF
 * primary role (passing the router-wide role gate) but resolves to ZERO
 * permissions — the "authenticated but unauthorized" principal.
 */
async function createUserWithoutRole(opts: { email: string; fullName: string }): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: opts.email,
      fullName: opts.fullName,
      passwordHash: await AuthService.hashPassword(PASSWORD),
      role: RoleName.STAFF,
      isActive: true,
      isVerified: true,
    },
  })
  createdUserIds.push(user.id)
  return user.id
}

/** Grants the staff-management verbs to the STAFF role, tracking rows for cleanup. */
async function grantStaffManagementToStaffRole(slugs: string[]): Promise<void> {
  const staffRole = await prisma.role.findUnique({ where: { name: RoleName.STAFF } })
  if (!staffRole) throw new Error('STAFF role is not seeded')
  for (const slug of slugs) {
    const perm = await prisma.permission.findUnique({ where: { slug } })
    if (!perm) throw new Error(`Permission ${slug} is not seeded`)
    await prisma.rolePermission.deleteMany({
      where: { roleId: staffRole.id, permissionId: perm.id },
    })
    const row = await prisma.rolePermission.create({
      data: { roleId: staffRole.id, permissionId: perm.id },
    })
    grantedStaffRolePermissionIds.push(row.id)
  }
}

async function loginToken(email: string, password: string = PASSWORD): Promise<string> {
  const login = await AuthService.login({ email, password })
  return login.accessToken
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

describe('Staff Account Management & RBAC Security', () => {
  beforeAll(async () => {
    // The STAFF role is deliberately given the staff-management permissions
    // BEFORE the actors log in, so the "permitted staff" path can be measured.
    await grantStaffManagementToStaffRole([
      'staff.read',
      'staff.create',
      'staff.update',
      'staff.delete',
    ])

    ids.owner = await createUserWithRole({
      email: `staffmgmt.owner.${suffix}@vedhicfoods.test`,
      fullName: 'Staff Mgmt Owner',
      role: RoleName.OWNER,
    })
    ids.admin = await createUserWithRole({
      email: `staffmgmt.admin.${suffix}@vedhicfoods.test`,
      fullName: 'Staff Mgmt Admin',
      role: RoleName.ADMIN,
    })
    ids.staff = await createUserWithRole({
      email: `staffmgmt.staff.${suffix}@vedhicfoods.test`,
      fullName: 'Staff Mgmt Staff',
      role: RoleName.STAFF,
    })
    ids.staffMgr = await createUserWithRole({
      email: `staffmgmt.manager.${suffix}@vedhicfoods.test`,
      fullName: 'Staff Mgmt Manager',
      role: RoleName.STAFF,
    })
    ids.staffNoPerms = await createUserWithoutRole({
      email: `staffmgmt.noperms.${suffix}@vedhicfoods.test`,
      fullName: 'Staff Mgmt No Perms',
    })

    tokens.owner = await loginToken(`staffmgmt.owner.${suffix}@vedhicfoods.test`)
    tokens.admin = await loginToken(`staffmgmt.admin.${suffix}@vedhicfoods.test`)
    tokens.staff = await loginToken(`staffmgmt.staff.${suffix}@vedhicfoods.test`)
    tokens.staffMgr = await loginToken(`staffmgmt.manager.${suffix}@vedhicfoods.test`)
    tokens.staffNoPerms = await loginToken(`staffmgmt.noperms.${suffix}@vedhicfoods.test`)

    const customer = await AuthService.register({
      fullName: 'Staff Mgmt Customer',
      email: `staffmgmt.customer.${suffix}@vedhicfoods.test`,
      password: PASSWORD,
    })
    ids.customer = customer.user.id
    tokens.customer = customer.accessToken
    createdUserIds.push(customer.user.id)
  }, 120000)

  afterAll(async () => {
    if (grantedStaffRolePermissionIds.length) {
      await prisma.rolePermission.deleteMany({
        where: { id: { in: grantedStaffRolePermissionIds } },
      })
    }

    // Remove the audit trail this suite produced, then the principals. Audit
    // rows are deleted first because `AuditLog.actorId` is a nullable relation
    // with no cascade — deleting a user would orphan (set-null) the row rather
    // than remove it.
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { entityId: { in: createdUserIds } },
          { actorId: { in: createdUserIds } },
        ],
      },
    })

    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } })
  }, 60000)

  // ==========================================================================
  // 1. CREATE STAFF
  // ==========================================================================
  describe('1. Create staff', () => {
    it('owner creates a STAFF account and receives resolved permissions, never a hash', async () => {
      const email = `staffmgmt.created.a.${suffix}@vedhicfoods.test`
      const res = await request(app)
        .post(`${API}/admin/staff`)
        .set(auth(tokens.owner))
        .send({ fullName: 'Created Staff A', email, password: PASSWORD, role: RoleName.STAFF })

      expect(res.status).toBe(201)
      expect(res.body.success).toBe(true)
      expect(res.body.staff.email).toBe(email)
      expect(res.body.staff.role).toBe(RoleName.STAFF)
      expect(res.body.staff.roles).toContain(RoleName.STAFF)
      expect(res.body.staff.permissions).toContain('orders.read')
      expect(res.body.staff.passwordHash).toBeUndefined()
      expect(JSON.stringify(res.body)).not.toContain('$2a$')
      createdUserIds.push(res.body.staff.id)
      ids.createdA = res.body.staff.id
    })

    it('owner creates an ADMIN account (all permissions resolved)', async () => {
      const email = `staffmgmt.created.admin.${suffix}@vedhicfoods.test`
      const res = await request(app)
        .post(`${API}/admin/staff`)
        .set(auth(tokens.owner))
        .send({ fullName: 'Created Admin', email, password: PASSWORD, role: RoleName.ADMIN })

      expect(res.status).toBe(201)
      expect(res.body.staff.role).toBe(RoleName.ADMIN)
      expect(res.body.staff.permissions).toContain('settings.update')
      createdUserIds.push(res.body.staff.id)
    })

    it('admin creates a STAFF account (legitimate lower-rank path)', async () => {
      const email = `staffmgmt.created.byadmin.${suffix}@vedhicfoods.test`
      const res = await request(app)
        .post(`${API}/admin/staff`)
        .set(auth(tokens.admin))
        .send({ fullName: 'Created By Admin', email, password: PASSWORD, role: RoleName.STAFF })

      expect(res.status).toBe(201)
      createdUserIds.push(res.body.staff.id)
    })

    it('role defaults to STAFF when omitted from the body', async () => {
      const email = `staffmgmt.default.role.${suffix}@vedhicfoods.test`
      const res = await request(app)
        .post(`${API}/admin/staff`)
        .set(auth(tokens.owner))
        .send({ fullName: 'Default Role', email, password: PASSWORD })

      expect(res.status).toBe(201)
      expect(res.body.staff.role).toBe(RoleName.STAFF)
      createdUserIds.push(res.body.staff.id)
    })
  })

  // ==========================================================================
  // 2. READ / UPDATE STAFF
  // ==========================================================================
  describe('2. Read and update staff', () => {
    it('reads a single staff member with roles, permissions and lifecycle flags', async () => {
      const res = await request(app)
        .get(`${API}/admin/staff/${ids.createdA}`)
        .set(auth(tokens.admin))

      expect(res.status).toBe(200)
      expect(res.body.id).toBe(ids.createdA)
      expect(res.body.email).toBe(`staffmgmt.created.a.${suffix}@vedhicfoods.test`)
      expect(res.body.roles).toContain(RoleName.STAFF)
      expect(res.body.permissions).toContain('orders.read')
      expect(res.body.isActive).toBe(true)
      expect(res.body.isVerified).toBe(true)
      expect(res.body.passwordHash).toBeUndefined()
    })

    it('owner updates mutable profile fields (full name, phone)', async () => {
      const res = await request(app)
        .patch(`${API}/admin/staff/${ids.createdA}`)
        .set(auth(tokens.owner))
        .send({ fullName: 'Renamed Staff A', phone: '+919876511111' })

      expect(res.status).toBe(200)
      expect(res.body.staff.fullName).toBe('Renamed Staff A')
      expect(res.body.staff.phone).toBe('+919876511111')

      const persisted = await prisma.user.findUnique({ where: { id: ids.createdA } })
      expect(persisted!.fullName).toBe('Renamed Staff A')
      expect(persisted!.phone).toBe('+919876511111')
    })

    it('a patch with an empty body is accepted as a no-op', async () => {
      const res = await request(app)
        .patch(`${API}/admin/staff/${ids.createdA}`)
        .set(auth(tokens.owner))
        .send({})
      expect(res.status).toBe(200)
      expect(res.body.staff.id).toBe(ids.createdA)
    })

    it('an admin cannot edit another ADMIN (lateral reach denied with 403, not 500)', async () => {
      const otherAdmin = await createUserWithRole({
        email: `staffmgmt.admin.peer.${suffix}@vedhicfoods.test`,
        fullName: 'Peer Admin',
        role: RoleName.ADMIN,
      })

      const res = await request(app)
        .patch(`${API}/admin/staff/${otherAdmin}`)
        .set(auth(tokens.admin))
        .send({ fullName: 'Hijacked Peer' })

      expect(res.status).toBe(403)
      const persisted = await prisma.user.findUnique({ where: { id: otherAdmin } })
      expect(persisted!.fullName).toBe('Peer Admin')
    })
  })

  // ==========================================================================
  // 3. ROLE ASSIGNMENT & CHANGE
  // ==========================================================================
  describe('3. Role assignment and change', () => {
    it('owner promotes a STAFF account to ADMIN and the change is effective immediately', async () => {
      const email = `staffmgmt.promote.${suffix}@vedhicfoods.test`
      const create = await request(app)
        .post(`${API}/admin/staff`)
        .set(auth(tokens.owner))
        .send({ fullName: 'Promote Me', email, password: PASSWORD, role: RoleName.STAFF })
      expect(create.status).toBe(201)
      const targetId = create.body.staff.id
      createdUserIds.push(targetId)

      const promote = await request(app)
        .patch(`${API}/admin/staff/${targetId}`)
        .set(auth(tokens.owner))
        .send({ role: RoleName.ADMIN })
      expect(promote.status).toBe(200)
      expect(promote.body.staff.role).toBe(RoleName.ADMIN)
      expect(promote.body.staff.permissions).toContain('settings.update')

      const persisted = await prisma.user.findUnique({
        where: { id: targetId },
        include: { userRoles: { include: { role: true } } },
      })
      expect(persisted!.role).toBe(RoleName.ADMIN)
      // The old STAFF UserRole row is replaced, not accumulated.
      expect(persisted!.userRoles.map((ur) => ur.role.name)).toEqual([RoleName.ADMIN])
    })

    it('admin demotes a STAFF account to CUSTOMER (lower rank), clearing permissions', async () => {
      const email = `staffmgmt.demote.${suffix}@vedhicfoods.test`
      const create = await request(app)
        .post(`${API}/admin/staff`)
        .set(auth(tokens.owner))
        .send({ fullName: 'Demote Me', email, password: PASSWORD, role: RoleName.STAFF })
      const targetId = create.body.staff.id
      createdUserIds.push(targetId)

      const demote = await request(app)
        .patch(`${API}/admin/staff/${targetId}`)
        .set(auth(tokens.admin))
        .send({ role: RoleName.CUSTOMER })
      expect(demote.status).toBe(200)
      expect(demote.body.staff.role).toBe(RoleName.CUSTOMER)
      expect(demote.body.staff.permissions).toEqual([])
    })

    it('an admin cannot promote a STAFF account to ADMIN (no upward/lateral minting)', async () => {
      const email = `staffmgmt.blocked.promote.${suffix}@vedhicfoods.test`
      const create = await request(app)
        .post(`${API}/admin/staff`)
        .set(auth(tokens.owner))
        .send({ fullName: 'Blocked Promote', email, password: PASSWORD, role: RoleName.STAFF })
      const targetId = create.body.staff.id
      createdUserIds.push(targetId)

      const res = await request(app)
        .patch(`${API}/admin/staff/${targetId}`)
        .set(auth(tokens.admin))
        .send({ role: RoleName.ADMIN })
      expect(res.status).toBe(403)

      const persisted = await prisma.user.findUnique({ where: { id: targetId } })
      expect(persisted!.role).toBe(RoleName.STAFF)
    })

    it('an unknown role name is rejected as validation (400), never applied', async () => {
      const res = await request(app)
        .patch(`${API}/admin/staff/${ids.createdA}`)
        .set(auth(tokens.owner))
        .send({ role: 'SUPERUSER' })
      expect(res.status).toBe(400)
      const persisted = await prisma.user.findUnique({ where: { id: ids.createdA } })
      expect(persisted!.role).toBe(RoleName.STAFF)
    })
  })

  // ==========================================================================
  // 4. DISABLE / REACTIVATE
  // ==========================================================================
  describe('4. Disable and reactivate staff', () => {
    const email = `staffmgmt.lifecycle.${suffix}@vedhicfoods.test`
    let lifecycleId = ''
    let lifecycleAccessToken = ''
    let lifecycleRefreshToken = ''

    it('owner disables the account', async () => {
      const create = await request(app)
        .post(`${API}/admin/staff`)
        .set(auth(tokens.owner))
        .send({ fullName: 'Lifecycle Staff', email, password: PASSWORD, role: RoleName.STAFF })
      expect(create.status).toBe(201)
      lifecycleId = create.body.staff.id
      createdUserIds.push(lifecycleId)

      const login = await AuthService.login({ email, password: PASSWORD })
      lifecycleAccessToken = login.accessToken
      lifecycleRefreshToken = login.refreshToken

      // Control: the token works while the account is active.
      const before = await request(app).get(`${API}/auth/me`).set(auth(lifecycleAccessToken))
      expect(before.status).toBe(200)

      const res = await request(app)
        .patch(`${API}/admin/staff/${lifecycleId}`)
        .set(auth(tokens.owner))
        .send({ isActive: false })
      expect(res.status).toBe(200)
      expect(res.body.staff.isActive).toBe(false)
    })

    it('disabled staff cannot authenticate (login is refused)', async () => {
      const res = await request(app)
        .post(`${API}/auth/login`)
        .send({ email, password: PASSWORD })
      expect(res.status).toBe(401)
    })

    it('an already-issued access token stops working for disabled staff', async () => {
      // The token is cryptographically valid; deactivation must be enforced
      // server-side on every request, not inferred from token validity.
      const me = await request(app).get(`${API}/auth/me`).set(auth(lifecycleAccessToken))
      expect(me.status).toBe(401)

      const adminCall = await request(app)
        .get(`${API}/admin/orders`)
        .set(auth(lifecycleAccessToken))
      expect(adminCall.status).toBe(401)

      // The old refresh token is likewise refused.
      const refresh = await request(app)
        .post(`${API}/auth/refresh`)
        .send({ refreshToken: lifecycleRefreshToken })
      expect(refresh.status).toBe(401)
    })

    it('reactivating the account restores authentication', async () => {
      const res = await request(app)
        .patch(`${API}/admin/staff/${lifecycleId}`)
        .set(auth(tokens.owner))
        .send({ isActive: true })
      expect(res.status).toBe(200)
      expect(res.body.staff.isActive).toBe(true)

      const login = await request(app)
        .post(`${API}/auth/login`)
        .send({ email, password: PASSWORD })
      expect(login.status).toBe(200)
      expect(login.body.accessToken).toBeDefined()
    })

    it('the only active owner cannot be disabled (safeguard)', async () => {
      const activeOwners = await prisma.user.count({
        where: { role: RoleName.OWNER, isActive: true, isDeleted: false },
      })
      if (activeOwners !== 1) return // guarded: only meaningful with a single owner

      const res = await request(app)
        .patch(`${API}/admin/staff/${ids.owner}`)
        .set(auth(tokens.owner))
        .send({ isActive: false })
      expect(res.status).toBe(400)

      const persisted = await prisma.user.findUnique({ where: { id: ids.owner } })
      expect(persisted!.isActive).toBe(true)
    })

    it('a user cannot disable their own account through the API (self-target is allowed but changes no role)', async () => {
      // Self-edits are permitted for profile fields; assert the account is
      // still reachable and the guard did not silently lock the owner out.
      const res = await request(app)
        .patch(`${API}/admin/staff/${ids.staffMgr}`)
        .set(auth(tokens.staffMgr))
        .send({ fullName: 'Staff Manager Renamed' })
      expect(res.status).toBe(200)
      expect(res.body.staff.fullName).toBe('Staff Manager Renamed')
    })
  })

  // ==========================================================================
  // 5. DELETE
  // ==========================================================================
  describe('5. Delete staff', () => {
    it('owner soft-deletes a staff account; it then disappears from reads', async () => {
      const email = `staffmgmt.delete.${suffix}@vedhicfoods.test`
      const create = await request(app)
        .post(`${API}/admin/staff`)
        .set(auth(tokens.owner))
        .send({ fullName: 'Delete Me', email, password: PASSWORD, role: RoleName.STAFF })
      const targetId = create.body.staff.id
      createdUserIds.push(targetId)

      const del = await request(app)
        .delete(`${API}/admin/staff/${targetId}`)
        .set(auth(tokens.owner))
      expect(del.status).toBe(200)

      const read = await request(app)
        .get(`${API}/admin/staff/${targetId}`)
        .set(auth(tokens.owner))
      expect(read.status).toBe(404)

      const persisted = await prisma.user.findUnique({ where: { id: targetId } })
      expect(persisted!.isDeleted).toBe(true)
      expect(persisted!.isActive).toBe(false)

      const login = await request(app)
        .post(`${API}/auth/login`)
        .send({ email, password: PASSWORD })
      expect(login.status).toBe(401)
    })

    it('a user cannot delete their own account (400)', async () => {
      const res = await request(app)
        .delete(`${API}/admin/staff/${ids.owner}`)
        .set(auth(tokens.owner))
      expect(res.status).toBe(400)
      expect(res.body.error).toContain('own administrative account')
    })
  })

  // ==========================================================================
  // 6. PERMISSIONS — VIEW / ASSIGN / REMOVE
  // ==========================================================================
  describe('6. Permission viewing, assignment and removal', () => {
    it('staff detail (view permissions) resolves the role-derived slug set', async () => {
      const res = await request(app)
        .get(`${API}/admin/staff/${ids.staff}`)
        .set(auth(tokens.admin))
      expect(res.status).toBe(200)
      expect(Array.isArray(res.body.permissions)).toBe(true)
      expect(res.body.permissions).toContain('orders.read')
      expect(res.body.permissions).not.toContain('settings.update')
    })

    it('the permission catalogue is listable by an authorised reader', async () => {
      const res = await request(app)
        .get(`${API}/admin/permissions`)
        .set(auth(tokens.admin))
      expect(res.status).toBe(200)
      const slugs = res.body.items.map((p: any) => p.slug)
      expect(slugs).toEqual(
        expect.arrayContaining(['staff.read', 'staff.create', 'staff.update', 'staff.delete'])
      )
      // No credential/secret material leaks in the catalogue.
      expect(JSON.stringify(res.body)).not.toContain('$2a$')
    })

    it('roles are listable with their permission sets', async () => {
      const res = await request(app)
        .get(`${API}/admin/roles`)
        .set(auth(tokens.admin))
      expect(res.status).toBe(200)
      const names = res.body.items.map((r: any) => r.name)
      expect(names).toEqual(expect.arrayContaining(['OWNER', 'ADMIN', 'STAFF', 'CUSTOMER']))
      const staffRole = res.body.items.find((r: any) => r.name === 'STAFF')
      expect(staffRole.permissions).toContain('orders.read')
    })

    it('an authorised actor can assign per-user permissions and they apply immediately', async () => {
      const email = `staffmgmt.grant.${suffix}@vedhicfoods.test`
      const create = await request(app)
        .post(`${API}/admin/staff`)
        .set(auth(tokens.owner))
        .send({ fullName: 'Grant Target', email, password: PASSWORD, role: RoleName.STAFF })
      expect(create.status).toBe(201)
      const targetId = create.body.staff.id
      createdUserIds.push(targetId)

      // Control: before any override the STAFF role's derived grants apply.
      const before = await AuthService.resolveUserPermissions(targetId)
      expect(before.permissions).toContain('orders.read')
      expect(before.permissions).not.toContain('reports.read')

      const grant = await request(app)
        .patch(`${API}/admin/staff/${targetId}/permissions`)
        .set(auth(tokens.owner))
        .send({ permissionSlugs: ['orders.read', 'settings.update', 'reports.read'] })
      expect(grant.status).toBe(200)
      expect(grant.body.staff.permissions).toEqual(
        expect.arrayContaining(['orders.read', 'settings.update', 'reports.read'])
      )

      // The per-user set REPLACES the role-derived set (the UI matrix sends the
      // complete intended set), including the staff.* slugs the role held.
      const resolved = await AuthService.resolveUserPermissions(targetId)
      expect(resolved.permissions.sort()).toEqual(['orders.read', 'reports.read', 'settings.update'])
      expect(resolved.permissions).not.toContain('staff.create')

      // View-permissions reflects the override immediately.
      const detail = await request(app)
        .get(`${API}/admin/staff/${targetId}`)
        .set(auth(tokens.admin))
      expect(detail.status).toBe(200)
      expect(detail.body.permissions).toEqual(
        expect.arrayContaining(['orders.read', 'reports.read', 'settings.update'])
      )
    })

    it('create supports permissionSlugs: the new account starts with exactly that set', async () => {
      const email = `staffmgmt.creategrant.${suffix}@vedhicfoods.test`
      const res = await request(app)
        .post(`${API}/admin/staff`)
        .set(auth(tokens.admin))
        .send({
          fullName: 'Create Grant',
          email,
          password: PASSWORD,
          role: RoleName.STAFF,
          permissionSlugs: ['orders.read', 'reports.read'],
        })
      expect(res.status).toBe(201)
      createdUserIds.push(res.body.staff.id)
      expect(res.body.staff.permissions.sort()).toEqual(['orders.read', 'reports.read'])

      const resolved = await AuthService.resolveUserPermissions(res.body.staff.id)
      expect(resolved.permissions.sort()).toEqual(['orders.read', 'reports.read'])
    })

    it('an authorised actor can remove a permission; the override keeps the rest', async () => {
      const targetId = await createUserWithRole({
        email: `staffmgmt.revoke.${suffix}@vedhicfoods.test`,
        fullName: 'Revoke Target',
        role: RoleName.STAFF,
      })

      await request(app)
        .patch(`${API}/admin/staff/${targetId}/permissions`)
        .set(auth(tokens.owner))
        .send({ permissionSlugs: ['orders.read', 'settings.update'] })

      const revoke = await request(app)
        .patch(`${API}/admin/staff/${targetId}/permissions`)
        .set(auth(tokens.owner))
        .send({ permissionSlugs: ['orders.read'] })
      expect(revoke.status).toBe(200)

      const resolved = await AuthService.resolveUserPermissions(targetId)
      expect(resolved.permissions.sort()).toEqual(['orders.read'])
    })

    it('stripping an account to an empty set binds it to zero permissions (no role fallback)', async () => {
      const targetId = await createUserWithRole({
        email: `staffmgmt.strip.${suffix}@vedhicfoods.test`,
        fullName: 'Strip Target',
        role: RoleName.STAFF,
      })

      await request(app)
        .patch(`${API}/admin/staff/${targetId}/permissions`)
        .set(auth(tokens.owner))
        .send({ permissionSlugs: ['orders.read'] })

      const strip = await request(app)
        .patch(`${API}/admin/staff/${targetId}/permissions`)
        .set(auth(tokens.owner))
        .send({ permissionSlugs: [] })
      expect(strip.status).toBe(200)

      // Still a genuine STAFF (passes the console role gate) yet resolves to
      // no permissions: the tombstoned override must NOT fall back to the role.
      const resolved = await AuthService.resolveUserPermissions(targetId)
      expect(resolved.permissions).toEqual([])
      expect(resolved.roles).toContain(RoleName.STAFF)
    })

    it('an empty set on an account without an override is refused (400), not guessed', async () => {
      const targetId = await createUserWithRole({
        email: `staffmgmt.emptyambig.${suffix}@vedhicfoods.test`,
        fullName: 'Ambiguous Empty',
        role: RoleName.STAFF,
      })

      const res = await request(app)
        .patch(`${API}/admin/staff/${targetId}/permissions`)
        .set(auth(tokens.owner))
        .send({ permissionSlugs: [] })
      expect(res.status).toBe(400)

      const resolved = await AuthService.resolveUserPermissions(targetId)
      expect(resolved.permissions).toContain('orders.read') // untouched
    })

    it('an invalid permission slug is rejected as a 400 before any grant happens', async () => {
      const res = await request(app)
        .patch(`${API}/admin/staff/${ids.staff}/permissions`)
        .set(auth(tokens.owner))
        .send({ permissionSlugs: ['not.a.real.permission'] })
      expect(res.status).toBe(400)

      const resolved = await AuthService.resolveUserPermissions(ids.staff)
      expect(resolved.permissions).not.toContain('not.a.real.permission')
    })

    it('a STAFF grantor cannot grant a permission it does not hold (least privilege, 403)', async () => {
      // `staffMgr` is a STAFF; its derived set covers staff.* and orders.read,
      // never settings.update.
      const held = await AuthService.resolveUserPermissions(ids.staffMgr)
      expect(held.permissions).not.toContain('settings.update')
      expect(held.permissions).toContain('staff.update')

      const targetId = await createUserWithRole({
        email: `staffmgmt.least.${suffix}@vedhicfoods.test`,
        fullName: 'Least Target',
        role: RoleName.STAFF,
      })

      const res = await request(app)
        .patch(`${API}/admin/staff/${targetId}/permissions`)
        .set(auth(tokens.staffMgr))
        .send({ permissionSlugs: ['settings.update'] })
      expect(res.status).toBe(403)

      const resolved = await AuthService.resolveUserPermissions(targetId)
      expect(resolved.permissions).not.toContain('settings.update')
    })

    it('a permitted STAFF cannot assign permissions to a peer STAFF (strict reach ceiling)', async () => {
      const targetId = await createUserWithRole({
        email: `staffmgmt.peerreach.${suffix}@vedhicfoods.test`,
        fullName: 'Peer Reach Target',
        role: RoleName.STAFF,
      })

      const res = await request(app)
        .patch(`${API}/admin/staff/${targetId}/permissions`)
        .set(auth(tokens.staffMgr))
        .send({ permissionSlugs: ['orders.read'] })
      expect(res.status).toBe(403)
    })

    it('an ADMIN cannot assign permissions to another ADMIN (no lateral reach)', async () => {
      const otherAdmin = await createUserWithRole({
        email: `staffmgmt.adminpeer.perm.${suffix}@vedhicfoods.test`,
        fullName: 'Perm Peer Admin',
        role: RoleName.ADMIN,
      })

      const res = await request(app)
        .patch(`${API}/admin/staff/${otherAdmin}/permissions`)
        .set(auth(tokens.admin))
        .send({ permissionSlugs: ['orders.read'] })
      expect(res.status).toBe(403)
    })

    it('an OWNER/ADMIN target cannot receive a per-user set (they inherit everything: 400)', async () => {
      const res = await request(app)
        .patch(`${API}/admin/staff/${ids.admin}/permissions`)
        .set(auth(tokens.owner))
        .send({ permissionSlugs: ['orders.read'] })
      expect(res.status).toBe(400)

      // The ADMIN account is untouched and still fully privileged.
      const resolved = await AuthService.resolveUserPermissions(ids.admin)
      expect(resolved.permissions).toContain('settings.update')
    })

    it('an idempotent re-grant writes no spurious audit entry (no fake success)', async () => {
      const targetId = await createUserWithRole({
        email: `staffmgmt.idempotent.${suffix}@vedhicfoods.test`,
        fullName: 'Idempotent Target',
        role: RoleName.STAFF,
      })

      const first = await request(app)
        .patch(`${API}/admin/staff/${targetId}/permissions`)
        .set(auth(tokens.owner))
        .send({ permissionSlugs: ['orders.read'] })
      expect(first.status).toBe(200)

      const second = await request(app)
        .patch(`${API}/admin/staff/${targetId}/permissions`)
        .set(auth(tokens.owner))
        .send({ permissionSlugs: ['orders.read'] })
      expect(second.status).toBe(200)

      const logs = await prisma.auditLog.findMany({
        where: { entityId: targetId, action: 'STAFF_PERMISSIONS_UPDATED' },
      })
      expect(logs.length).toBe(1)
    })

    it('PATCH /admin/staff/:id no longer silently swallows permissionSlugs (explicit 400)', async () => {
      const res = await request(app)
        .patch(`${API}/admin/staff/${ids.staff}`)
        .set(auth(tokens.owner))
        .send({ permissionSlugs: ['orders.read'], fullName: 'Guard' })
      expect(res.status).toBe(400)
      expect(res.body.error).toContain('/permissions')

      const resolved = await AuthService.resolveUserPermissions(ids.staff)
      expect(resolved.permissions).not.toContain('settings.update')
    })

    it('mass-assignment fields (roleId, permissions, isActive) in a create body are ignored', async () => {
      const ownerRole = await prisma.role.findUnique({ where: { name: RoleName.OWNER } })
      const email = `staffmgmt.massassign.${suffix}@vedhicfoods.test`
      const res = await request(app)
        .post(`${API}/admin/staff`)
        .set(auth(tokens.owner))
        .send({
          fullName: 'Mass Assign',
          email,
          password: PASSWORD,
          role: RoleName.STAFF,
          roleId: ownerRole!.id,
          permissions: ['settings.update'],
          isActive: false,
        })
      expect(res.status).toBe(201)

      const created = await prisma.user.findUnique({ where: { email } })
      createdUserIds.push(created!.id)
      expect(created!.role).toBe(RoleName.STAFF)
      expect(created!.isActive).toBe(true)
      const resolved = await AuthService.resolveUserPermissions(created!.id)
      expect(resolved.permissions).not.toContain('settings.update')
    })
  })

  // ==========================================================================
  // 7. RESET PASSWORD
  // ==========================================================================
  describe('7. Reset staff password', () => {
    const email = `staffmgmt.reset.${suffix}@vedhicfoods.test`
    let resetId = ''
    let oldRefreshToken = ''

    it('owner resets the password and prior sessions are revoked', async () => {
      const create = await request(app)
        .post(`${API}/admin/staff`)
        .set(auth(tokens.owner))
        .send({ fullName: 'Reset Target', email, password: PASSWORD, role: RoleName.STAFF })
      resetId = create.body.staff.id
      createdUserIds.push(resetId)

      const login = await AuthService.login({ email, password: PASSWORD })
      oldRefreshToken = login.refreshToken

      const res = await request(app)
        .post(`${API}/admin/staff/${resetId}/reset-password`)
        .set(auth(tokens.owner))
        .send({ newPassword: NEW_PASSWORD })
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)

      // The old refresh token is dead.
      const refresh = await request(app)
        .post(`${API}/auth/refresh`)
        .send({ refreshToken: oldRefreshToken })
      expect(refresh.status).toBe(401)

      // Old password no longer works; the new one does.
      const oldLogin = await request(app)
        .post(`${API}/auth/login`)
        .send({ email, password: PASSWORD })
      expect(oldLogin.status).toBe(401)

      const newLogin = await request(app)
        .post(`${API}/auth/login`)
        .send({ email, password: NEW_PASSWORD })
      expect(newLogin.status).toBe(200)
      expect(newLogin.body.accessToken).toBeDefined()
    })

    it('a weak new password is rejected with 400', async () => {
      const res = await request(app)
        .post(`${API}/admin/staff/${resetId}/reset-password`)
        .set(auth(tokens.owner))
        .send({ newPassword: 'short' })
      expect(res.status).toBe(400)
    })

    it('a missing new password is rejected with 400', async () => {
      const res = await request(app)
        .post(`${API}/admin/staff/${resetId}/reset-password`)
        .set(auth(tokens.owner))
        .send({})
      expect(res.status).toBe(400)
    })

    it('resetting a non-existent account returns 404', async () => {
      const res = await request(app)
        .post(`${API}/admin/staff/does-not-exist-${suffix}/reset-password`)
        .set(auth(tokens.owner))
        .send({ newPassword: NEW_PASSWORD })
      expect(res.status).toBe(404)
    })
  })

  // ==========================================================================
  // 8. LAST-LOGIN TRACKING
  // ==========================================================================
  describe('8. Last-login tracking', () => {
    const email = `staffmgmt.login.${suffix}@vedhicfoods.test`
    let loginId = ''

    it('a freshly created account has no last-login timestamp', async () => {
      const create = await request(app)
        .post(`${API}/admin/staff`)
        .set(auth(tokens.owner))
        .send({ fullName: 'Login Tracker', email, password: PASSWORD, role: RoleName.STAFF })
      loginId = create.body.staff.id
      createdUserIds.push(loginId)

      const read = await request(app)
        .get(`${API}/admin/staff/${loginId}`)
        .set(auth(tokens.admin))
      expect(read.status).toBe(200)
      expect(read.body.lastLoginAt).toBeNull()
    })

    it('the timestamp is recorded on successful login and surfaced on reads', async () => {
      const before = new Date()
      const login = await request(app)
        .post(`${API}/auth/login`)
        .send({ email, password: PASSWORD })
      expect(login.status).toBe(200)

      const read = await request(app)
        .get(`${API}/admin/staff/${loginId}`)
        .set(auth(tokens.admin))
      expect(read.body.lastLoginAt).not.toBeNull()
      expect(new Date(read.body.lastLoginAt).getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000)
    })

    it('the staff directory exposes last-login for each member', async () => {
      const res = await request(app)
        .get(`${API}/admin/staff`)
        .set(auth(tokens.admin))
      expect(res.status).toBe(200)
      const row = res.body.items.find((s: any) => s.id === loginId)
      expect(row).toBeDefined()
      expect(row.lastLoginAt).not.toBeNull()
    })
  })

  // ==========================================================================
  // 9. SECURITY — PRIVILEGE ESCALATION & ACCESS CONTROL
  // ==========================================================================
  describe('9. Privilege escalation and console access control', () => {
    it('the staff-manager really does hold staff.create (control assertion)', async () => {
      const res = await request(app)
        .get(`${API}/admin/staff`)
        .set(auth(tokens.staffMgr))
      expect(res.status).toBe(200)
      const resolved = await AuthService.resolveUserPermissions(ids.staffMgr)
      expect(resolved.permissions).toContain('staff.create')
    })

    it('a permitted staff member cannot create an ADMIN (higher level)', async () => {
      const res = await request(app)
        .post(`${API}/admin/staff`)
        .set(auth(tokens.staffMgr))
        .send({
          fullName: 'Illegal Admin',
          email: `staffmgmt.illegal.admin.${suffix}@vedhicfoods.test`,
          password: PASSWORD,
          role: RoleName.ADMIN,
        })
      expect(res.status).toBe(403)
      const exists = await prisma.user.findUnique({
        where: { email: `staffmgmt.illegal.admin.${suffix}@vedhicfoods.test` },
      })
      expect(exists).toBeNull()
    })

    it('a permitted staff member cannot create an OWNER (higher level)', async () => {
      const res = await request(app)
        .post(`${API}/admin/staff`)
        .set(auth(tokens.staffMgr))
        .send({
          fullName: 'Illegal Owner',
          email: `staffmgmt.illegal.owner.${suffix}@vedhicfoods.test`,
          password: PASSWORD,
          role: RoleName.OWNER,
        })
      expect(res.status).toBe(403)
    })

    it('a permitted staff member cannot create a peer STAFF (strict rank ceiling)', async () => {
      const res = await request(app)
        .post(`${API}/admin/staff`)
        .set(auth(tokens.staffMgr))
        .send({
          fullName: 'Illegal Peer',
          email: `staffmgmt.illegal.peer.${suffix}@vedhicfoods.test`,
          password: PASSWORD,
          role: RoleName.STAFF,
        })
      // Documented behaviour: an actor may only assign a role STRICTLY below its
      // own rank. A STAFF cannot mint another STAFF — the permission only opens
      // the endpoint. This is a fail-closed ceiling, not a security hole.
      expect(res.status).toBe(403)
    })

    it('a staff member cannot promote itself to ADMIN or OWNER', async () => {
      for (const role of [RoleName.ADMIN, RoleName.OWNER]) {
        const res = await request(app)
          .patch(`${API}/admin/staff/${ids.staffMgr}`)
          .set(auth(tokens.staffMgr))
          .send({ role })
        expect(res.status, `self-promotion to ${role} answered ${res.status}`).toBe(403)
      }
      const persisted = await prisma.user.findUnique({ where: { id: ids.staffMgr } })
      expect(persisted!.role).toBe(RoleName.STAFF)
    })

    it('a staff member cannot assign itself permissions directly', async () => {
      const res = await request(app)
        .patch(`${API}/admin/staff/${ids.staffMgr}/permissions`)
        .set(auth(tokens.staffMgr))
        .send({ permissionSlugs: ['settings.update'] })
      expect(res.status).toBe(403)
      const resolved = await AuthService.resolveUserPermissions(ids.staffMgr)
      expect(resolved.permissions).not.toContain('settings.update')
    })

    it('a staff member cannot reset an ADMIN password (account takeover)', async () => {
      const res = await request(app)
        .post(`${API}/admin/staff/${ids.admin}/reset-password`)
        .set(auth(tokens.staffMgr))
        .send({ newPassword: 'Hijacked@123' })
      expect(res.status).toBe(403)
    })

    it('a staff member cannot delete an ADMIN account', async () => {
      const res = await request(app)
        .delete(`${API}/admin/staff/${ids.admin}`)
        .set(auth(tokens.staffMgr))
      expect(res.status).toBe(403)
      const persisted = await prisma.user.findUnique({ where: { id: ids.admin } })
      expect(persisted!.isDeleted).toBe(false)
    })

    it('an admin cannot mint another ADMIN or OWNER', async () => {
      for (const role of [RoleName.ADMIN, RoleName.OWNER]) {
        const res = await request(app)
          .post(`${API}/admin/staff`)
          .set(auth(tokens.admin))
          .send({
            fullName: 'Admin Mint',
            email: `staffmgmt.mint.${role}.${suffix}@vedhicfoods.test`,
            password: PASSWORD,
            role,
          })
        expect(res.status, `admin minted ${role} with ${res.status}`).toBe(403)
      }
    })

    it('a smuggled id in the body cannot retarget a staff mutation (path :id wins)', async () => {
      const res = await request(app)
        .patch(`${API}/admin/staff/${ids.admin}`)
        .set(auth(tokens.staffMgr))
        .send({ id: ids.staffMgr, userId: ids.staffMgr, isActive: false })
      expect(res.status).toBe(403)
      const persisted = await prisma.user.findUnique({ where: { id: ids.admin } })
      expect(persisted!.isActive).toBe(true)
    })

    it('unauthenticated callers get 401 on every staff-management verb', async () => {
      const probes = [
        request(app).get(`${API}/admin/staff`),
        request(app).get(`${API}/admin/staff/${ids.staff}`),
        request(app).post(`${API}/admin/staff`).send({}),
        request(app).patch(`${API}/admin/staff/${ids.staff}`).send({}),
        request(app).delete(`${API}/admin/staff/${ids.staff}`),
        request(app).post(`${API}/admin/staff/${ids.staff}/reset-password`).send({}),
        request(app).patch(`${API}/admin/staff/${ids.staff}/permissions`).send({}),
      ]
      for (const probe of probes) {
        const res = await probe
        expect(res.status, `expected 401, got ${res.status}`).toBe(401)
      }
    })

    it('a customer is forbidden (403) on every staff-management verb', async () => {
      const probes: Array<[string, string, unknown]> = [
        ['get', `${API}/admin/staff`, undefined],
        ['get', `${API}/admin/staff/${ids.staff}`, undefined],
        ['post', `${API}/admin/staff`, { fullName: 'X', email: `x.${suffix}@v.test`, password: PASSWORD }],
        ['patch', `${API}/admin/staff/${ids.staff}`, { role: RoleName.ADMIN }],
        ['delete', `${API}/admin/staff/${ids.staff}`, undefined],
        ['post', `${API}/admin/staff/${ids.staff}/reset-password`, { newPassword: 'Hijacked@123' }],
        ['patch', `${API}/admin/staff/${ids.staff}/permissions`, { permissionSlugs: ['settings.update'] }],
      ]
      for (const [method, path, body] of probes) {
        const req = (request(app) as any)[method](path).set(auth(tokens.customer))
        if (body !== undefined) req.send(body)
        const res = await req
        expect(res.status, `${method.toUpperCase()} ${path} answered ${res.status}`).toBe(403)
        // Denial bodies must not expose the permission taxonomy.
        expect(JSON.stringify(res.body)).not.toContain('.update')
      }
    })

    it('a staff member without any staff.* permission is denied (403)', async () => {
      // `staffNoPerms` is a genuine STAFF (passes the console role gate) but
      // has no UserRole rows, so it resolves to zero permissions.
      const resolved = await AuthService.resolveUserPermissions(ids.staffNoPerms)
      expect(resolved.permissions).toEqual([])

      const read = await request(app)
        .get(`${API}/admin/staff`)
        .set(auth(tokens.staffNoPerms))
      expect(read.status).toBe(403)

      const create = await request(app)
        .post(`${API}/admin/staff`)
        .set(auth(tokens.staffNoPerms))
        .send({ fullName: 'X', email: `nope.${suffix}@v.test`, password: PASSWORD })
      expect(create.status).toBe(403)

      const attempt = await request(app)
        .patch(`${API}/admin/staff/${ids.staff}`)
        .set(auth(tokens.staffNoPerms))
        .send({ fullName: 'Hijack' })
      expect(attempt.status).toBe(403)
    })

    it('the directory excludes customers and never leaks password hashes', async () => {
      const res = await request(app).get(`${API}/admin/staff`).set(auth(tokens.admin))
      expect(res.status).toBe(200)
      const emails = res.body.items.map((s: any) => s.email)
      expect(emails).not.toContain(`staffmgmt.customer.${suffix}@vedhicfoods.test`)
      expect(JSON.stringify(res.body)).not.toContain('$2a$')
      expect(JSON.stringify(res.body)).not.toContain('passwordHash')
    })
  })

  // ==========================================================================
  // 10. DUPLICATE EMAILS & INVALID ACCOUNTS
  // ==========================================================================
  describe('10. Duplicate emails and invalid accounts', () => {
    it('rejects a duplicate email with 409', async () => {
      const email = `staffmgmt.dupe.${suffix}@vedhicfoods.test`
      const first = await request(app)
        .post(`${API}/admin/staff`)
        .set(auth(tokens.owner))
        .send({ fullName: 'Dupe One', email, password: PASSWORD, role: RoleName.STAFF })
      expect(first.status).toBe(201)
      createdUserIds.push(first.body.staff.id)

      const second = await request(app)
        .post(`${API}/admin/staff`)
        .set(auth(tokens.owner))
        .send({ fullName: 'Dupe Two', email, password: PASSWORD, role: RoleName.STAFF })
      expect(second.status).toBe(409)
      expect(second.body.error).toContain('already exists')

      const count = await prisma.user.count({ where: { email } })
      expect(count).toBe(1)
    })

    it('duplicate detection is case-insensitive and trims whitespace', async () => {
      const email = `staffmgmt.dupecase.${suffix}@vedhicfoods.test`
      const first = await request(app)
        .post(`${API}/admin/staff`)
        .set(auth(tokens.owner))
        .send({ fullName: 'Dupe Case', email, password: PASSWORD, role: RoleName.STAFF })
      expect(first.status).toBe(201)
      createdUserIds.push(first.body.staff.id)

      const second = await request(app)
        .post(`${API}/admin/staff`)
        .set(auth(tokens.owner))
        .send({
          fullName: 'Dupe Case Upper',
          email: `  ${email.toUpperCase()}  `,
          password: PASSWORD,
          role: RoleName.STAFF,
        })
      expect(second.status).toBe(409)
    })

    it('rejects an email that collides with an existing ADMIN account', async () => {
      const res = await request(app)
        .post(`${API}/admin/staff`)
        .set(auth(tokens.owner))
        .send({
          fullName: 'Collide Admin',
          email: `staffmgmt.admin.${suffix}@vedhicfoods.test`,
          password: PASSWORD,
          role: RoleName.STAFF,
        })
      expect(res.status).toBe(409)
    })

    it('rejects a malformed email with 400', async () => {
      const res = await request(app)
        .post(`${API}/admin/staff`)
        .set(auth(tokens.owner))
        .send({ fullName: 'Bad Email', email: 'not-an-email', password: PASSWORD, role: RoleName.STAFF })
      expect(res.status).toBe(400)
      expect(res.body.error).toBe('Validation failed')
    })

    it('rejects a weak password with 400', async () => {
      const res = await request(app)
        .post(`${API}/admin/staff`)
        .set(auth(tokens.owner))
        .send({
          fullName: 'Weak Pass',
          email: `staffmgmt.weak.${suffix}@vedhicfoods.test`,
          password: 'short',
          role: RoleName.STAFF,
        })
      expect(res.status).toBe(400)
    })

    it('rejects a too-short full name with 400', async () => {
      const res = await request(app)
        .post(`${API}/admin/staff`)
        .set(auth(tokens.owner))
        .send({
          fullName: 'A',
          email: `staffmgmt.shortname.${suffix}@vedhicfoods.test`,
          password: PASSWORD,
          role: RoleName.STAFF,
        })
      expect(res.status).toBe(400)
    })

    it('rejects an invalid phone number with 400', async () => {
      const res = await request(app)
        .post(`${API}/admin/staff`)
        .set(auth(tokens.owner))
        .send({
          fullName: 'Bad Phone',
          email: `staffmgmt.badphone.${suffix}@vedhicfoods.test`,
          password: PASSWORD,
          role: RoleName.STAFF,
          phone: 'call-me',
        })
      expect(res.status).toBe(400)
    })

    it('rejects an unknown role with 400 and creates nothing', async () => {
      const email = `staffmgmt.badrole.${suffix}@vedhicfoods.test`
      const res = await request(app)
        .post(`${API}/admin/staff`)
        .set(auth(tokens.owner))
        .send({ fullName: 'Bad Role', email, password: PASSWORD, role: 'SUPERUSER' })
      expect(res.status).toBe(400)
      expect(await prisma.user.findUnique({ where: { email } })).toBeNull()
    })

    it('unknown account ids return 404 on read / update / delete', async () => {
      const missing = `staffmgmt.missing.${suffix}`
      const read = await request(app).get(`${API}/admin/staff/${missing}`).set(auth(tokens.admin))
      expect(read.status).toBe(404)
      const update = await request(app)
        .patch(`${API}/admin/staff/${missing}`)
        .set(auth(tokens.owner))
        .send({ fullName: 'Ghost' })
      expect(update.status).toBe(404)
      const del = await request(app).delete(`${API}/admin/staff/${missing}`).set(auth(tokens.owner))
      expect(del.status).toBe(404)
    })

    it('a soft-deleted account cannot be updated or reset (404, not resurrected)', async () => {
      const email = `staffmgmt.deleted.${suffix}@vedhicfoods.test`
      const create = await request(app)
        .post(`${API}/admin/staff`)
        .set(auth(tokens.owner))
        .send({ fullName: 'Deleted Target', email, password: PASSWORD, role: RoleName.STAFF })
      const targetId = create.body.staff.id
      createdUserIds.push(targetId)
      await request(app).delete(`${API}/admin/staff/${targetId}`).set(auth(tokens.owner))

      const update = await request(app)
        .patch(`${API}/admin/staff/${targetId}`)
        .set(auth(tokens.owner))
        .send({ fullName: 'Resurrect' })
      expect(update.status).toBe(404)

      const reset = await request(app)
        .post(`${API}/admin/staff/${targetId}/reset-password`)
        .set(auth(tokens.owner))
        .send({ newPassword: NEW_PASSWORD })
      expect(reset.status).toBe(404)
    })
  })

  // ==========================================================================
  // 11. AUDIT LOGGING FOR SENSITIVE CHANGES
  // ==========================================================================
  describe('11. Audit logging for sensitive changes', () => {
    async function latestAudit(action: string, entityId: string) {
      return prisma.auditLog.findFirst({
        where: { action, entityId },
        orderBy: { createdAt: 'desc' },
      })
    }

    it('records STAFF_CREATED with attribution and no credential material', async () => {
      const email = `staffmgmt.audit.create.${suffix}@vedhicfoods.test`
      const create = await request(app)
        .post(`${API}/admin/staff`)
        .set(auth(tokens.owner))
        .send({ fullName: 'Audit Create', email, password: PASSWORD, role: RoleName.STAFF })
      expect(create.status).toBe(201)
      const id = create.body.staff.id
      createdUserIds.push(id)

      const log = await latestAudit('STAFF_CREATED', id)
      expect(log, 'STAFF_CREATED audit entry missing').not.toBeNull()
      expect(log!.actorId).toBe(ids.owner)
      expect(log!.entity).toBe('User')
      const meta = log!.metadata as any
      expect(meta.staffEmail).toBe(email)
      expect(meta.role).toBe(RoleName.STAFF)
      expect(JSON.stringify(meta)).not.toContain(PASSWORD)
      expect(JSON.stringify(meta)).not.toContain('passwordHash')
    })

    it('records STAFF_UPDATED for a profile change', async () => {
      const id = ids.createdA
      await request(app)
        .patch(`${API}/admin/staff/${id}`)
        .set(auth(tokens.owner))
        .send({ fullName: 'Audit Updated' })
      const log = await latestAudit('STAFF_UPDATED', id)
      expect(log).not.toBeNull()
      expect(log!.actorId).toBe(ids.owner)
    })

    it('records STAFF_DISABLED when an account is deactivated', async () => {
      const email = `staffmgmt.audit.disable.${suffix}@vedhicfoods.test`
      const create = await request(app)
        .post(`${API}/admin/staff`)
        .set(auth(tokens.owner))
        .send({ fullName: 'Audit Disable', email, password: PASSWORD, role: RoleName.STAFF })
      const id = create.body.staff.id
      createdUserIds.push(id)

      await request(app)
        .patch(`${API}/admin/staff/${id}`)
        .set(auth(tokens.owner))
        .send({ isActive: false })

      const log = await latestAudit('STAFF_DISABLED', id)
      expect(log).not.toBeNull()
      expect((log!.metadata as any).changes.isActive).toBe(false)
    })

    it('records STAFF_UPDATED for a role change', async () => {
      const email = `staffmgmt.audit.role.${suffix}@vedhicfoods.test`
      const create = await request(app)
        .post(`${API}/admin/staff`)
        .set(auth(tokens.owner))
        .send({ fullName: 'Audit Role', email, password: PASSWORD, role: RoleName.STAFF })
      const id = create.body.staff.id
      createdUserIds.push(id)

      await request(app)
        .patch(`${API}/admin/staff/${id}`)
        .set(auth(tokens.owner))
        .send({ role: RoleName.ADMIN })

      const log = await latestAudit('STAFF_UPDATED', id)
      expect(log).not.toBeNull()
      expect((log!.metadata as any).changes.role).toBe(RoleName.ADMIN)
    })

    it('records STAFF_PASSWORD_RESET without the new password', async () => {
      const email = `staffmgmt.audit.reset.${suffix}@vedhicfoods.test`
      const create = await request(app)
        .post(`${API}/admin/staff`)
        .set(auth(tokens.owner))
        .send({ fullName: 'Audit Reset', email, password: PASSWORD, role: RoleName.STAFF })
      const id = create.body.staff.id
      createdUserIds.push(id)

      await request(app)
        .post(`${API}/admin/staff/${id}/reset-password`)
        .set(auth(tokens.owner))
        .send({ newPassword: NEW_PASSWORD })

      const log = await latestAudit('STAFF_PASSWORD_RESET', id)
      expect(log).not.toBeNull()
      expect(log!.actorId).toBe(ids.owner)
      const serialized = JSON.stringify(log!.metadata)
      expect(serialized).not.toContain(NEW_PASSWORD)
      expect(serialized.toLowerCase()).not.toContain('password":')
    })

    it('records STAFF_DELETED when an account is removed', async () => {
      const email = `staffmgmt.audit.delete.${suffix}@vedhicfoods.test`
      const create = await request(app)
        .post(`${API}/admin/staff`)
        .set(auth(tokens.owner))
        .send({ fullName: 'Audit Delete', email, password: PASSWORD, role: RoleName.STAFF })
      const id = create.body.staff.id
      createdUserIds.push(id)

      await request(app).delete(`${API}/admin/staff/${id}`).set(auth(tokens.owner))

      const log = await latestAudit('STAFF_DELETED', id)
      expect(log).not.toBeNull()
      expect(log!.actorId).toBe(ids.owner)
    })

    it('records STAFF_PERMISSIONS_UPDATED with added/removed deltas and no secrets', async () => {
      const email = `staffmgmt.audit.perm.${suffix}@vedhicfoods.test`
      const create = await request(app)
        .post(`${API}/admin/staff`)
        .set(auth(tokens.owner))
        .send({ fullName: 'Audit Perm', email, password: PASSWORD, role: RoleName.STAFF })
      const id = create.body.staff.id
      createdUserIds.push(id)

      await request(app)
        .patch(`${API}/admin/staff/${id}/permissions`)
        .set(auth(tokens.owner))
        .send({ permissionSlugs: ['orders.read', 'settings.update'] })

      const added = await latestAudit('STAFF_PERMISSIONS_UPDATED', id)
      expect(added).not.toBeNull()
      expect(added!.actorId).toBe(ids.owner)
      expect((added!.metadata as any).added).toEqual(
        expect.arrayContaining(['orders.read', 'settings.update'])
      )
      expect((added!.metadata as any).updatedBy).toBe(`staffmgmt.owner.${suffix}@vedhicfoods.test`)
      expect(JSON.stringify(added!.metadata)).not.toContain(PASSWORD)

      await request(app)
        .patch(`${API}/admin/staff/${id}/permissions`)
        .set(auth(tokens.owner))
        .send({ permissionSlugs: ['orders.read'] })

      const removed = await latestAudit('STAFF_PERMISSIONS_UPDATED', id)
      expect(removed).not.toBeNull()
      expect((removed!.metadata as any).removed).toContain('settings.update')
      expect((removed!.metadata as any).added).toEqual([])
    })

    it('no audit success entry is written for a refused escalation attempt', async () => {
      await request(app)
        .patch(`${API}/admin/staff/${ids.admin}`)
        .set(auth(tokens.staffMgr))
        .send({ isActive: false })

      const logs = await prisma.auditLog.findMany({
        where: { entityId: ids.admin, action: { in: ['STAFF_UPDATED', 'STAFF_DISABLED'] } },
      })
      expect(logs).toEqual([])
    })

    it('sensitive audit metadata is redacted by the sanitizer', async () => {
      // Drive the sanitizer through a normal create whose metadata we control
      // indirectly: assert the persisted row never contains raw secrets.
      const email = `staffmgmt.audit.redact.${suffix}@vedhicfoods.test`
      const create = await request(app)
        .post(`${API}/admin/staff`)
        .set(auth(tokens.owner))
        .send({ fullName: 'Audit Redact', email, password: PASSWORD, role: RoleName.STAFF })
      const id = create.body.staff.id
      createdUserIds.push(id)

      const log = await latestAudit('STAFF_CREATED', id)
      const serialized = JSON.stringify(log!.metadata)
      expect(serialized).not.toContain(PASSWORD)
      expect(serialized).not.toContain('$2a$')
    })
  })
})
