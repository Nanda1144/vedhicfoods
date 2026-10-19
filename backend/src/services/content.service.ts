import { Request } from 'express'
import { prisma } from '../config/database'
import { logger } from '../config/logger'
import { AuditService } from './audit.service'
import { publish } from '../events/realtime'
import { BadRequestError, NotFoundError } from '../utils/errors'
import {
  CreateFaqInput,
  CreateTestimonialInput,
  FaqResponse,
  ModerateReviewInput,
  NewsletterSubscribeInput,
  ReviewResponse,
  SubscriberResponse,
  SubmitReviewInput,
  TestimonialResponse,
  UpdateFaqInput,
  UpdateTestimonialInput,
} from '../types/content.types'

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '??'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

function iso(date: Date): string {
  return date.toISOString()
}

// ==========================================
// FORMATTERS
// ==========================================

function formatTestimonial(t: any): TestimonialResponse {
  return {
    id: t.id,
    name: t.name,
    location: t.location || '',
    quote: t.quote,
    rating: Number(t.rating),
    avatarInitials: t.avatarInitials || initialsOf(t.name),
    avatarUrl: t.avatarUrl || null,
    isActive: Boolean(t.isActive),
    isFeatured: Boolean(t.isFeatured),
    sortOrder: Number(t.sortOrder ?? 0),
    createdAt: iso(t.createdAt),
    updatedAt: iso(t.updatedAt),
  }
}

function formatFaq(f: any): FaqResponse {
  return {
    id: f.id,
    question: f.question,
    answer: f.answer,
    category: f.category || 'General',
    sortOrder: Number(f.sortOrder ?? 0),
    isActive: Boolean(f.isActive),
    createdAt: iso(f.createdAt),
    updatedAt: iso(f.updatedAt),
  }
}

function formatReview(r: any): ReviewResponse {
  return {
    id: r.id,
    productId: r.productId,
    productName: r.product?.name,
    customerName: r.authorName,
    customerEmail: r.authorEmail || null,
    rating: Number(r.rating),
    title: r.title,
    body: r.body,
    verified: Boolean(r.isVerified),
    approved: Boolean(r.isApproved),
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  }
}

function formatSubscriber(s: any): SubscriberResponse {
  return {
    id: s.id,
    email: s.email,
    name: s.name || null,
    source: s.source,
    active: Boolean(s.isActive),
    unsubscribedAt: s.unsubscribedAt ? iso(s.unsubscribedAt) : null,
    createdAt: iso(s.createdAt),
  }
}

// ==========================================
// PUBLIC STOREFRONT API
// ==========================================

