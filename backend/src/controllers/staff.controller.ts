import { Request, Response } from 'express'
import { RoleName, NotificationType } from '@prisma/client'
import { prisma } from '../config/database'
import { AuthService } from '../services/auth.service'
import { AuditService } from '../services/audit.service'
import { NotificationCenterService } from '../services/notification-center.service'
import { logger } from '../config/logger'
import {
  createStaffSchema,
  updateStaffSchema,
  updateStaffPermissionsSchema,
} from '../types/auth.types'
import {
  assertCanManageStaffAccount,
  assertCanAssignPermissions,
} from '../utils/privilege'
import { sendControllerError } from '../utils/api-response'
import { clampPageSize } from '../utils/pagination'

export class StaffController {
  /**
   * In-app SYSTEM_ALERT to every active ADMIN/OWNER about a staff change.
   * Best-effort by design: an inbox write failing must not fail the admin
   * action that triggered it.
   */
  private static async adminAlert(params: {
    eventKey: string
    action: string
    detail: string
  }): Promise<void> {
    try {
      await NotificationCenterService.broadcastToRoleActors({
        roles: [RoleName.ADMIN, RoleName.OWNER],
        type: NotificationType.SYSTEM_ALERT,
        title: params.action,
        message: params.detail,
        eventKey: params.eventKey,
      })
    } catch (error: any) {
      logger.error({ error: error?.message }, 'Staff admin alert failed (non-fatal)')
    }
  }

  /**
   * Allocates the next sequential `EMP-0001` style identifier.
   *
   * Custom identifiers are allowed, so this scans existing values instead of
   * ordering lexicographically. The unique column still arbitrates the rare
   * concurrent-create race.
   */
  private static async nextEmployeeId(): Promise<string> {
    const rows = await prisma.user.findMany({
      where: { employeeId: { not: null } },
      select: { employeeId: true },
    })
    let highest = 0
    for (const row of rows) {
      const match = /^EMP-(\d+)$/i.exec(row.employeeId ?? '')
      if (match) highest = Math.max(highest, Number(match[1]))
    }
    return `EMP-${String(highest + 1).padStart(4, '0')}`
  }

  /**
   * GET /api/v1/admin/staff
   * Lists all administrative and operational staff accounts.
   */
  public static async listStaff(req: Request, res: Response): Promise<void> {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1)
      // SECURITY: `per_page` was unbounded, so a single request could pull the
      // entire staff directory — including every name, email and phone number —
      // in one response. Clamp every list endpoint.
      const perPage = clampPageSize(req.query.per_page, 20, 100)
      const roleFilter = req.query.role as RoleName | undefined
      const search = (req.query.search as string)?.trim()?.slice(0, 120)

      if (roleFilter && !Object.values(RoleName).includes(roleFilter)) {
        res.status(400).json({ error: 'Invalid role filter.' })
        return
      }

      const where: any = {
        isDeleted: false,
        role: roleFilter ? roleFilter : { in: [RoleName.OWNER, RoleName.ADMIN, RoleName.STAFF] },
      }

