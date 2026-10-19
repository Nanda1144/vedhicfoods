import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { Request } from 'express'
import { RoleName } from '@prisma/client'
import { prisma } from '../config/database'
import { env } from '../config/env'
import { logger } from '../config/logger'
import { AuditService } from './audit.service'
import { AppError, UnauthorizedError, BadRequestError, NotFoundError, ConflictError, ForbiddenError } from '../utils/errors'
import { ERROR_CODES, HTTP_STATUS } from '../constants'
import { getClientIp } from '../utils/client-ip'
import { AuthenticatedUser, RegisterInput, LoginInput } from '../types/auth.types'
import { EmailService } from './email.service'

/** How long the in-process permission catalogue stays warm. See `allPermissionSlugs`. */
const PERMISSION_CACHE_TTL_MS = 60_000

export class AuthService {
  private static readonly BCRYPT_ROUNDS = 12
  private static readonly ACCESS_TOKEN_EXPIRY = '15m'
  private static readonly REFRESH_TOKEN_EXPIRY_DAYS = 7
  /**
   * Idle window for admin-console sessions (OWNER / ADMIN / STAFF).
   *
   * The refresh token is rotated on every use with a fresh expiry, so this is
   * an *inactivity* timeout rather than an absolute one: any authenticated
   * request within the window keeps the session alive, and 72 hours of
   * silence expires the token — the next refresh is rejected and the console
   * returns to the login screen. Customer sessions keep the longer window
   * below; shoppers should not be signed out mid-basket.
   */
  private static readonly CONSOLE_SESSION_IDLE_TTL_HOURS = 72
  private static readonly RESET_TOKEN_EXPIRY_HOURS = 1
  private static readonly VERIFY_TOKEN_EXPIRY_HOURS = 24
  /**
   * Grace window during which presenting a token that was *just* rotated is
   * treated as a benign race rather than theft.
   *
   * Rotation is single-use, so a refresh token that has already been exchanged
   * is `isRevoked`. In practice this also happens for entirely legitimate
   * reasons: two console tabs racing, a request retried after a dropped
   * response, or a client that rotated but never received the replacement.
   * Treating all of those as a breach revoked *every* session the user had,
   * which is exactly the "suddenly every refresh 401s until re-login" symptom.
   * Within this window the previous token is re-rotated instead of killing the
   * account's sessions; only a replay older than this is escalated as reuse.
   */

  /**
   * Expiry for a newly minted or rotated refresh token, by account type.
   *
   * Console roles get the 72-hour idle window; every other role (currently
   * only CUSTOMER) keeps `REFRESH_TOKEN_EXPIRY_DAYS`.
   */
  private static refreshTokenExpiryFor(role: RoleName): Date {
    const expiresAt = new Date()
    const isConsoleRole = role === RoleName.OWNER || role === RoleName.ADMIN || role === RoleName.STAFF
    if (isConsoleRole) {
      expiresAt.setHours(expiresAt.getHours() + this.CONSOLE_SESSION_IDLE_TTL_HOURS)
    } else {
      expiresAt.setDate(expiresAt.getDate() + this.REFRESH_TOKEN_EXPIRY_DAYS)
    }
    return expiresAt
  }

