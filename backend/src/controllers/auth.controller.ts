import { Request, Response } from 'express'
import { RoleName } from '@prisma/client'
import { AuthService } from '../services/auth.service'
import { logger } from '../config/logger'
import { sendControllerError } from '../utils/api-response'
import { AppError } from '../utils/errors'
import { env } from '../config/env'
import { clearRefreshCookie, hasTrustedOrigin, readCookie, setRefreshCookie, type RefreshCookieName } from '../utils/auth-cookie'
import {
  registerSchema,
  loginSchema,
  refreshTokenSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  verifyEmailSchema,
} from '../types/auth.types'

/**
 * Returns a single-use account token to the caller when the environment allows it.
 *
 * SECURITY: these tokens are the sole bearer of authority for `verify-email`
 * and `reset-password`. They are delivered through the transactional email and
 * surfaced in the HTTP response solely outside production so end-to-end suites
 * can complete the flow without a live mailbox. They are never echoed in
 * production.
 */
export function exposeTestToken(
  key: 'verificationToken' | 'resetToken',
  token?: string,
  nodeEnvironment: string = env.NODE_ENV
): Record<string, string> {
  // Staging can contain real accounts and is often reachable from the internet.
  // Only an isolated test process may return a bearer token in the API response.
  if (nodeEnvironment !== 'test' || !token) return {}
  return { [key]: token }
}

export class AuthController {
  /**
   * POST /api/v1/auth/register
   * Registers a new customer user, creates profile, generates verification token,
   * and issues JWT access and refresh tokens.
   */
  public static async register(req: Request, res: Response): Promise<void> {
    try {
      const parsed = registerSchema.safeParse(req.body)
      if (!parsed.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: parsed.error.errors.map(e => e.message),
        })
        return
      }

      const result = await AuthService.register(parsed.data, req)
      setRefreshCookie(res, 'refreshToken', result.refreshToken)

