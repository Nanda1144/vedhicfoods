import { RoleName } from '@prisma/client'
import { z } from 'zod'

export interface AuthenticatedUser {
  id: string
  email: string
  fullName: string
  role: RoleName
  roles: RoleName[]
  permissions: string[]
}

// Password Policy: min 8, max 128, at least 1 number, at least 1 letter
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters long')
  .max(128, 'Password must not exceed 128 characters')
  .regex(/[a-zA-Z]/, 'Password must contain at least one letter')
  .regex(/[0-9]/, 'Password must contain at least one number')

export const registerSchema = z.object({
  fullName: z.string().trim().min(2, 'Full name must be at least 2 characters').max(100),
  email: z.string().trim().toLowerCase().email('Invalid email address'),
  password: passwordSchema,
  phone: z.string().trim().regex(/^\+?[0-9]{10,15}$/, 'Invalid phone number').optional(),
})

export type RegisterInput = z.infer<typeof registerSchema>

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
})

export type LoginInput = z.infer<typeof loginSchema>

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
})

export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email('Invalid email address'),
})

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  newPassword: passwordSchema,
})

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: passwordSchema,
  })
  .refine(data => data.currentPassword !== data.newPassword, {
    message: 'New password must be different from the current password',
    path: ['newPassword'],
  })

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>

export const verifyEmailSchema = z.object({
  token: z.string().min(1, 'Verification token is required'),
})

export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>

export const employeeIdSchema = z
  .string()
  .trim()
  .min(1, 'Employee ID is required')
  .max(40, 'Employee ID is too long')
  .regex(/^[A-Za-z0-9-]+$/, 'Employee ID may only contain letters, numbers and hyphens')

export const createStaffSchema = z.object({
  fullName: z.string().trim().min(2, 'Full name must be at least 2 characters').max(100),
  email: z.string().trim().toLowerCase().email('Invalid email address'),
  password: passwordSchema,
  phone: z.string().trim().regex(/^\+?[0-9]{10,15}$/, 'Invalid phone number').optional(),
  role: z.nativeEnum(RoleName).default(RoleName.STAFF),
  permissionSlugs: z.array(z.string()).optional(),
  /** Omit to allocate the next sequential id (EMP-0001, EMP-0002, …). */
  employeeId: employeeIdSchema.optional(),
  status: z.enum(['active', 'suspended']).default('active'),
})

export type CreateStaffInput = z.infer<typeof createStaffSchema>

export const updateStaffSchema = z.object({
  fullName: z.string().trim().min(2).max(100).optional(),
  phone: z.string().trim().regex(/^\+?[0-9]{10,15}$/).optional(),
  isActive: z.boolean().optional(),
  status: z.enum(['active', 'suspended']).optional(),
  employeeId: employeeIdSchema.optional(),
  role: z.nativeEnum(RoleName).optional(),
  permissionSlugs: z.array(z.string()).optional(),
})

export type UpdateStaffInput = z.infer<typeof updateStaffSchema>

export const updateStaffPermissionsSchema = z.object({
  permissionSlugs: z.array(z.string()),
})

export type UpdateStaffPermissionsInput = z.infer<typeof updateStaffPermissionsSchema>
