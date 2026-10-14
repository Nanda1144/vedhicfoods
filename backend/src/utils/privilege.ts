import { RoleName } from '@prisma/client'
import { ForbiddenError } from './errors'

/**
 * Relative authority of each role. Higher wins.
 *
 *   OWNER   3 — platform principal, unconstrained
 *   ADMIN   2 — bypasses every permission check (see requirePermission)
 *   STAFF   1 — bounded entirely by granted permission slugs
 *   CUSTOMER 0 — storefront only, never appears in staff management
 */
const ROLE_RANK: Record<RoleName, number> = {
  [RoleName.OWNER]: 3,
  [RoleName.ADMIN]: 2,
  [RoleName.STAFF]: 1,
  [RoleName.CUSTOMER]: 0,
}

/** Anything that can carry role/permission context. */
export interface ActorLike {
  id?: string
  role?: RoleName
  roles?: RoleName[]
  permissions?: string[]
}

export function roleRank(role: RoleName | undefined | null): number {
  if (!role) return 0
  return ROLE_RANK[role] ?? 0
}

/** The highest rank the actor holds across their primary role and any assigned roles. */
export function actorRank(actor: ActorLike | null | undefined): number {
  if (!actor) return 0
  const ranks = [roleRank(actor.role), ...(actor.roles ?? []).map(roleRank)]
  return ranks.reduce((max, rank) => (rank > max ? rank : max), 0)
}

export function isOwner(actor: ActorLike | null | undefined): boolean {
  if (!actor) return false
  return actor.role === RoleName.OWNER || (actor.roles ?? []).includes(RoleName.OWNER)
}

/**
 * SECURITY: the single authority check for every staff-management mutation.
 *
 * The previous implementation guarded only the OWNER role:
 *
 *   if (existingStaff.role === RoleName.OWNER && !isActorOwner) { ...403... }
 *
 * which left a straightforward escalation path. A STAFF account holding
 * `staff.update` — a permission plausibly granted to a junior ops user — could:
 *
 *   PATCH  /admin/staff/:anyId          { "role": "ADMIN" }   → full admin
 *   POST   /admin/staff/:anyId/reset-password                  → account takeover
 *   DELETE /admin/staff/:anyId                               → disable an admin
 *
 * none of which touched an OWNER account, so every guard passed. Because ADMIN
 * bypasses `requirePermission` outright, the first request alone yields
 * unrestricted access to every customer, order and payment record.
 *
 * Two rules close it:
 *
 *   1. No lateral or upward reach. The actor's rank must be strictly greater
 *      than the rank of the account being touched. An ADMIN therefore cannot
 *      edit another ADMIN; a STAFF cannot edit an ADMIN.
 *   2. No self-promotion. A role assignment is only permitted when the target
 *      role ranks strictly below the actor. OWNER is the sole role an actor may
 *      assign at its own level, which keeps `createStaff` working for owners
 *      while making every other promotion impossible.
 */
export function assertCanManageStaffAccount(options: {
  actor: ActorLike | null | undefined
  targetId: string
  targetRole: RoleName
  /** Role the actor is attempting to assign, when the operation assigns one. */
  requestedRole?: RoleName
  /** Human-readable operation name used in the audit/denial log. */
  action: string
}): void {
  const { actor, targetId, targetRole, requestedRole, action } = options

  if (!actor || !actor.id) {
    throw new ForbiddenError('Authentication required.')
  }

  const rank = actorRank(actor)
  const targetRank = roleRank(targetRole)

  // Rule 2 — role assignment ceiling. An actor may grant any role strictly
  // below its own rank. OWNER is the single exception: an OWNER may create or
  // promote other OWNERs, which is the only way the platform can ever have more
  // than one. Without this carve-out `createStaff` would be unusable for owners.
  const ownerGrantingOwner = isOwner(actor) && requestedRole === RoleName.OWNER

  if (requestedRole && roleRank(requestedRole) >= rank && !ownerGrantingOwner) {
    throw new ForbiddenError(
      `Forbidden: ${action} cannot grant a role at or above your own authority level.`
    )
  }

  // Rule 1 — target reach. Self-service edits are allowed so a user can still
  // correct their own name/phone, but never a role change on themselves.
  const isSelf = actor.id === targetId

  if (!isSelf && targetRank >= rank) {
    throw new ForbiddenError(
      `Forbidden: ${action} cannot modify an account at or above your own authority level.`
    )
  }

  if (isSelf && requestedRole && requestedRole !== targetRole) {
    throw new ForbiddenError('Forbidden: you cannot change your own role.')
  }
}

/**
 * SECURITY: authority check for `PATCH /admin/staff/:id/permissions` and the
 * `permissionSlugs` grant on `POST /admin/staff`.
 *
 * The endpoint previously reported success while changing nothing, then failed
 * closed with a permanent 403 because per-user grants had nowhere to be stored.
 * `user_permissions` now exists, so this guard defines WHO may write it:
 *
 *   1. No one may mutate their own permission set — ownership of the grant
 *      mechanism is itself a permission, and "grant yourself staff.delete" is
 *      escalation by another name.
 *   2. OWNER and ADMIN (rank >= 2) bypass the grant check outright: they already
 *      inherit every slug, so they may distribute any of them.
 *   3. A STAFF grantor may only hand out slugs it already holds. Least
 *      privilege: a junior operator who was never given `contacts.delete` must
 *      not be able to mint that privilege for a colleague.
 *
 * Target reach (your rank must strictly exceed the target's) is enforced by
 * `assertCanManageStaffAccount`, which must run BEFORE this helper.
 */
export function assertCanAssignPermissions(options: {
  actor: ActorLike | null | undefined
  targetId: string
  requestedSlugs: string[]
  grantorPermissions: string[]
}): void {
  const { actor, targetId, requestedSlugs, grantorPermissions } = options

  if (!actor || !actor.id) {
    throw new ForbiddenError('Authentication required.')
  }

  if (actor.id === targetId) {
    throw new ForbiddenError('Forbidden: you cannot change your own permissions.')
  }

  if (actorRank(actor) >= roleRank(RoleName.ADMIN)) return

  for (const slug of requestedSlugs) {
    if (!grantorPermissions.includes(slug)) {
      throw new ForbiddenError(
        `Forbidden: you cannot grant '${slug}' because you do not hold that permission.`
      )
    }
  }
}