      if (search) {
        where.OR = [
          { fullName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ]
      }

      const total = await prisma.user.count({ where })
      const staffMembers = await prisma.user.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        include: {
          userRoles: {
            include: {
              role: {
                include: {
                  rolePermissions: {
                    include: {
                      permission: true,
                    },
                  },
                },
              },
            },
          },
          userPermissions: {
            select: {
              revokedAt: true,
              permission: { select: { slug: true } },
            },
          },
        },
      })

      const items = staffMembers.map((u) => {
        const roleSet = new Set<RoleName>([u.role])
        const rolePermSet = new Set<string>()

        for (const ur of u.userRoles) {
          roleSet.add(ur.role.name)
          for (const rp of ur.role.rolePermissions) {
            if (rp.permission?.slug) rolePermSet.add(rp.permission.slug)
          }
        }

        // Mirror `resolveUserPermissions`: a per-user grant set (any row exists)
        // replaces the role-derived set — including an all-revoked empty set.
        const permSet = new Set<string>()
        if (u.userPermissions.length > 0) {
          for (const up of u.userPermissions) {
            if (!up.revokedAt && up.permission?.slug) permSet.add(up.permission.slug)
          }
        } else {
          for (const slug of rolePermSet) permSet.add(slug)
        }

        return {
          id: u.id,
          fullName: u.fullName,
          email: u.email,
          phone: u.phone,
          employeeId: u.employeeId,
          role: u.role,
          roles: Array.from(roleSet),
          permissions: Array.from(permSet),
          isActive: u.isActive,
          isVerified: u.isVerified,
          lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
          createdAt: u.createdAt.toISOString(),
        }
      })

      res.status(200).json({
        success: true,
        items,
        total,
        page,
        perPage,
        totalPages: Math.ceil(total / perPage),
      })
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to list staff members')
      res.status(500).json({ error: 'Failed to retrieve staff directory.' })
    }
  }

  /**
   * GET /api/v1/admin/staff/:id
   * Retrieves single staff member details with permissions.
   */
  public static async getStaffById(req: Request, res: Response): Promise<void> {
    try {
      const id = String(req.params.id)
      const user = await prisma.user.findFirst({
        where: { id, isDeleted: false },
        include: {
          userRoles: {
            include: {
              role: {
                include: {
                  rolePermissions: {
                    include: {
                      permission: true,
                    },
                  },
                },
              },
            },
          },
        },
      })

      if (!user) {
        res.status(404).json({ error: 'Staff member not found.' })
        return
      }

      const { roles, permissions, primaryRole } = await AuthService.resolveUserPermissions(user.id)

      res.status(200).json({
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        employeeId: user.employeeId,
        role: primaryRole,
        roles,
        permissions,
        isActive: user.isActive,
        isVerified: user.isVerified,
        lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
        createdAt: user.createdAt.toISOString(),
      })
    } catch {
      res.status(500).json({ error: 'Failed to retrieve staff details.' })
    }
  }

  /**
   * POST /api/v1/admin/staff
   * Creates a new staff or admin user.
   */
  public static async createStaff(req: Request, res: Response): Promise<void> {
    try {
      const parsed = createStaffSchema.safeParse(req.body)
      if (!parsed.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: parsed.error.errors.map(e => e.message),
        })
        return
      }

      const { fullName, email, password, phone, role, permissionSlugs, status, employeeId } =
        parsed.data
      const cleanEmail = email.toLowerCase().trim()

      // SECURITY: the previous guard only special-cased OWNER, which meant an
      // ADMIN (or a STAFF account holding `staff.create`) could mint further
      // ADMINs — and ADMIN bypasses every permission check. Role assignment is
      // now bounded by the actor's own rank: only an OWNER may create OWNER or
      // ADMIN accounts.
      assertCanManageStaffAccount({
        actor: req.user,
        targetId: '', // no existing account is being modified
        targetRole: RoleName.CUSTOMER,
        requestedRole: role,
        action: 'createStaff',
      })

      // Per-user permission grants on create are the same authority as the
      // dedicated grant endpoint. Two extra rules apply up front:
      //   - OWNER/ADMIN targets inherit EVERY permission by role, so a stored
      //     grant set would silently change nothing. Refuse the request.
      //   - A STAFF grantor may only grant slugs it already holds (enforced by
      //     `assertCanAssignPermissions`); never to itself, which is impossible
      //     here because the account does not exist yet.
      let grantIdBySlug: Map<string, string> | null = null
      if (permissionSlugs?.length) {
        const slugs = Array.from(new Set(permissionSlugs))
        if (role === RoleName.OWNER || role === RoleName.ADMIN) {
          res.status(400).json({
            error: 'Administrator and Owner accounts inherit every permission and cannot be granted a per-user set.',
          })
          return
        }

        const grants = await prisma.permission.findMany({ where: { slug: { in: slugs } } })
        if (grants.length !== slugs.length) {
          res.status(400).json({ error: 'One or more invalid permission slugs provided.' })
          return
        }

        const actorResolution = await AuthService.resolveUserPermissions(req.user!.id)
        assertCanAssignPermissions({
          actor: req.user,
          targetId: '', // the account is not created yet, so self-grant is moot
          requestedSlugs: slugs,
          grantorPermissions: actorResolution.permissions,
        })

        grantIdBySlug = new Map(grants.map((p) => [p.slug, p.id]))
      }

      // Check email uniqueness
      const existing = await prisma.user.findUnique({ where: { email: cleanEmail } })
      if (existing) {
        res.status(409).json({ error: 'An account with this email address already exists.' })
        return
      }

      // Employee ids are unique across every user (including customers), so a
      // supplied id must be checked before the insert. An omitted id is
      // allocated here rather than in the browser, where it was previously
      // generated and then discarded by the API.
      const resolvedEmployeeId = employeeId?.trim() || (await StaffController.nextEmployeeId())
      const employeeIdTaken = await prisma.user.findFirst({
        where: { employeeId: resolvedEmployeeId },
        select: { id: true },
      })
      if (employeeIdTaken) {
        res.status(409).json({ error: 'That employee ID is already in use.' })
        return
      }

      const passwordHash = await AuthService.hashPassword(password)
      const targetRole = await prisma.role.findUnique({ where: { name: role } })

      const newStaff = await prisma.$transaction(async (tx) => {
        const u = await tx.user.create({
          data: {
            email: cleanEmail,
            fullName,
            employeeId: resolvedEmployeeId,
            phone: phone || null,
            passwordHash,
            role,
            isActive: status === 'active',
            isVerified: true,
          },
        })

        if (targetRole) {
          await tx.userRole.create({
            data: {
              userId: u.id,
              roleId: targetRole.id,
              assignedBy: req.user?.id || 'SYSTEM',
            },
          })
        }

        if (grantIdBySlug) {
          for (const slug of Array.from(new Set(permissionSlugs ?? []))) {
            await tx.userPermission.create({
              data: {
                userId: u.id,
                permissionId: grantIdBySlug.get(slug)!,
                assignedBy: req.user?.id || 'SYSTEM',
              },
            })
          }
        }

        return u
      })

      const { roles, permissions } = await AuthService.resolveUserPermissions(newStaff.id)

      await AuditService.record({
        action: 'STAFF_CREATED',
        entity: 'User',
        entityId: newStaff.id,
        metadata: {
          staffEmail: newStaff.email,
          role: newStaff.role,
          assignedBy: req.user?.email,
          ...(permissionSlugs?.length ? { grantedPermissions: Array.from(new Set(permissionSlugs)) } : {}),
        },
        req,
      })

      await StaffController.adminAlert({
        eventKey: `staff_created:${newStaff.id}`,
        action: 'Staff account created',
        detail: `${newStaff.fullName} (${newStaff.email}) was created with the ${newStaff.role} role.`,
      })

      res.status(201).json({
        success: true,
        message: 'Staff account created successfully.',
        staff: {
          id: newStaff.id,
          fullName: newStaff.fullName,
          email: newStaff.email,
          phone: newStaff.phone,
          employeeId: newStaff.employeeId,
          role: newStaff.role,
          roles,
          permissions,
          isActive: newStaff.isActive,
          createdAt: newStaff.createdAt.toISOString(),
        },
      })
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to create staff account')
      sendControllerError(res, error, 'Failed to create staff account', req.id)
    }
  }

  /**
   * PATCH /api/v1/admin/staff/:id
   * Updates staff details, role, or active status.
   */
  public static async updateStaff(req: Request, res: Response): Promise<void> {
    try {
      const id = String(req.params.id)
      const parsed = updateStaffSchema.safeParse(req.body)

      if (!parsed.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: parsed.error.errors.map(e => e.message),
        })
        return
      }

      // `permissionSlugs` was accepted by this schema but silently discarded by
      // the handler — a control that reports success while changing nothing.
      // Route it to the dedicated grant endpoint with an explicit error.
      if (parsed.data.permissionSlugs !== undefined) {
        res.status(400).json({
          error: 'permissionSlugs is not supported here. Use PATCH /admin/staff/:id/permissions to change per-user permissions.',
        })
        return
      }

      const existingStaff = await prisma.user.findFirst({
        where: { id, isDeleted: false },
      })

      if (!existingStaff) {
        res.status(404).json({ error: 'Staff member not found.' })
        return
      }

      // SECURITY: rank-based authority check. The previous guards only covered
      // the OWNER role, so a STAFF account holding `staff.update` could set
      // `role: "ADMIN"` on itself — or on any colleague — and thereby bypass
      // every permission check on the platform.
      assertCanManageStaffAccount({
        actor: req.user,
        targetId: existingStaff.id,
        targetRole: existingStaff.role,
        requestedRole: parsed.data.role,
        action: 'updateStaff',
      })

      // `status` is the newer, explicit form; `isActive` remains for older
      // clients. `status` wins when both are present.
      const nextActive =
        parsed.data.status !== undefined
          ? parsed.data.status === 'active'
          : parsed.data.isActive

      // Prevent disabling the only active OWNER
      if (existingStaff.role === RoleName.OWNER && nextActive === false) {
        const ownerCount = await prisma.user.count({
          where: { role: RoleName.OWNER, isActive: true, isDeleted: false },
        })
        if (ownerCount <= 1) {
          res.status(400).json({ error: 'Cannot disable the only active Owner account in the platform.' })
          return
        }
      }

      if (parsed.data.employeeId !== undefined) {
        const employeeIdTaken = await prisma.user.findFirst({
          where: { employeeId: parsed.data.employeeId, id: { not: id } },
          select: { id: true },
        })
        if (employeeIdTaken) {
          res.status(409).json({ error: 'That employee ID is already in use.' })
          return
        }
      }

      const updateData: any = {}
      if (parsed.data.fullName !== undefined) updateData.fullName = parsed.data.fullName
      if (parsed.data.phone !== undefined) updateData.phone = parsed.data.phone
      if (parsed.data.employeeId !== undefined) updateData.employeeId = parsed.data.employeeId
      if (nextActive !== undefined) updateData.isActive = nextActive
      if (parsed.data.role !== undefined) updateData.role = parsed.data.role

      const updated = await prisma.$transaction(async (tx) => {
        const u = await tx.user.update({
          where: { id },
          data: updateData,
        })

        if (parsed.data.role) {
          const roleRecord = await tx.role.findUnique({ where: { name: parsed.data.role } })
          if (roleRecord) {
            await tx.userRole.deleteMany({ where: { userId: id } })
            await tx.userRole.create({
              data: {
                userId: id,
                roleId: roleRecord.id,
                assignedBy: req.user?.id || 'SYSTEM',
              },
            })
          }
        }

        return u
      })

      const { roles, permissions } = await AuthService.resolveUserPermissions(updated.id)

      const auditAction =
        nextActive === false
          ? 'STAFF_DISABLED'
          : nextActive === true && existingStaff.isActive === false
            ? 'STAFF_REACTIVATED'
            : 'STAFF_UPDATED'

      await AuditService.record({
        action: auditAction,
        entity: 'User',
        entityId: updated.id,
        metadata: {
          staffEmail: updated.email,
          changes: parsed.data,
          updatedBy: req.user?.email,
        },
        req,
      })

      if (nextActive === false) {
        await StaffController.adminAlert({
          eventKey: `staff_disabled:${updated.id}`,
          action: 'Staff account disabled',
          detail: `${updated.fullName} (${updated.email}) was deactivated.`,
        })
      } else if (nextActive === true && existingStaff.isActive === false) {
        await StaffController.adminAlert({
          eventKey: `staff_reactivated:${updated.id}`,
          action: 'Staff account reactivated',
          detail: `${updated.fullName} (${updated.email}) was reactivated.`,
        })
      }

      res.status(200).json({
        success: true,
        message: 'Staff account updated successfully.',
        staff: {
          id: updated.id,
          fullName: updated.fullName,
          email: updated.email,
          phone: updated.phone,
          employeeId: updated.employeeId,
          role: updated.role,
          roles,
          permissions,
          isActive: updated.isActive,
          updatedAt: updated.updatedAt.toISOString(),
        },
      })
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to update staff account')
      // SECURITY: `assertCanManageStaffAccount` throws ForbiddenError from
      // inside this try block. A blanket 500 here turned every refused
      // escalation attempt into "Internal Server Error" — the denial was
      // enforced, but the caller could not tell a refusal from a server fault,
      // and operators lost the distinction in their error metrics. Route the
      // typed error through the mapper so a refusal reads as 403.
      sendControllerError(res, error, 'Failed to update staff account.', req.id)
    }
  }

  /**
   * DELETE /api/v1/admin/staff/:id
   * Soft-deletes a staff account and terminates active sessions.
   */
  public static async deleteStaff(req: Request, res: Response): Promise<void> {
    try {
      const id = String(req.params.id)
      const existing = await prisma.user.findFirst({
        where: { id, isDeleted: false },
      })

      if (!existing) {
        res.status(404).json({ error: 'Staff member not found.' })
        return
      }

      // Safeguard: Cannot delete self
      if (existing.id === req.user?.id) {
        res.status(400).json({ error: 'You cannot delete your own administrative account.' })
        return
      }

      // SECURITY: a STAFF account holding `staff.delete` could previously
      // soft-delete any ADMIN, because only OWNER targets were guarded. Denial
      // of service against the operations team is still an availability attack.
      assertCanManageStaffAccount({
        actor: req.user,
        targetId: existing.id,
        targetRole: existing.role,
        action: 'deleteStaff',
      })

      // Safeguard: Cannot delete the last active OWNER
      if (existing.role === RoleName.OWNER) {
        const ownerCount = await prisma.user.count({
          where: { role: RoleName.OWNER, isActive: true, isDeleted: false },
        })
        if (ownerCount <= 1) {
          res.status(400).json({ error: 'Cannot delete the only active Owner account.' })
          return
        }
      }

      // Soft delete and revoke all refresh tokens
      await prisma.$transaction([
        prisma.user.update({
          where: { id },
          data: {
            isActive: false,
            isDeleted: true,
            deletedAt: new Date(),
          },
        }),
        prisma.refreshToken.updateMany({
          where: { userId: id, isRevoked: false },
          data: { isRevoked: true, revokedAt: new Date() },
        }),
      ])

      await AuditService.record({
        action: 'STAFF_DELETED',
        entity: 'User',
        entityId: id,
        metadata: {
          staffEmail: existing.email,
          role: existing.role,
          deletedBy: req.user?.email,
        },
        req,
      })

      await StaffController.adminAlert({
        eventKey: `staff_deleted:${id}`,
        action: 'Staff account deleted',
        detail: `${existing.fullName} (${existing.email}) was removed.`,
      })

      res.status(200).json({
        success: true,
        message: 'Staff account removed successfully.',
      })
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to delete staff account')
      // Same reason as `updateStaff`: a rank denial must surface as 403, not be
      // flattened into an ambiguous 500 by the catch-all.
      sendControllerError(res, error, 'Failed to delete staff account.', req.id)
    }
  }

  /**
   * GET /api/v1/admin/roles
   * Lists all available roles with assigned permissions.
   */
  public static async listRoles(_req: Request, res: Response): Promise<void> {
    try {
      const roles = await prisma.role.findMany({
        include: {
          rolePermissions: {
            include: {
              permission: true,
            },
          },
        },
      })

      const formatted = roles.map(r => ({
        id: r.id,
        name: r.name,
        description: r.description,
        isSystem: r.isSystem,
        permissions: r.rolePermissions.map(rp => rp.permission?.slug).filter(Boolean),
      }))

      res.status(200).json({ success: true, items: formatted })
    } catch {
      res.status(500).json({ error: 'Failed to list roles.' })
    }
  }

  /**
   * GET /api/v1/admin/permissions
   * Lists all granular permissions grouped by module.
   */
  public static async listPermissions(_req: Request, res: Response): Promise<void> {
    try {
      const permissions = await prisma.permission.findMany({
        orderBy: [{ module: 'asc' }, { slug: 'asc' }],
      })

      res.status(200).json({ success: true, items: permissions })
    } catch {
      res.status(500).json({ error: 'Failed to list permissions.' })
    }
  }

  /**
   * PATCH /api/v1/admin/staff/:id/permissions
   * Assign/update permissions for a staff member.
   */
  public static async updateStaffPermissions(req: Request, res: Response): Promise<void> {
    try {
      const id = String(req.params.id)
      const parsed = updateStaffPermissionsSchema.safeParse(req.body)

      if (!parsed.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: parsed.error.errors.map(e => e.message),
        })
        return
      }

      const existingStaff = await prisma.user.findFirst({
        where: { id, isDeleted: false },
      })

      if (!existingStaff) {
        res.status(404).json({ error: 'Staff member not found.' })
        return
      }

      // SECURITY: target reach. The account being edited must rank STRICTLY
      // below the actor, so a STAFF cannot retarget an ADMIN or a peer, and an
      // ADMIN cannot reach a fellow ADMIN. No rank change is involved — granting
      // or revoking a granular slug is not a role promotion — but the reach rule
      // still bounds who may touch whom.
      assertCanManageStaffAccount({
        actor: req.user,
        targetId: existingStaff.id,
        targetRole: existingStaff.role,
        action: 'updateStaffPermissions',
      })

      const permissionSlugs = Array.from(new Set(parsed.data.permissionSlugs))

      const permissions = await prisma.permission.findMany({
        where: { slug: { in: permissionSlugs } },
      })

      if (permissions.length !== permissionSlugs.length) {
        res.status(400).json({ error: 'One or more invalid permission slugs provided.' })
        return
      }

      // An OWNER/ADMIN target inherits every permission by role, so a stored
      // grant set would silently change nothing. Refuse, keeping the claim and
      // the effect aligned.
      const targetResolution = await AuthService.resolveUserPermissions(id)
      if (
        targetResolution.roles.includes(RoleName.OWNER) ||
        targetResolution.roles.includes(RoleName.ADMIN)
      ) {
        res.status(400).json({
          error: 'Administrator and Owner accounts inherit every permission and cannot be granted a per-user set.',
        })
        return
      }

      const existingGrants = await prisma.userPermission.findMany({
        where: { userId: id },
        include: { permission: { select: { slug: true } } },
      })

      // An empty set is unambiguous only once the account already carries an
      // override: it means "strip this account to zero permissions". Without an
      // existing override it could equally mean "revert to role-derived
      // grants". Fail closed with an explicit error rather than guessing.
      if (permissionSlugs.length === 0 && existingGrants.length === 0) {
        res.status(400).json({
          error: 'An empty permission set is ambiguous for an account with no existing override. Provide at least one permission slug, or assign a role to change role-derived permissions.',
        })
        return
      }

      // SECURITY: grant authority. The actor may never write its own
      // permission set, and a non-privileged (STAFF) actor may only hand out
      // slugs it already holds. OWNER/ADMIN grantors bypass the holds-check
      // because they inherit every permission.
      if (permissionSlugs.length > 0) {
        const grantorResolution = await AuthService.resolveUserPermissions(req.user!.id)
        assertCanAssignPermissions({
          actor: req.user,
          targetId: id,
          requestedSlugs: permissionSlugs,
          grantorPermissions: grantorResolution.permissions,
        })
      }

      const slugIndex = new Map(permissions.map((p) => [p.slug, p.id]))
      const activeSlugs = new Set<string>(
        existingGrants.filter((g) => !g.revokedAt).map((g) => g.permission.slug)
      )
      const targetSet = new Set(permissionSlugs)
      const added: string[] = []
      const removed: string[] = []

      await prisma.$transaction(async (tx) => {
        // Grant: activate rows that are currently absent or revoked.
        for (const slug of targetSet) {
          if (activeSlugs.has(slug)) continue
          const prior = existingGrants.find((g) => g.permission.slug === slug)
          if (prior) {
            await tx.userPermission.update({
              where: { id: prior.id },
              data: { revokedAt: null, assignedBy: req.user?.id, assignedAt: new Date() },
            })
          } else {
            await tx.userPermission.create({
              data: {
                userId: id,
                permissionId: slugIndex.get(slug)!,
                assignedBy: req.user?.id,
              },
            })
          }
          added.push(slug)
        }

        // Revoke: tombstone rows whose slug is absent from the target set. A
        // revoked row is retained (never deleted) so the account keeps its
        // override — an all-revoked account resolves to ZERO permissions
        // instead of falling back to the role's grants.
        for (const g of existingGrants) {
          if (g.revokedAt || targetSet.has(g.permission.slug)) continue
          await tx.userPermission.update({
            where: { id: g.id },
            data: { revokedAt: new Date() },
          })
          removed.push(g.permission.slug)
        }
      })

      const { roles, permissions: resolvedPermissions } =
        await AuthService.resolveUserPermissions(id)

      if (added.length > 0 || removed.length > 0) {
        await AuditService.record({
          action: 'STAFF_PERMISSIONS_UPDATED',
          entity: 'User',
          entityId: id,
          metadata: {
            staffEmail: existingStaff.email,
            added,
            removed,
            updatedBy: req.user?.email,
          },
          req,
        })

        // Permission changes must take effect immediately even for an
        // already-issued access token: `authenticate` re-resolves permissions
        // from the database on every request, so the revoked slugs stop being
        // honored at once without waiting for token expiry.
      }

      res.status(200).json({
        success: true,
        message: 'Staff permissions updated successfully.',
        staff: {
          id,
          fullName: existingStaff.fullName,
          email: existingStaff.email,
          role: existingStaff.role,
          roles,
          permissions: resolvedPermissions,
        },
      })
    } catch (error: any) {
      // SECURITY: the previous `catch` replied with `error.message`, forwarding
      // Prisma constraint names, column names and file paths to the caller.
      sendControllerError(res, error, 'Failed to update staff permissions', req.id)
    }
  }

  /**
   * POST /api/v1/admin/staff/:id/reset-password
   * Reset a staff member's password.
   */
  public static async resetStaffPassword(req: Request, res: Response): Promise<void> {
    try {
      const id = String(req.params.id)
      const { newPassword } = req.body

      if (!newPassword || typeof newPassword !== 'string') {
        res.status(400).json({ error: 'New password is required.' })
        return
      }

      // Validate password strength
      const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d).{8,128}$/
      if (!passwordRegex.test(newPassword)) {
        res.status(400).json({ error: 'Password must be at least 8 characters and contain at least one letter and one number.' })
        return
      }

      const existingStaff = await prisma.user.findFirst({
        where: { id, isDeleted: false },
      })

      if (!existingStaff) {
        res.status(404).json({ error: 'Staff member not found.' })
        return
      }

      // SECURITY: same escalation path as `updateStaff`, reached through a
      // different verb. Taking over an ADMIN account by resetting its password
      // grants everything ADMIN has, which is every permission in the system.
      assertCanManageStaffAccount({
        actor: req.user,
        targetId: existingStaff.id,
        targetRole: existingStaff.role,
        action: 'resetStaffPassword',
      })

      const passwordHash = await AuthService.hashPassword(newPassword)

      await prisma.user.update({
        where: { id },
        data: { passwordHash },
      })

      // Revoke all refresh tokens to force re-login
      await prisma.refreshToken.updateMany({
        where: { userId: id, isRevoked: false },
        data: { isRevoked: true, revokedAt: new Date() },
      })

      await AuditService.record({
        action: 'STAFF_PASSWORD_RESET',
        entity: 'User',
        entityId: id,
        metadata: {
          staffEmail: existingStaff.email,
          resetBy: req.user?.email,
        },
        req,
      })

      await StaffController.adminAlert({
        eventKey: `staff_password_reset:${id}:${Date.now()}`,
        action: 'Staff password reset',
        detail: `The password for ${existingStaff.fullName} (${existingStaff.email}) was reset and all active sessions were terminated.`,
      })

      res.status(200).json({
        success: true,
        message: 'Staff password reset successfully. All active sessions have been terminated.',
      })
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to reset staff password')
      // Password reset reaches `assertCanManageStaffAccount` too; a refused
      // account takeover is a 403, and must not be reported as a server fault.
      sendControllerError(res, error, 'Failed to reset staff password.', req.id)
    }
  }
}
