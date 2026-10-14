/**
 * Vedhic Foods — database package.
 *
 * Owns the single Prisma schema, the migration chain, the PrismaClient
 * singleton and the AES helpers used for encrypted columns (payment gateway
 * credentials). Backend code must import these from here rather than keeping
 * its own copies, so the platform has exactly one definition of each.
 */

// PrismaClient singleton
export { db, default as prisma } from './client'

// AES-256-GCM helpers for encrypted columns
export { encrypt32, decrypt32, maskSecret } from './encryption'

// Re-exported so consumers get every model, enum and generated type from one
// place instead of importing '@prisma/client' directly in 30+ files.
export * from '@prisma/client'