  /**
   * Hashes a raw token string with SHA-256 for secure database storage.
   */
  public static hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex')
  }

  /**
   * Hashes a password using bcrypt with standard cost factor.
   */
  public static async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, this.BCRYPT_ROUNDS)
  }

  /**
   * Verifies password against stored bcrypt or sha256 hash.
 *
 * SECURITY: the legacy SHA-256 branch compares digests in constant time.
 * A plain `===` on secret-derived hex leaks timing information that lets an
 * attacker recover the digest byte by byte.
 */
  public static async verifyPassword(plainPassword: string, storedHash: string): Promise<boolean> {
    // 1. Standard bcrypt verification
    if (storedHash.startsWith('$2a$') || storedHash.startsWith('$2b$') || storedHash.startsWith('$2y$')) {
      return bcrypt.compare(plainPassword, storedHash)
    }

    // 2. SHA-256 fallback for migrated legacy hashes
    const expected = crypto.createHash('sha256').update(plainPassword).digest()
    const received = Buffer.from(String(storedHash), 'hex')

    if (received.length !== expected.length) {
      // Still burn a comparison so a length mismatch is not distinguishable by timing.
      crypto.timingSafeEqual(expected, expected)
      return false
    }

    return crypto.timingSafeEqual(expected, received)
  }

  /**
   * Generates a short-lived signed JWT access token containing safe user and permission claims.
   *
   * SECURITY:
   * - The algorithm is pinned to HS256 so a verifier can never be coerced into
   *   accepting a differently-signed token.
   * - `tokenType: 'access'` distinguishes this from a refresh token. Both are
   *   signed with the same secret, so the middleware asserts this claim to stop
   *   a stolen refresh token from being replayed as a bearer credential.
   */
  public static generateAccessToken(user: {
    id: string
    email: string
    role: RoleName
    roles: RoleName[]
    permissions: string[]
  }): string {
    return jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
        roles: user.roles,
        permissions: user.permissions,
        tokenType: 'access',
      },
      env.JWT_SECRET,
      { expiresIn: this.ACCESS_TOKEN_EXPIRY, algorithm: 'HS256' }
    )
  }

  /**
   * Generates a high-entropy refresh token, persists its SHA-256 hash to PostgreSQL,
   * and returns the raw token to be delivered to the client.
   *
   * The TTL depends on the account type: console roles (OWNER/ADMIN/STAFF)
   * expire after 72 hours of inactivity; customers after 7 days. See
   * `refreshTokenExpiryFor`.
   */
  public static async generateRefreshToken(userId: string, role: RoleName, req?: Request): Promise<string> {
    const rawToken = crypto.randomBytes(40).toString('hex')
    const tokenHash = this.hashToken(rawToken)

    const expiresAt = this.refreshTokenExpiryFor(role)

    const ipAddress = req
      ? getClientIp(req)
      : null
    const userAgent = req ? (req.headers['user-agent'] as string) || null : null

    await prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt,
        ipAddress,
        userAgent,
      },
    })

    return rawToken
  }

  /**
   * Resolves effective roles and granular permissions for a given user from database.
   *
   * SECURITY: also reports the account's lifecycle state. The previous version
   * returned `{ roles: [CUSTOMER], permissions: [] }` for a user that no longer
   * exists, and never surfaced `isActive` / `isDeleted` at all — so callers had no
   * way to distinguish a live account from one that had been suspended or
   * deleted. `authenticate` consequently honoured an unexpired access token
   * belonging to a deactivated employee, leaving offboarding and incident
   * response with a window equal to the access-token lifetime.
   */
  /**
 * PERFORMANCE: the full permission catalogue, cached in-process for a short TTL.
 *
 * `resolveUserPermissions` runs on EVERY authenticated request (it is the
 * security check that makes account deactivation take effect immediately rather
 * than at token expiry). For any OWNER or ADMIN it additionally issued
 * `permission.findMany({ select: { slug: true } })` — a full read of the entire
 * permissions table — on every single request, purely to populate an array that
 * `requirePermission` then ignores, because that middleware already
 * short-circuits for OWNER/ADMIN.
 *
 * The permission catalogue is seeded by migrations and is not mutated at
 * runtime; individual user grants live in `rolePermissions`/`userPermissions`
 * and are still read fresh on every request, so revoking a user's access is not
 * delayed by this cache. Only the catalogue of *what exists* is cached.
 *
 * MULTI-INSTANCE: this is a cache, never a source of truth, so each instance
 * warming independently is correct — worst case an instance is up to `TTL` stale
 * after a migration adds a new permission row, which is not a security event
 * (a permission nobody has been granted is still not granted to anyone). When
 * Redis is available this should move there so the catalogue is shared; until
 * then the TTL bounds the divergence.
 */
private static permissionSlugCache: { slugs: string[]; expiresAt: number } | null = null