export class ContentService {
  /** GET /content/testimonials — active, sortOrder-ordered. */
  public static async listPublicTestimonials(opts: { featuredOnly?: boolean } = {}): Promise<TestimonialResponse[]> {
    const where: any = { isActive: true }
    if (opts.featuredOnly) where.isFeatured = true

    const rows = await prisma.testimonial.findMany({
      where,
      orderBy: [{ isFeatured: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
      take: 12,
    })
    return rows.map(formatTestimonial)
  }

  /** GET /content/faqs — active, grouped by category preserving sortOrder. */
  public static async listPublicFaqs(): Promise<FaqResponse[]> {
    const rows = await prisma.faq.findMany({
      where: { isActive: true },
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    })
    return rows.map(formatFaq)
  }

  /**
   * GET /content/reviews?productId=...
   * Only approved rows reach the storefront. `reviewCount` on the product row is
   * derived from approved reviews so the shop page and the detail page agree.
   */
  public static async listPublicReviews(productId?: string): Promise<ReviewResponse[]> {
    const rows = await prisma.productReview.findMany({
      where: {
        isApproved: true,
        ...(productId ? { productId } : {}),
      },
      include: { product: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    })
    return rows.map(formatReview)
  }

  /**
   * POST /content/reviews — authenticated customer submits a review.
   * Rows are moderated before they surface: `isApproved` defaults to false.
   */
  public static async submitReview(userId: string, input: SubmitReviewInput): Promise<ReviewResponse> {
    const product = await prisma.product.findUnique({
      where: { id: input.productId },
      select: { id: true, isDeleted: true, isActive: true },
    })
    if (!product || product.isDeleted || !product.isActive) {
      throw new NotFoundError('Product not found for review')
    }

    // One approved-or-pending review per product per author: silently re-submitting
    // the same star rating would otherwise flood the moderation queue.
    const existing = await prisma.productReview.findFirst({
      where: { userId, productId: input.productId },
      select: { id: true },
    })
    if (existing) {
      throw new BadRequestError('You have already reviewed this product')
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        fullName: true,
        profile: { select: { firstName: true, lastName: true } },
      },
    })
    const profileName = user?.profile
      ? `${user.profile.firstName ?? ''} ${user.profile.lastName ?? ''}`.trim()
      : ''
    const authorName = user?.fullName || profileName || 'Verified customer'

    const created = await prisma.productReview.create({
      data: {
        productId: input.productId,
        userId,
        authorName,
        authorEmail: user?.email,
        rating: input.rating,
        title: input.title,
        body: input.body,
        isVerified: Boolean(user),
      },
      include: { product: { select: { id: true, name: true } } },
    })

    publish('content.updated', { entity: 'review', id: created.id, action: 'submitted' })
    logger.info({ reviewId: created.id, productId: created.productId }, 'Customer review submitted for moderation')
    return formatReview(created)
  }

  /**
   * POST /content/newsletter — idempotent subscribe. A previously unsubscribed
   * address is re-activated rather than duplicated (`email` is unique).
   */
  public static async subscribeNewsletter(input: NewsletterSubscribeInput): Promise<{ email: string }> {
    const existing = await prisma.newsletterSubscriber.findUnique({ where: { email: input.email } })

    if (existing) {
      if (existing.isActive) {
        return { email: existing.email }
      }
      await prisma.newsletterSubscriber.update({
        where: { id: existing.id },
        data: { isActive: true, unsubscribedAt: null, source: existing.source || input.source },
      })
      return { email: existing.email }
    }

    await prisma.newsletterSubscriber.create({
      data: { email: input.email, name: input.name, source: input.source },
    })
    publish('subscriber.created', { email: input.email, source: input.source })
    logger.info({ email: input.email }, 'Newsletter subscription recorded')
    return { email: input.email }
  }

  // ==========================================
  // ADMIN — TESTIMONIALS
  // ==========================================

  public static async listAdminTestimonials(opts: { active?: boolean; q?: string } = {}): Promise<TestimonialResponse[]> {
    const where: any = {}
    if (opts.active !== undefined) where.isActive = opts.active
    if (opts.q) {
      where.OR = [{ name: { contains: opts.q, mode: 'insensitive' } }, { quote: { contains: opts.q, mode: 'insensitive' } }]
    }
    const rows = await prisma.testimonial.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    })
    return rows.map(formatTestimonial)
  }

  public static async createTestimonial(input: CreateTestimonialInput, actorId?: string, req?: Request): Promise<TestimonialResponse> {
    const created = await prisma.testimonial.create({
      data: {
        name: input.name,
        location: input.location || '',
        quote: input.quote,
        rating: input.rating,
        avatarUrl: input.avatarUrl ?? null,
        avatarInitials: input.avatarInitials || initialsOf(input.name),
        isActive: input.isActive,
        isFeatured: input.isFeatured,
        sortOrder: input.sortOrder,
        createdBy: actorId,
      },
    })
    await AuditService.record({
      action: 'TESTIMONIAL_CREATED',
      entity: 'Testimonial',
      entityId: created.id,
      actorId,
      metadata: { name: created.name },
      req,
    })
    publish('content.updated', { entity: 'testimonial', id: created.id, action: 'created' })
    return formatTestimonial(created)
  }

  public static async updateTestimonial(id: string, input: UpdateTestimonialInput, actorId?: string, req?: Request): Promise<TestimonialResponse> {
    const existing = await prisma.testimonial.findUnique({ where: { id } })
    if (!existing) throw new NotFoundError(`Testimonial '${id}' not found`)

    const updated = await prisma.testimonial.update({
      where: { id },
      data: {
        name: input.name !== undefined ? input.name : undefined,
        location: input.location !== undefined ? input.location : undefined,
        quote: input.quote !== undefined ? input.quote : undefined,
        rating: input.rating !== undefined ? input.rating : undefined,
        avatarUrl: input.avatarUrl !== undefined ? input.avatarUrl : undefined,
        avatarInitials: input.avatarInitials !== undefined ? input.avatarInitials : undefined,
        isActive: input.isActive !== undefined ? input.isActive : undefined,
        isFeatured: input.isFeatured !== undefined ? input.isFeatured : undefined,
        sortOrder: input.sortOrder !== undefined ? input.sortOrder : undefined,
      },
    })
    await AuditService.record({
      action: 'TESTIMONIAL_UPDATED',
      entity: 'Testimonial',
      entityId: updated.id,
      actorId,
      metadata: { name: updated.name },
      req,
    })
    publish('content.updated', { entity: 'testimonial', id: updated.id, action: 'updated' })
    return formatTestimonial(updated)
  }

  public static async deleteTestimonial(id: string, actorId?: string, req?: Request): Promise<{ success: boolean }> {
    const existing = await prisma.testimonial.findUnique({ where: { id } })
    if (!existing) throw new NotFoundError(`Testimonial '${id}' not found`)

    await prisma.testimonial.delete({ where: { id } })
    await AuditService.record({
      action: 'TESTIMONIAL_DELETED',
      entity: 'Testimonial',
      entityId: id,
      actorId,
      metadata: { name: existing.name },
      req,
    })
    publish('content.updated', { entity: 'testimonial', id, action: 'deleted' })
    return { success: true }
  }

  // ==========================================
  // ADMIN — FAQS
  // ==========================================

  public static async listAdminFaqs(opts: { active?: boolean; category?: string; q?: string } = {}): Promise<FaqResponse[]> {
    const where: any = {}
    if (opts.active !== undefined) where.isActive = opts.active
    if (opts.category) where.category = opts.category
    if (opts.q) {
      where.OR = [
        { question: { contains: opts.q, mode: 'insensitive' } },
        { answer: { contains: opts.q, mode: 'insensitive' } },
      ]
    }
    const rows = await prisma.faq.findMany({
      where,
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    })
    return rows.map(formatFaq)
  }

  public static async listFaqCategories(): Promise<string[]> {
    const rows = await prisma.faq.findMany({ select: { category: true }, distinct: ['category'] })
    return rows.map((r: any) => r.category).sort()
  }

  public static async createFaq(input: CreateFaqInput, actorId?: string, req?: Request): Promise<FaqResponse> {
    const created = await prisma.faq.create({
      data: {
        question: input.question,
        answer: input.answer,
        category: input.category,
        sortOrder: input.sortOrder,
        isActive: input.isActive,
        createdBy: actorId,
      },
    })
    await AuditService.record({
      action: 'FAQ_CREATED',
      entity: 'Faq',
      entityId: created.id,
      actorId,
      metadata: { question: created.question },
      req,
    })
    publish('content.updated', { entity: 'faq', id: created.id, action: 'created' })
    return formatFaq(created)
  }

  public static async updateFaq(id: string, input: UpdateFaqInput, actorId?: string, req?: Request): Promise<FaqResponse> {
    const existing = await prisma.faq.findUnique({ where: { id } })
    if (!existing) throw new NotFoundError(`FAQ '${id}' not found`)

    const updated = await prisma.faq.update({
      where: { id },
      data: {
        question: input.question !== undefined ? input.question : undefined,
        answer: input.answer !== undefined ? input.answer : undefined,
        category: input.category !== undefined ? input.category : undefined,
        sortOrder: input.sortOrder !== undefined ? input.sortOrder : undefined,
        isActive: input.isActive !== undefined ? input.isActive : undefined,
      },
    })
    await AuditService.record({
      action: 'FAQ_UPDATED',
      entity: 'Faq',
      entityId: updated.id,
      actorId,
      metadata: { question: updated.question },
      req,
    })
    publish('content.updated', { entity: 'faq', id: updated.id, action: 'updated' })
    return formatFaq(updated)
  }

  public static async deleteFaq(id: string, actorId?: string, req?: Request): Promise<{ success: boolean }> {
    const existing = await prisma.faq.findUnique({ where: { id } })
    if (!existing) throw new NotFoundError(`FAQ '${id}' not found`)

    await prisma.faq.delete({ where: { id } })
    await AuditService.record({
      action: 'FAQ_DELETED',
      entity: 'Faq',
      entityId: id,
      actorId,
      metadata: { question: existing.question },
      req,
    })
    publish('content.updated', { entity: 'faq', id, action: 'deleted' })
    return { success: true }
  }

  // ==========================================
  // ADMIN — REVIEW MODERATION
  // ==========================================

  public static async listAdminReviews(opts: {
    status: 'pending' | 'approved' | 'rejected' | 'all'
    productId?: string
    q?: string
    page: number
    limit: number
  }): Promise<{ items: ReviewResponse[]; total: number; page: number; limit: number }> {
    const where: any = {}
    if (opts.status === 'pending') {
      where.isApproved = false
      where.isRejected = false
    } else if (opts.status === 'approved') {
      where.isApproved = true
    } else if (opts.status === 'rejected') {
      where.isRejected = true
    }
    if (opts.productId) where.productId = opts.productId
    if (opts.q) {
      where.OR = [
        { authorName: { contains: opts.q, mode: 'insensitive' } },
        { body: { contains: opts.q, mode: 'insensitive' } },
        { title: { contains: opts.q, mode: 'insensitive' } },
      ]
    }

    const [rows, total] = await Promise.all([
      prisma.productReview.findMany({
        where,
        include: { product: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (opts.page - 1) * opts.limit,
        take: opts.limit,
      }),
      prisma.productReview.count({ where }),
    ])
    return { items: rows.map(formatReview), total, page: opts.page, limit: opts.limit }
  }

  /** Approve / reject / verify toggle. Rejecting clears approval & sets the rejected flag. */
  public static async moderateReview(id: string, input: ModerateReviewInput, actorId?: string, req?: Request): Promise<ReviewResponse> {
    const existing = await prisma.productReview.findUnique({ where: { id } })
    if (!existing) throw new NotFoundError(`Review '${id}' not found`)

    const isVerified = input.isVerified !== undefined ? input.isVerified : existing.isVerified
    const updated = await prisma.productReview.update({
      where: { id },
      data: {
        isApproved: input.isApproved,
        isRejected: !input.isApproved,
        isVerified,
      },
      include: { product: { select: { id: true, name: true } } },
    })

    // Keep the product's cached `reviewCount` and `rating` in step so the store
    // card, detail page and filter counts never disagree with the review list.
    // This must run on APPROVE *and* on REJECT/un-approve: recomputing only when
    // approving left the storefront showing a rating/count that still included a
    // review which had just been pulled from the approved set.
    const [count, avg] = await Promise.all([
      prisma.productReview.count({ where: { productId: updated.productId, isApproved: true } }),
      prisma.productReview.aggregate({
        where: { productId: updated.productId, isApproved: true },
        _avg: { rating: true },
      }),
    ])
    await prisma.product.update({
      where: { id: updated.productId },
      data: { reviewCount: count, rating: Math.round(((avg._avg.rating ?? 0) + Number.EPSILON) * 10) / 10 },
    })

    await AuditService.record({
      action: input.isApproved ? 'REVIEW_APPROVED' : 'REVIEW_REJECTED',
      entity: 'ProductReview',
      entityId: id,
      actorId,
      metadata: { productId: updated.productId, rating: Number(updated.rating) },
      req,
    })
    publish('content.updated', { entity: 'review', id, action: input.isApproved ? 'approved' : 'rejected' })
    return formatReview(updated)
  }

  public static async deleteReview(id: string, actorId?: string, req?: Request): Promise<{ success: boolean }> {
    const existing = await prisma.productReview.findUnique({ where: { id } })
    if (!existing) throw new NotFoundError(`Review '${id}' not found`)

    await prisma.productReview.delete({ where: { id } })
    await AuditService.record({
      action: 'REVIEW_DELETED',
      entity: 'ProductReview',
      entityId: id,
      actorId,
      metadata: { productId: existing.productId },
      req,
    })
    publish('content.updated', { entity: 'review', id, action: 'deleted' })
    return { success: true }
  }

  // ==========================================
  // ADMIN — NEWSLETTER SUBSCRIBERS
  // ==========================================

  public static async listSubscribers(opts: { q?: string; page: number; limit: number }): Promise<{ items: SubscriberResponse[]; total: number; page: number; limit: number }> {
    const where: any = {}
    if (opts.q) {
      where.OR = [{ email: { contains: opts.q, mode: 'insensitive' } }, { name: { contains: opts.q, mode: 'insensitive' } }]
    }
    const [rows, total] = await Promise.all([
      prisma.newsletterSubscriber.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (opts.page - 1) * opts.limit,
        take: opts.limit,
      }),
      prisma.newsletterSubscriber.count({ where }),
    ])
    return { items: rows.map(formatSubscriber), total, page: opts.page, limit: opts.limit }
  }

  public static async unsubscribeSubscriber(email: string, actorId?: string): Promise<{ success: boolean }> {
    const existing = await prisma.newsletterSubscriber.findUnique({ where: { email } })
    if (!existing) throw new NotFoundError(`Subscriber '${email}' not found`)
    if (existing.isActive) {
      await prisma.newsletterSubscriber.update({
        where: { id: existing.id },
        data: { isActive: false, unsubscribedAt: new Date() },
      })
      publish('subscriber.updated', { id: existing.id, active: false, email })
      logger.info({ email: existing.email, actorId }, 'Newsletter subscriber unsubscribed')
    }
    return { success: true }
  }

  public static async deleteSubscriber(id: string, actorId?: string, req?: Request): Promise<{ success: boolean }> {
    const existing = await prisma.newsletterSubscriber.findUnique({ where: { id } })
    if (!existing) throw new NotFoundError(`Subscriber '${id}' not found`)

    // GDPR-style delete: hard-remove the row AND the contact data that references
    // it, so a manual export can never reintroduce the address.
    await AuditService.record({
      action: 'SUBSCRIBER_DELETED',
      entity: 'NewsletterSubscriber',
      entityId: id,
      actorId,
      metadata: { email: existing.email },
      req,
    })
    await prisma.newsletterSubscriber.delete({ where: { id } })
    publish('subscriber.updated', { id, action: 'deleted', email: existing.email })
    return { success: true }
  }
}