      res.status(201).json({
        success: true,
        message: 'Account registered successfully.',
        user: result.user,
        accessToken: result.accessToken,
        ...(env.NODE_ENV === 'test' ? { refreshToken: result.refreshToken } : {}),
        ...exposeTestToken('verificationToken', result.verificationToken),
      })
    } catch (error: any) {
      // Expected outcomes (duplicate email, weak password) are typed AppErrors
      // and carry their own status; anything else is logged and masked so a
      // database or provider failure is never echoed back to the caller.
      if (!(error instanceof AppError)) {
        logger.error({ error: error?.message }, 'Registration error')
      }
      sendControllerError(res, error, 'Registration failed.', req.id)
    }
  }

  /**
   * POST /api/v1/auth/login
   * Authenticates any user (Customer, Staff, Admin, Owner) and issues access & refresh tokens.
   */
  public static async login(req: Request, res: Response): Promise<void> {
    try {
      const parsed = loginSchema.safeParse(req.body)
      if (!parsed.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: parsed.error.errors.map(e => e.message),
        })
        return
      }

      const result = await AuthService.login(parsed.data, req)
      setRefreshCookie(res, 'refreshToken', result.refreshToken)

      res.status(200).json({
        success: true,
        token: result.accessToken,
        accessToken: result.accessToken,
        ...(env.NODE_ENV === 'test' ? { refreshToken: result.refreshToken } : {}),
        user: {
          id: result.user.id,
          name: result.user.fullName,
          email: result.user.email,
          role: result.user.role.toLowerCase(),
          roles: result.user.roles,
          permissions: result.user.permissions,
          avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80',
        },
      })
    } catch (error: any) {
      // Wrong credentials surface as a typed 401; an infrastructure failure
      // (database unreachable, audit write failing) must not be reported as a
      // 401 carrying the provider's message, or the caller learns both that the
      // backend is broken and what the underlying error said.
      sendControllerError(res, error, 'Unable to log you in right now. Please try again later.', req.id)
    }
  }

  /**
   * POST /api/v1/auth/refresh
   * Rotates refresh tokens and issues a new short-lived access token.
   */
  public static async refresh(req: Request, res: Response): Promise<void> {
    return AuthController.rotateRefresh(req, res, 'refreshToken')
  }

  /** Admin console refresh uses a separate cookie so both SPAs can be signed in independently. */
  public static async refreshAdmin(req: Request, res: Response): Promise<void> {
    return AuthController.rotateRefresh(req, res, 'adminRefreshToken')
  }

  private static async rotateRefresh(req: Request, res: Response, cookieName: RefreshCookieName): Promise<void> {
    try {
      const cookieToken = readCookie(req, cookieName)
      if (cookieToken && !hasTrustedOrigin(req, cookieName)) {
        res.status(403).json({ error: 'Request origin is not allowed.' })
        return
      }
      const rawToken = cookieToken ?? req.body?.refreshToken
      const parsed = refreshTokenSchema.safeParse({ refreshToken: rawToken })
      if (!parsed.success) {
        res.status(400).json({ error: 'Refresh token is required.' })
        return
      }

      const result = await AuthService.refreshAccessToken(parsed.data.refreshToken, req)
      setRefreshCookie(res, cookieName, result.refreshToken)

      res.status(200).json({
        success: true,
        accessToken: result.accessToken,
        token: result.accessToken,
        ...(env.NODE_ENV === 'test' ? { refreshToken: result.refreshToken } : {}),
      })
    } catch (error: any) {
      sendControllerError(res, error, 'Unable to refresh your session right now. Please try again later.', req.id)
    }
  }

  /**
   * POST /api/v1/auth/logout
   * Revokes the active refresh token session.
   */
  public static async logout(req: Request, res: Response): Promise<void> {
    return AuthController.logoutSession(req, res, 'refreshToken')
  }

  /** Admin logout clears only the console refresh cookie. */
  public static async logoutAdmin(req: Request, res: Response): Promise<void> {
    return AuthController.logoutSession(req, res, 'adminRefreshToken')
  }

  private static async logoutSession(req: Request, res: Response, cookieName: RefreshCookieName): Promise<void> {
    try {
      const cookieToken = readCookie(req, cookieName)
      const refreshToken = req.body?.refreshToken || cookieToken
      if (cookieToken && !hasTrustedOrigin(req, cookieName)) {
        res.status(403).json({ error: 'Request origin is not allowed.' })
        return
      }
      if (refreshToken) {
        await AuthService.logout(refreshToken, req)
      } else if (req.user?.id) {
        await AuthService.logoutAll(req.user.id, req)
      }

      clearRefreshCookie(res, cookieName)
      res.status(200).json({ success: true, message: 'Logged out successfully.' })
    } catch (error: any) {
      logger.error({ error: error.message }, 'Logout error')
      res.status(200).json({ success: true, message: 'Logged out.' })
    }
  }

  /**
   * GET /api/v1/auth/me
   * Fetches the current authenticated user's profile and granted permissions.
   */
  public static async getMe(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user?.id) {
        res.status(401).json({ error: 'Authentication required.' })
        return
      }

      const profile = await AuthService.getMe(req.user.id)
      res.status(200).json(profile)
    } catch (error: any) {
      sendControllerError(res, error, 'User not found.', req.id)
    }
  }

  /**
   * POST /api/v1/auth/forgot-password
   * Generates single-use password reset token and emails instructions.
   */
  public static async forgotPassword(req: Request, res: Response): Promise<void> {
    try {
      const parsed = forgotPasswordSchema.safeParse(req.body)
      if (!parsed.success) {
        res.status(400).json({ error: 'Valid email address is required.' })
        return
      }

      const result = await AuthService.requestPasswordReset(parsed.data.email, req)

      res.status(200).json({
        success: true,
        message: 'If an account exists with this email address, password reset instructions have been sent.',
        // Expose resetToken in non-production environments for automated testing
        ...exposeTestToken('resetToken', result.resetToken),
      })
    } catch (error: any) {
      logger.error({ error: error.message }, 'Forgot password error')
      res.status(200).json({
        success: true,
        message: 'If an account exists with this email address, password reset instructions have been sent.',
      })
    }
  }

  /**
   * POST /api/v1/auth/reset-password
   * Validates reset token and sets new password.
   */
  public static async resetPassword(req: Request, res: Response): Promise<void> {
    try {
      const parsed = resetPasswordSchema.safeParse(req.body)
      if (!parsed.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: parsed.error.errors.map(e => e.message),
        })
        return
      }

      await AuthService.resetPassword(parsed.data.token, parsed.data.newPassword, req)

      res.status(200).json({
        success: true,
        message: 'Your password has been successfully reset. Please log in with your new credentials.',
      })
    } catch (error: any) {
      sendControllerError(res, error, 'Invalid or expired password reset token.', req.id)
    }
  }

  /**
   * PUT /api/v1/auth/change-password
   * Rotates the password of the currently authenticated account.
   *
   * Requires the current password and revokes every refresh-token session, so a
   * rotation genuinely ends sessions established with the old credential.
   */
  public static async changePassword(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user?.id) {
        res.status(401).json({ error: 'Authentication required.' })
        return
      }

      const parsed = changePasswordSchema.safeParse(req.body)
      if (!parsed.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: parsed.error.errors.map(e => e.message),
        })
        return
      }

      await AuthService.changePassword(
        req.user.id,
        parsed.data.currentPassword,
        parsed.data.newPassword,
        req
      )

      res.status(200).json({
        success: true,
        message: 'Password changed. All other sessions have been signed out.',
      })
    } catch (error: any) {
      const statusCode = typeof error?.statusCode === 'number' ? error.statusCode : 400
      // Operational messages from AuthService are written for the end user and
      // carry no internals, so they are safe to return; anything else is masked.
      res.status(statusCode).json({
        error:
          statusCode === 401 || statusCode === 400
            ? error?.message || 'Unable to change password.'
            : 'Unable to change password.',
      })
    }
  }

  /**
   * GET/POST /api/v1/auth/verify-email
   * Validates single-use email verification token.
   */
  public static async verifyEmail(req: Request, res: Response): Promise<void> {
    try {
      const token = (req.query.token as string) || req.body.token
      const parsed = verifyEmailSchema.safeParse({ token })
      if (!parsed.success) {
        res.status(400).json({ error: 'Verification token is required.' })
        return
      }

      await AuthService.verifyEmail(parsed.data.token, req)

      res.status(200).json({
        success: true,
        message: 'Email address verified successfully.',
      })
    } catch (error: any) {
      sendControllerError(res, error, 'Invalid or expired email verification token.', req.id)
    }
  }

  // ============================================================
  // Backward-compatibility aliases for Admin Portal routes
  // ============================================================

  /**
   * POST /api/v1/admin/auth/login
   *
   * SECURITY: this was a one-line alias of the storefront `login`, so the admin
   * console endpoint minted full sessions for CUSTOMER accounts. Authorization
   * on `/admin/*` was never bypassed, but an admin boundary that accepts
   * storefront customers is not a boundary. `AuthService.login` now refuses to
   * issue any token unless the account holds OWNER, ADMIN or STAFF.
   */
  public static async adminLogin(req: Request, res: Response): Promise<void> {
    try {
      const parsed = loginSchema.safeParse(req.body)
      if (!parsed.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: parsed.error.errors.map((e) => e.message),
        })
        return
      }

      const result = await AuthService.login(parsed.data, req, {
        allowedRoles: [RoleName.OWNER, RoleName.ADMIN, RoleName.STAFF],
      })
      setRefreshCookie(res, 'adminRefreshToken', result.refreshToken)

      res.status(200).json({
        success: true,
        token: result.accessToken,
        accessToken: result.accessToken,
        ...(env.NODE_ENV === 'test' ? { refreshToken: result.refreshToken } : {}),
        user: {
          id: result.user.id,
          name: result.user.fullName,
          email: result.user.email,
          role: result.user.role.toLowerCase(),
          roles: result.user.roles,
          permissions: result.user.permissions,
          avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80',
        },
      })
    } catch (error: any) {
      sendControllerError(res, error, 'Unable to log you in right now. Please try again later.', req.id)
    }
  }

  public static async getProfile(req: Request, res: Response): Promise<void> {
    return AuthController.getMe(req, res)
  }
}
