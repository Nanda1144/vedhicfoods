import { Router } from 'express'
import { AuthController } from '../controllers/auth.controller'
import { authenticate } from '../middleware/auth.middleware'
import {
  authRateLimiter,
  passwordResetRateLimiter,
  passwordResetVerifyRateLimiter,
  emailVerificationRateLimiter,
} from '../middleware/rate-limiter.middleware'

const router = Router()

// Public Registration & Login
router.post('/register', authRateLimiter, AuthController.register)
router.post('/login', authRateLimiter, AuthController.login)

// Token Lifecycle
// SECURITY: refresh and logout are now rate limited. An unlimited refresh
// endpoint is a cheap way to brute-force or DoS the refresh-token lookup, and
// each refresh performs several database writes (rotation).
router.post('/refresh', passwordResetVerifyRateLimiter, AuthController.refresh)
router.post('/logout', passwordResetVerifyRateLimiter, AuthController.logout)

// Current Authenticated User Context
router.get('/me', authenticate, AuthController.getMe)

/**
 * Authenticated password rotation.
 *
 * SECURITY: rate limited like the reset flow, because it is a credential-guessing
 * surface — unlike the emailed reset path, this endpoint accepts a *current*
 * password and therefore permits repeated attempts against a known account.
 * `authenticate` is deliberately first in the chain: an attacker must hold a
 * valid session to reach the guess at all.
 */
router.put('/change-password', authenticate, authRateLimiter, AuthController.changePassword)

// Password Reset Flow
router.post('/forgot-password', passwordResetRateLimiter, AuthController.forgotPassword)
router.post('/reset-password', passwordResetRateLimiter, AuthController.resetPassword)

// Email Verification
// SECURITY: verification tokens are 64 hex chars from crypto.randomBytes, so
// guessing one is infeasible — but an unthrottled endpoint still lets an
// attacker enumerate token entropy and forces a DB write per attempt.
router.get('/verify-email', emailVerificationRateLimiter, AuthController.verifyEmail)
router.post('/verify-email', emailVerificationRateLimiter, AuthController.verifyEmail)

export const authRoutes = router