import { apiFetchRaw, type RequestOptions } from './http'
import type {
  AdminFaq,
  AdminReview,
  AdminSubscriber,
  AdminTestimonial,
  ReviewModerationStatus,
} from '@/types'

function items<T>(body: any): T[] {
  if (Array.isArray(body)) return body as T[]
  if (Array.isArray(body?.items)) return body.items as T[]
  return []
}

/**
 * Website content (CMS) administration.
 *
 * Backed by `/admin/content/*`, which is gated by `content.read` /
 * `content.update`. Testimonials and FAQs are full CRUD; reviews are moderated
 * (approve/reject/delete); newsletter subscribers can be unsubscribed or
 * hard-deleted.
 */
export const contentAdminService = {
  /* ---------------------------------------------------- Testimonials */
  async testimonials(options?: RequestOptions): Promise<AdminTestimonial[]> {
    const body = await apiFetchRaw<any>('/admin/content/testimonials', undefined, options)
    return items<AdminTestimonial>(body)
  },

  async createTestimonial(
    input: Omit<AdminTestimonial, 'id' | 'createdAt' | 'updatedAt'>,
    options?: RequestOptions,
  ): Promise<AdminTestimonial> {
    return apiFetchRaw<AdminTestimonial>(
      '/admin/content/testimonials',
      { method: 'POST', body: JSON.stringify(input) },
      options,
    )
  },

  async updateTestimonial(
    id: string,
    patch: Partial<AdminTestimonial>,
    options?: RequestOptions,
  ): Promise<AdminTestimonial> {
    return apiFetchRaw<AdminTestimonial>(
      `/admin/content/testimonials/${id}`,
      { method: 'PATCH', body: JSON.stringify(patch) },
      options,
    )
  },

  async deleteTestimonial(id: string, options?: RequestOptions): Promise<void> {
    await apiFetchRaw(`/admin/content/testimonials/${id}`, { method: 'DELETE' }, options)
  },

  /* ----------------------------------------------------------- FAQs */
  async faqs(options?: RequestOptions): Promise<AdminFaq[]> {
    const body = await apiFetchRaw<any>('/admin/content/faqs', undefined, options)
    return items<AdminFaq>(body)
  },

  async faqCategories(options?: RequestOptions): Promise<string[]> {
    const body = await apiFetchRaw<any>('/admin/content/faq-categories', undefined, options)
    return Array.isArray(body) ? (body as string[]) : []
  },

  async createFaq(
    input: Omit<AdminFaq, 'id' | 'createdAt' | 'updatedAt'>,
    options?: RequestOptions,
  ): Promise<AdminFaq> {
    return apiFetchRaw<AdminFaq>('/admin/content/faqs', { method: 'POST', body: JSON.stringify(input) }, options)
  },

  async updateFaq(id: string, patch: Partial<AdminFaq>, options?: RequestOptions): Promise<AdminFaq> {
    return apiFetchRaw<AdminFaq>(
      `/admin/content/faqs/${id}`,
      { method: 'PATCH', body: JSON.stringify(patch) },
      options,
    )
  },

  async deleteFaq(id: string, options?: RequestOptions): Promise<void> {
    await apiFetchRaw(`/admin/content/faqs/${id}`, { method: 'DELETE' }, options)
  },

  /* -------------------------------------------------------- Reviews */
  async reviews(
    status: ReviewModerationStatus = 'pending',
    options?: RequestOptions,
  ): Promise<{ items: AdminReview[]; total: number }> {
    const body = await apiFetchRaw<any>(
      `/admin/content/reviews?status=${encodeURIComponent(status)}&limit=100`,
      undefined,
      options,
    )
    return { items: items<AdminReview>(body), total: Number(body?.total ?? items<AdminReview>(body).length) }
  },

  async moderateReview(
    id: string,
    input: { isApproved: boolean; isVerified?: boolean },
    options?: RequestOptions,
  ): Promise<AdminReview> {
    return apiFetchRaw<AdminReview>(
      `/admin/content/reviews/${id}`,
      { method: 'PATCH', body: JSON.stringify(input) },
      options,
    )
  },

  async deleteReview(id: string, options?: RequestOptions): Promise<void> {
    await apiFetchRaw(`/admin/content/reviews/${id}`, { method: 'DELETE' }, options)
  },

  /* ---------------------------------------------------- Subscribers */
  async subscribers(options?: RequestOptions): Promise<{ items: AdminSubscriber[]; total: number }> {
    const body = await apiFetchRaw<any>('/admin/content/newsletter?limit=100', undefined, options)
    return {
      items: items<AdminSubscriber>(body),
      total: Number(body?.total ?? items<AdminSubscriber>(body).length),
    }
  },

  async unsubscribeSubscriber(id: string, options?: RequestOptions): Promise<void> {
    await apiFetchRaw(`/admin/content/newsletter/${id}/unsubscribe`, { method: 'POST' }, options)
  },

  async deleteSubscriber(id: string, options?: RequestOptions): Promise<void> {
    await apiFetchRaw(`/admin/content/newsletter/${id}`, { method: 'DELETE' }, options)
  },
}