private static async allPermissionSlugs(): Promise<string[]> {
    const cached = AuthService.permissionSlugCache
    if (cached && cached.expiresAt > Date.now()) {
      return cached.slugs
    }

    const rows = await prisma.permission.findMany({ select: { slug: true } })
    const slugs = rows.map((r) => r.slug)

    AuthService.permissionSlugCache = {
      slugs,
      expiresAt: Date.now() + PERMISSION_CACHE_TTL_MS,
    }

    return slugs
  }

  /**
   * Drops the cached permission catalogue. Call after a migration or seed that
   * adds or removes permission rows.
   */
  public static invalidatePermissionCache(): void {
    AuthService.permissionSlugCache = null
  }

  public static async resolveUserPermissions(userId: string): Promise<{
    roles: RoleName[]
    permissions: string[]
    primaryRole: RoleName
    exists: boolean
    isActive: boolean
    isDeleted: boolean
  }> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        isActive: true,
        isDeleted: true,
        userRoles: {
          select: {
            role: {
              select: {
                name: true,
                rolePermissions: {
                  select: { permission: { select: { slug: true } } },
                },
              },
            },
          },
        },
      },
    })

    if (!user) {
      return {
        roles: [RoleName.CUSTOMER],
        permissions: [],
        primaryRole: RoleName.CUSTOMER,
        exists: false,
        isActive: false,
        isDeleted: true,
      }
    }

    const roleSet = new Set<RoleName>([user.role])
    const rolePermSet = new Set<string>()

    for (const ur of user.userRoles) {
      roleSet.add(ur.role.name)
      for (const rp of ur.role.rolePermissions) {
        if (rp.permission?.slug) {
          rolePermSet.add(rp.permission.slug)
        }
      }
    }

    // Per-user permission override (`PATCH /admin/staff/:id/permissions`).
    //
    // A `user_permissions` row is the account's own dispensation of granular
    // permissions. When the account carries ANY such row, the user-grant set
    // REPLACES the role-derived set entirely — including the all-revoked case,
    // which resolves to the empty set rather than silently falling back to the
    // role's grants. That distinction is what keeps "remove every permission"
    // honest: an operator who strips an employee must be able to observe the
    // result, and a revoked row prevents the role from quietly re-granting it.
    const effectivePermSet = new Set<string>()

    const userPermRows = await prisma.userPermission.findMany({
      where: { userId },
      select: {
        revokedAt: true,
        permission: { select: { slug: true } },
      },
    })

    if (userPermRows.length > 0) {
      for (const up of userPermRows) {
        if (!up.revokedAt && up.permission?.slug) {
          effectivePermSet.add(up.permission.slug)
        }
      }
    } else {
      for (const slug of rolePermSet) effectivePermSet.add(slug)
    }

    // Owner and Admin roles automatically inherit all permissions in the system.
    // The per-user override is deliberately ignored for them: an OWNER/ADMIN
    // account is all-powerful by role, so a stored grant set would silently
    // change nothing — the controller rejects writing one for these roles.
    if (roleSet.has(RoleName.OWNER) || roleSet.has(RoleName.ADMIN)) {
      for (const slug of await AuthService.allPermissionSlugs()) effectivePermSet.add(slug)
    }

    return {
      roles: Array.from(roleSet),
      permissions: Array.from(effectivePermSet),
      primaryRole: user.role,
      exists: true,
      isActive: user.isActive,
      isDeleted: user.isDeleted,
    }
  }

  /**
   * SECURITY: single choke point for "may this account still authenticate?".
   *
   * Kept as a throw rather than a boolean so that a future call site cannot
   * forget to check — every authentication path must either call this or inspect
   * the lifecycle flags on `resolveUserPermissions`.
   */
  public static assertAccountCanAuthenticate(state: {
    exists: boolean
    isActive: boolean
    isDeleted: boolean
  }): void {
    if (!state.exists || state.isDeleted) {
      throw new UnauthorizedError('This account is no longer active. Please contact support.')
    }

    if (!state.isActive) {
      throw new UnauthorizedError('This account has been deactivated. Please contact support.')
    }
  }

  /**
   * Registers a new customer account.
   */
  public static async register(data: RegisterInput, req?: Request): Promise<{
    user: AuthenticatedUser
    accessToken: string
    refreshToken: string
    verificationToken?: string
  }> {
    const cleanEmail = data.email.toLowerCase().trim()

    // 1. Check if user already exists
    const existing = await prisma.user.findUnique({
      where: { email: cleanEmail },
    })

    if (existing) {
      throw new ConflictError('An account with this email address already exists.')
    }

    // 2. Hash password securely with bcrypt
    const passwordHash = await this.hashPassword(data.password)

    // 3. Create user transactionally with Customer role, Profile, and Verification Token
    const customerRole = await prisma.role.findUnique({ where: { name: RoleName.CUSTOMER } })

    const rawVerifyToken = crypto.randomBytes(32).toString('hex')
    const verifyTokenHash = this.hashToken(rawVerifyToken)
    const verifyExpiresAt = new Date()
    verifyExpiresAt.setHours(verifyExpiresAt.getHours() + this.VERIFY_TOKEN_EXPIRY_HOURS)

    const newUser = await prisma.user.create({
      data: {
        email: cleanEmail,
        fullName: data.fullName.trim(),
        phone: data.phone || null,
        passwordHash,
        role: RoleName.CUSTOMER,
        isActive: true,
        isVerified: false,
        profile: {
          create: {
            firstName: data.fullName.split(' ')[0] || data.fullName,
            lastName: data.fullName.split(' ').slice(1).join(' ') || '',
          },
        },
        userRoles: customerRole
          ? {
              create: {
                roleId: customerRole.id,
                assignedBy: 'SYSTEM_REGISTRATION',
              },
            }
          : undefined,
        emailVerificationTokens: {
          create: {
            tokenHash: verifyTokenHash,
            expiresAt: verifyExpiresAt,
          },
        },
      },
    })

    // 4. Resolve permissions and issue tokens
    const { roles, permissions } = await this.resolveUserPermissions(newUser.id)
    const authUser: AuthenticatedUser = {
      id: newUser.id,
      email: newUser.email,
      fullName: newUser.fullName,
      role: newUser.role,
      roles,
      permissions,
    }

    const accessToken = this.generateAccessToken(authUser)
    const refreshToken = await this.generateRefreshToken(newUser.id, newUser.role, req)

    await AuditService.record({
      actorId: newUser.id,
      actorEmail: newUser.email,
      action: 'USER_REGISTERED',
      entity: 'User',
      entityId: newUser.id,
      metadata: { role: newUser.role, email: newUser.email },
      req,
    })

    // Send verification email
    try {
      await EmailService.sendVerification({
        customerEmail: cleanEmail,
        customerName: newUser.fullName,
        verificationToken: rawVerifyToken,
      })
    } catch (emailError: any) {
      logger.error({ error: emailError.message }, 'Failed to send verification email during registration')
    }

    // Send welcome email
    try {
      await EmailService.sendWelcome({
        customerEmail: cleanEmail,
        customerName: newUser.fullName,
      })
    } catch (emailError: any) {
      logger.error({ error: emailError.message }, 'Failed to send welcome email during registration')
    }

    return {
      user: authUser,
      accessToken,
      refreshToken,
      verificationToken: rawVerifyToken,
    }
  }

  /**
   * Unified, secure authentication endpoint for Customers, Staff, Admins, and Owners.
   */
  public static async login(
    data: LoginInput,
    req?: Request,
    options?: {
      /**
       * When present, the credentials are only accepted if the account holds at
       * least one of these roles. Enforced after the password check but BEFORE
       * any token is minted, so a refused caller walks away with nothing.
       */
      allowedRoles?: RoleName[]
    }
  ): Promise<{
    user: AuthenticatedUser
    accessToken: string
    refreshToken: string
  }> {
    const cleanEmail = data.email.toLowerCase().trim()
    const ipAddress = req
      ? getClientIp(req)
      : null
    const userAgent = req ? (req.headers['user-agent'] as string) || null : null

    // 1. Find user by email
    const user = await prisma.user.findUnique({
      where: { email: cleanEmail },
    })

    // 2. Validate user existence, active status, and not deleted
    if (!user || !user.isActive || user.isDeleted) {
      await prisma.loginAttempt.create({
        data: {
          email: cleanEmail,
          ipAddress,
          userAgent,
          isSuccess: false,
          failureReason: !user ? 'USER_NOT_FOUND' : user.isDeleted ? 'USER_DELETED' : 'USER_INACTIVE',
        },
      })
      throw new UnauthorizedError('Invalid email or password.') // Uniform error to prevent enumeration
    }

    // 3. Verify password
    const isPasswordValid = await this.verifyPassword(data.password, user.passwordHash)

    if (!isPasswordValid) {
      await prisma.loginAttempt.create({
        data: {
          email: cleanEmail,
          ipAddress,
          userAgent,
          isSuccess: false,
          failureReason: 'INVALID_PASSWORD',
        },
      })
      throw new UnauthorizedError('Invalid email or password.')
    }

    // 4. If password was using legacy SHA-256, automatically upgrade to bcrypt
    if (!user.passwordHash.startsWith('$2a$') && !user.passwordHash.startsWith('$2b$')) {
      const upgradedHash = await this.hashPassword(data.password)
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: upgradedHash },
      })
    }

    // 5. Update last login timestamp and record successful login attempt
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    })

    await prisma.loginAttempt.create({
      data: {
        email: cleanEmail,
        ipAddress,
        userAgent,
        isSuccess: true,
      },
    })

    // 6. Resolve RBAC roles & permissions
    const { roles, permissions } = await this.resolveUserPermissions(user.id)

    // 6b. Endpoint-scoped role gate. `POST /admin/auth/login` used to be a
    // plain alias of the storefront login, so a CUSTOMER could obtain a session
    // from the admin console endpoint and be handed an admin-portal token.
    // Every `/admin/*` route re-checks RBAC, so the token was not itself a
    // privilege — but an "admin login" that accepts storefront customers is an
    // authorization boundary that does not exist. Refuse before issuing
    // anything, so no refresh token is persisted either.
    if (options?.allowedRoles?.length) {
      const permitted = options.allowedRoles.some((r) => roles.includes(r))
      if (!permitted) {
        await prisma.loginAttempt.create({
          data: {
            email: cleanEmail,
            ipAddress,
            userAgent,
            isSuccess: false,
            failureReason: 'ROLE_NOT_PERMITTED',
          },
        })
        throw new ForbiddenError('This login endpoint is not available for your account type.')
      }
    }

    const authUser: AuthenticatedUser = {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      roles,
      permissions,
    }

    const accessToken = this.generateAccessToken(authUser)
    const refreshToken = await this.generateRefreshToken(user.id, user.role, req)

    await AuditService.record({
      actorId: user.id,
      actorEmail: user.email,
      action: 'USER_LOGIN',
      entity: 'User',
      entityId: user.id,
      metadata: { roles, primaryRole: user.role },
      req,
    })

    return {
      user: authUser,
      accessToken,
      refreshToken,
    }
  }

  /**
   * Refreshes an access token and performs automatic refresh token rotation (RFC 6819).
   * Detects reuse of revoked tokens and immediately invalidates all tokens for the user if detected.
   */
  public static async refreshAccessToken(rawRefreshToken: string, req?: Request): Promise<{
    accessToken: string
    refreshToken: string
  }> {
    const tokenHash = this.hashToken(rawRefreshToken)

    const storedToken = await prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    })

    if (!storedToken) {
      throw new UnauthorizedError('Invalid or expired refresh token.')
    }

    if (storedToken.isRevoked) await this.rejectRefreshTokenReuse(storedToken, req)

    // Check expiration
    if (storedToken.expiresAt < new Date()) {
      await prisma.refreshToken.update({
        where: { id: storedToken.id },
        data: { isRevoked: true, revokedAt: new Date() },
      })
      throw new UnauthorizedError('Refresh token has expired. Please log in again.')
    }

    // Check user state
    if (!storedToken.user.isActive || storedToken.user.isDeleted) {
      throw new UnauthorizedError('User account is disabled or deleted.')
    }

    // Rotate token: Revoke old token and generate new one
    const newRawRefreshToken = crypto.randomBytes(40).toString('hex')
    const newTokenHash = this.hashToken(newRawRefreshToken)

    const newExpiresAt = this.refreshTokenExpiryFor(storedToken.user.role)

    const ipAddress = req
      ? getClientIp(req)
      : null
    const userAgent = req ? (req.headers['user-agent'] as string) || null : null

    const rotated = await prisma.$transaction(async (tx) => {
      const claimed = await tx.refreshToken.updateMany({
        where: { id: storedToken.id, isRevoked: false },
        data: {
          isRevoked: true,
          revokedAt: new Date(),
          replacedByTokenHash: newTokenHash,
        },
      })
      if (claimed.count !== 1) return false

      await tx.refreshToken.create({
        data: {
          userId: storedToken.userId,
          tokenHash: newTokenHash,
          expiresAt: newExpiresAt,
          ipAddress,
          userAgent,
        },
      })
      return true
    })

    if (!rotated) await this.rejectRefreshTokenReuse(storedToken, req)

    const { roles, permissions } = await this.resolveUserPermissions(storedToken.userId)
    const authUser: AuthenticatedUser = {
      id: storedToken.user.id,
      email: storedToken.user.email,
      fullName: storedToken.user.fullName,
      role: storedToken.user.role,
      roles,
      permissions,
    }

    const accessToken = this.generateAccessToken(authUser)

    return {
      accessToken,
      refreshToken: newRawRefreshToken,
    }
  }

  private static async rejectRefreshTokenReuse(
    token: { id: string; userId: string; user: { email: string } },
    req?: Request,
  ): Promise<never> {
    await prisma.refreshToken.updateMany({
      where: { userId: token.userId, isRevoked: false },
      data: { isRevoked: true, revokedAt: new Date() },
    })

    await AuditService.record({
      actorId: token.userId,
      actorEmail: token.user.email,
      action: 'SECURITY_ALERT_REFRESH_TOKEN_REUSE_DETECTED',
      entity: 'RefreshToken',
      entityId: token.id,
      metadata: { reason: 'Revoked refresh token presented. All active sessions invalidated.' },
      req,
    })

    throw new UnauthorizedError('Compromised session token detected. Please log in again.')
  }

  /**
   * Revokes a specific refresh token (single device logout).
   */
  public static async logout(rawRefreshToken: string, req?: Request): Promise<void> {
    try {
      const tokenHash = this.hashToken(rawRefreshToken)
      const token = await prisma.refreshToken.findUnique({ where: { tokenHash } })

      if (token && !token.isRevoked) {
        await prisma.refreshToken.update({
          where: { id: token.id },
          data: { isRevoked: true, revokedAt: new Date() },
        })

        await AuditService.record({
          actorId: token.userId,
          action: 'USER_LOGOUT',
          entity: 'RefreshToken',
          entityId: token.id,
          req,
        })
      }
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Error revoking refresh token during logout')
    }
  }

  /**
   * Revokes all active refresh tokens for a user (logout across all devices).
   */
  public static async logoutAll(userId: string, req?: Request): Promise<void> {
    await prisma.refreshToken.updateMany({
      where: { userId, isRevoked: false },
      data: { isRevoked: true, revokedAt: new Date() },
    })

    await AuditService.record({
      actorId: userId,
      action: 'USER_LOGOUT_ALL_DEVICES',
      entity: 'User',
      entityId: userId,
      req,
    })
  }

  /**
   * Generates a password reset token and dispatches reset instructions.
   */
  public static async requestPasswordReset(email: string, req?: Request): Promise<{ resetToken?: string }> {
    const cleanEmail = email.toLowerCase().trim()
    const user = await prisma.user.findUnique({ where: { email: cleanEmail } })

    // Generic response returned even if user is not found to prevent user enumeration
    if (!user || !user.isActive || user.isDeleted) {
      return {}
    }

    const rawToken = crypto.randomBytes(32).toString('hex')
    const tokenHash = this.hashToken(rawToken)

    const expiresAt = new Date()
    expiresAt.setHours(expiresAt.getHours() + this.RESET_TOKEN_EXPIRY_HOURS)

    // Invalidate existing unused password reset tokens for this user
    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id, isUsed: false },
      data: { isUsed: true, usedAt: new Date() },
    })

    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    })

    await AuditService.record({
      actorId: user.id,
      actorEmail: user.email,
      action: 'PASSWORD_RESET_REQUESTED',
      entity: 'User',
      entityId: user.id,
      req,
    })

    logger.info({ email: cleanEmail }, 'Password reset token generated')

    try {
      await EmailService.sendPasswordReset({
        customerEmail: cleanEmail,
        customerName: user.fullName,
        resetToken: rawToken,
      })
    } catch (emailError: any) {
      logger.error({ error: emailError.message }, 'Failed to send password reset email')
    }

    return { resetToken: rawToken }
  }

  /**
   * Resets the user's password using a valid, unexpired reset token.
   */
  public static async resetPassword(token: string, newPassword: string, req?: Request): Promise<void> {
    const tokenHash = this.hashToken(token)

    const resetRecord = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    })

    if (!resetRecord || resetRecord.isUsed || resetRecord.expiresAt < new Date()) {
      throw new BadRequestError('Invalid or expired password reset token.')
    }

    const newPasswordHash = await this.hashPassword(newPassword)

    await prisma.$transaction([
      prisma.user.update({
        where: { id: resetRecord.userId },
        data: { passwordHash: newPasswordHash },
      }),
      prisma.passwordResetToken.update({
        where: { id: resetRecord.id },
        data: { isUsed: true, usedAt: new Date() },
      }),
      // Invalidate all active refresh tokens / sessions on password reset
      prisma.refreshToken.updateMany({
        where: { userId: resetRecord.userId, isRevoked: false },
        data: { isRevoked: true, revokedAt: new Date() },
      }),
    ])

    await AuditService.record({
      actorId: resetRecord.userId,
      actorEmail: resetRecord.user.email,
      action: 'PASSWORD_RESET_COMPLETED',
      entity: 'User',
      entityId: resetRecord.userId,
      req,
    })
  }

  /**
   * Changes the password of an already-authenticated user.
   *
   * SECURITY: the admin console's "change password" control previously validated
   * only in the browser and reported success without contacting the server, so
   * the operator believed a weak or compromised password had been replaced when
   * it had not. A control that silently does nothing is worse than an absent one
   * because it is relied upon.
   *
   * Unlike the emailed reset flow, this requires the current password. That
   * matters for privileged accounts: it stops an attacker who found an
   * unattended, still-authenticated console session from locking the real owner
   * out by rotating the credential. All other sessions are revoked, so a
   * hijacked session cannot outlive the rotation.
   */
  public static async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    req?: Request
  ): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, fullName: true, passwordHash: true, isActive: true, isDeleted: true },
    })

    if (!user || user.isDeleted) {
      throw new UnauthorizedError('This account is no longer active. Please contact support.')
    }

    if (!user.isActive) {
      throw new UnauthorizedError('This account has been deactivated. Please contact support.')
    }

    // Uniform failure for unknown-account and wrong-password: the caller already
    // proved who they are, so this is not an enumeration surface.
    const currentPasswordValid = user.passwordHash
      ? await this.verifyPassword(currentPassword, user.passwordHash)
      : false

    if (!currentPasswordValid) {
      await AuditService.record({
        actorId: userId,
        actorEmail: user.email,
        action: 'PASSWORD_CHANGE_REJECTED',
        entity: 'User',
        entityId: userId,
        metadata: { reason: 'current password verification failed' },
        req,
      })

      throw new UnauthorizedError('Current password is incorrect.')
    }

    if (currentPassword === newPassword) {
      throw new AppError(
        'New password must be different from the current password.',
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.BAD_REQUEST
      )
    }

    const newPasswordHash = await this.hashPassword(newPassword)

    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { passwordHash: newPasswordHash },
      }),
      // Revoke every other session: a credential rotation is only meaningful if
      // tokens minted under the old password stop working.
      prisma.refreshToken.updateMany({
        where: { userId, isRevoked: false },
        data: { isRevoked: true, revokedAt: new Date() },
      }),
    ])

    await AuditService.record({
      actorId: userId,
      actorEmail: user.email,
      action: 'PASSWORD_CHANGED',
      entity: 'User',
      entityId: userId,
      metadata: { otherSessionsRevoked: true },
      req,
    })
  }

  /**
   * Verifies a customer's email address using a single-use verification token.
   */
  public static async verifyEmail(token: string, req?: Request): Promise<void> {
    const tokenHash = this.hashToken(token)

    const verifyRecord = await prisma.emailVerificationToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    })

    if (!verifyRecord || verifyRecord.isUsed || verifyRecord.expiresAt < new Date()) {
      throw new BadRequestError('Invalid or expired email verification token.')
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: verifyRecord.userId },
        data: { isVerified: true },
      }),
      prisma.emailVerificationToken.update({
        where: { id: verifyRecord.id },
        data: { isUsed: true, usedAt: new Date() },
      }),
    ])

    await AuditService.record({
      actorId: verifyRecord.userId,
      actorEmail: verifyRecord.user.email,
      action: 'EMAIL_VERIFIED',
      entity: 'User',
      entityId: verifyRecord.userId,
      req,
    })
  }

  /**
   * Fetches the safe, sanitized user profile for the current session.
   */
  public static async getMe(userId: string): Promise<any> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
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

    if (!user || user.isDeleted) {
      throw new NotFoundError('User not found or account deactivated.')
    }

    const { roles, permissions, primaryRole } = await this.resolveUserPermissions(userId)

    return {
      id: user.id,
      name: user.fullName,
      email: user.email,
      phone: user.phone,
      role: primaryRole.toLowerCase(),
      primaryRole,
      roles,
      permissions,
      isActive: user.isActive,
      isVerified: user.isVerified,
      profile: user.profile
        ? {
            firstName: user.profile.firstName,
            lastName: user.profile.lastName,
            avatarUrl: user.profile.avatarUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80',
            loyaltyPoints: user.profile.loyaltyPoints,
            preferences: user.profile.preferences,
          }
        : null,
      createdAt: user.createdAt.toISOString(),
    }
  }
}
