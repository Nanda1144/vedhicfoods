import { NextFunction, Request, Response } from 'express'
import { ContentService } from '../services/content.service'
import {
  adminFaqQuerySchema,
  adminReviewQuerySchema,
  adminTestimonialQuerySchema,
  createFaqSchema,
  createTestimonialSchema,
  moderateReviewSchema,
  newsletterSubscribeSchema,
  submitReviewSchema,
  updateFaqSchema,
  updateTestimonialSchema,
} from '../types/content.types'

function stringify(value: unknown): string {
  return value === undefined || value === null ? '' : String(value)
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

// ==========================================
// PUBLIC STOREFRONT ENDPOINTS
// ==========================================

export class ContentController {
  /** GET /api/v1/content/testimonials */
  public static async listTestimonials(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const featuredOnly = req.query.featured === 'true'
      res.status(200).json(await ContentService.listPublicTestimonials({ featuredOnly }))
    } catch (error) {
      next(error)
    }
  }

  /** GET /api/v1/content/faqs */
  public static async listFaqs(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      res.status(200).json(await ContentService.listPublicFaqs())
    } catch (error) {
      next(error)
    }
  }

  /** GET /api/v1/content/reviews?productId=... */
  public static async listReviews(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const productId = stringify(req.query.productId) || undefined
      res.status(200).json(await ContentService.listPublicReviews(productId))
    } catch (error) {
      next(error)
    }
  }

  /** POST /api/v1/content/reviews (authenticated) */
  public static async submitReview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = submitReviewSchema.parse(req.body)
      const review = await ContentService.submitReview(req.user!.id, input)
      res.status(201).json(review)
    } catch (error) {
      next(error)
    }
  }

  /** POST /api/v1/content/newsletter (public, rate-limited) */
  public static async subscribeNewsletter(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = newsletterSubscribeSchema.parse(req.body)
      res.status(200).json(await ContentService.subscribeNewsletter(input))
    } catch (error) {
      next(error)
    }
  }

  // ==========================================
  // ADMIN ENDPOINTS
  // ==========================================

  /** GET /api/v1/admin/content (summary counts for the CMS landing card) */
  public static async getSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const [testimonials, faqs, reviews, subscribers] = await Promise.all([
        ContentService.listAdminTestimonials(),
        ContentService.listAdminFaqs(),
        ContentService.listAdminReviews({ status: 'pending', page: 1, limit: 1 }),
        ContentService.listSubscribers({ page: 1, limit: 1 }),
      ])
      res.status(200).json({
        testimonials: testimonials.length,
        faqs: faqs.length,
        pendingReviews: reviews.total,
        subscribers: subscribers.total,
      })
    } catch (error) {
      next(error)
    }
  }

  /** GET /api/v1/admin/testimonials */
  public static async listAdminTestimonials(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const q = adminTestimonialQuerySchema.parse(req.query)
      res.status(200).json(await ContentService.listAdminTestimonials({ active: q.active, q: q.q }))
    } catch (error) {
      next(error)
    }
  }

  /** POST /api/v1/admin/testimonials */
  public static async createTestimonial(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = createTestimonialSchema.parse(req.body)
      res.status(201).json(await ContentService.createTestimonial(input, req.user?.id, req))
    } catch (error) {
      next(error)
    }
  }

  /** PATCH /api/v1/admin/testimonials/:id */
  public static async updateTestimonial(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = updateTestimonialSchema.parse(req.body)
      res.status(200).json(await ContentService.updateTestimonial(String(req.params.id), input, req.user?.id, req))
    } catch (error) {
      next(error)
    }
  }

  /** DELETE /api/v1/admin/testimonials/:id */
  public static async deleteTestimonial(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      res.status(200).json(await ContentService.deleteTestimonial(String(req.params.id), req.user?.id, req))
    } catch (error) {
      next(error)
    }
  }

  /** GET /api/v1/admin/faqs */
  public static async listAdminFaqs(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const q = adminFaqQuerySchema.parse(req.query)
      res.status(200).json(await ContentService.listAdminFaqs({ active: q.active, category: q.category, q: q.q }))
    } catch (error) {
      next(error)
    }
  }

  /** GET /api/v1/admin/faq-categories — distinct categories for the filter dropdown. */
  public static async listFaqCategories(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      res.status(200).json(await ContentService.listFaqCategories())
    } catch (error) {
      next(error)
    }
  }

  /** POST /api/v1/admin/faqs */
  public static async createFaq(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = createFaqSchema.parse(req.body)
      res.status(201).json(await ContentService.createFaq(input, req.user?.id, req))
    } catch (error) {
      next(error)
    }
  }

  /** PATCH /api/v1/admin/faqs/:id */
  public static async updateFaq(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = updateFaqSchema.parse(req.body)
      res.status(200).json(await ContentService.updateFaq(String(req.params.id), input, req.user?.id, req))
    } catch (error) {
      next(error)
    }
  }

  /** DELETE /api/v1/admin/faqs/:id */
  public static async deleteFaq(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      res.status(200).json(await ContentService.deleteFaq(String(req.params.id), req.user?.id, req))
    } catch (error) {
      next(error)
    }
  }

  /** GET /api/v1/admin/reviews?status=... */
  public static async listAdminReviews(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const q = adminReviewQuerySchema.parse(req.query)
      res.status(200).json(
        await ContentService.listAdminReviews({
          status: q.status,
          productId: q.productId,
          q: q.q,
          page: q.page,
          limit: q.limit,
        })
      )
    } catch (error) {
      next(error)
    }
  }

  /** PATCH /api/v1/admin/reviews/:id */
  public static async moderateReview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = moderateReviewSchema.parse(req.body)
      res.status(200).json(await ContentService.moderateReview(String(req.params.id), input, req.user?.id, req))
    } catch (error) {
      next(error)
    }
  }

  /** DELETE /api/v1/admin/reviews/:id */
  public static async deleteReview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      res.status(200).json(await ContentService.deleteReview(String(req.params.id), req.user?.id, req))
    } catch (error) {
      next(error)
    }
  }

  /** GET /api/v1/admin/newsletter?q=...&page=1&limit=50 */
  public static async listSubscribers(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const q = stringify(req.query.q) || undefined
      const page = optionalNumber(req.query.page) ?? 1
      const limit = Math.min(optionalNumber(req.query.limit) ?? 50, 100)
      res.status(200).json(await ContentService.listSubscribers({ q, page, limit }))
    } catch (error) {
      next(error)
    }
  }

  /** POST /api/v1/admin/newsletter/:id/unsubscribe — soft unsubscribe by row id. */
  public static async unsubscribeSubscriber(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const sub = await prismaSubscriberEmail(String(req.params.id))
      res.status(200).json(await ContentService.unsubscribeSubscriber(sub.email, req.user?.id))
    } catch (error) {
      next(error)
    }
  }

  /** DELETE /api/v1/admin/newsletter/:id — hard delete (GDPR). */
  public static async deleteSubscriber(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      res.status(200).json(await ContentService.deleteSubscriber(String(req.params.id), req.user?.id, req))
    } catch (error) {
      next(error)
    }
  }
}

// Small helper: the unsubscribe endpoint is keyed by the row id but the service
// takes the email (unique). Resolve it here so the route stays uncluttered.
import { prisma } from '../config/database'
import { NotFoundError } from '../utils/errors'

async function prismaSubscriberEmail(id: string): Promise<{ email: string }> {
  const row = await prisma.newsletterSubscriber.findUnique({ where: { id }, select: { email: true } })
  if (!row) throw new NotFoundError(`Subscriber '${id}' not found`)
  return row
}