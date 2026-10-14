import { RoleName } from '@prisma/client'
import { OrderAccessTokenClaims } from '../utils/order-token'

export interface ApiResponse<T = unknown> {
  success: boolean
  message: string
  data?: T
}

export interface ApiErrorDetail {
  field?: string
  message: string
  code?: string
}

export interface ApiErrorResponse {
  success: false
  message: string
  error: {
    code: string
    details?: ApiErrorDetail[] | unknown
  }
}

export interface PaginationMeta {
  page: number
  perPage: number
  total: number
  totalPages: number
}

export interface PaginatedResult<T> {
  items: T[]
  pagination: PaginationMeta
}

export type UserRole = 'OWNER' | 'ADMIN' | 'STAFF' | 'CUSTOMER'

export interface RequestUser {
  id: string
  email: string
  fullName?: string
  role: RoleName | UserRole
  roles: (RoleName | UserRole)[]
  permissions: string[]
}

declare global {
  namespace Express {
    interface Request {
      id?: string
      user?: RequestUser
      /** Present when the caller authenticated with an anonymous order-access token. */
      orderAccess?: OrderAccessTokenClaims
    }
  }
}
