import { z } from 'zod'

// ==========================================
// PUBLIC (STOREFRONT) CONTENT SCHEMAS
// ==========================================

/** Email reused by the newsletter subscribe + review author shapes. */
const emailSchema = z.string().trim().toLowerCase().email('A valid email address is required').max(254)

export const newsletterSubscribeSchema = z.object({
  email: emailSchema,
  name: z.string().trim().max(120).optional(),
  source: z.string().trim().max(40).default('footer'),
})

export const submitReviewSchema = z.object({
  productId: z.string().uuid('Invalid product UUID'),
  rating: z.coerce.number().int().min(1, 'Rating must be between 1 and 5').max(5),
  title: z.string().trim().min(3, 'Review title must be at least 3 characters').max(120),
  body: z.string().trim().min(10, 'Review must be at least 10 characters').max(2000),
})

// ==========================================
// ADMIN CONTENT MANAGEMENT SCHEMAS
// ==========================================

export const createTestimonialSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(120),
  location: z.string().trim().max(120).optional(),
  quote: z.string().trim().min(10, 'Quote must be at least 10 characters').max(1000),
  rating: z.coerce.number().int().min(1).max(5).default(5),
  avatarUrl: z.string().trim().url('Avatar must be a valid URL').optional().nullable(),
  avatarInitials: z.string().trim().max(4).optional(),
  isActive: z.boolean().default(true),
  isFeatured: z.boolean().default(false),
  sortOrder: z.coerce.number().int().min(0).default(0),
})

export const updateTestimonialSchema = createTestimonialSchema.partial()

export const createFaqSchema = z.object({
  question: z.string().trim().min(5, 'Question must be at least 5 characters').max(300),
  answer: z.string().trim().min(10, 'Answer must be at least 10 characters').max(3000),
  category: z.string().trim().min(2, 'Category must be at least 2 characters').max(80).default('General'),
  sortOrder: z.coerce.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
})

export const updateFaqSchema = createFaqSchema.partial()

export const moderateReviewSchema = z.object({
  isApproved: z.boolean(),
  isVerified: z.boolean().optional(),
})

export const adminReviewQuerySchema = z.object({
  // pending | approved | rejected | all
  status: z.enum(['pending', 'approved', 'rejected', 'all']).default('pending'),
  productId: z.string().uuid().optional(),
  q: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

export const adminTestimonialQuerySchema = z.object({
  active: z
    .preprocess(
      (val) => (typeof val === 'string' ? (val.toLowerCase() === 'true' ? true : val.toLowerCase() === 'false' ? false : val) : val),
      z.boolean()
    )
    .optional(),
  q: z.string().trim().optional(),
})

export const adminFaqQuerySchema = z.object({
  active: z
    .preprocess(
      (val) => (typeof val === 'string' ? (val.toLowerCase() === 'true' ? true : val.toLowerCase() === 'false' ? false : val) : val),
      z.boolean()
    )
    .optional(),
  category: z.string().trim().optional(),
  q: z.string().trim().optional(),
})

// ==========================================
// RESPONSE TYPES
// ==========================================

export interface TestimonialResponse {
  id: string
  name: string
  location: string
  quote: string
  rating: number
  avatarInitials?: string | null
  avatarUrl?: string | null
  isActive: boolean
  isFeatured: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface FaqResponse {
  id: string
  question: string
  answer: string
  category: string
  sortOrder: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface ReviewResponse {
  id: string
  productId: string
  productName?: string
  customerName: string
  customerEmail?: string | null
  rating: number
  title: string
  body: string
  verified: boolean
  approved: boolean
  createdAt: string
  updatedAt: string
}

export interface SubscriberResponse {
  id: string
  email: string
  name?: string | null
  source: string
  active: boolean
  unsubscribedAt?: string | null
  createdAt: string
}

export type CreateTestimonialInput = z.infer<typeof createTestimonialSchema>
export type UpdateTestimonialInput = z.infer<typeof updateTestimonialSchema>
export type CreateFaqInput = z.infer<typeof createFaqSchema>
export type UpdateFaqInput = z.infer<typeof updateFaqSchema>
export type SubmitReviewInput = z.infer<typeof submitReviewSchema>
export type NewsletterSubscribeInput = z.infer<typeof newsletterSubscribeSchema>
export type ModerateReviewInput = z.infer<typeof moderateReviewSchema>