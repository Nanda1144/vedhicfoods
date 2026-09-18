import { CONTACT_TOPICS, FAQS, REVIEWS, SUPPORT_CATEGORIES, TESTIMONIALS } from '@/data/content'
import type { FaqItem, Review, Testimonial } from '@/types'
import { mockRequest, type RequestOptions } from './http'

export const contentService = {
  async testimonials(options?: RequestOptions): Promise<Testimonial[]> {
    return mockRequest(() => TESTIMONIALS, options)
  },

  async faqs(options?: RequestOptions): Promise<FaqItem[]> {
    return mockRequest(() => FAQS, options)
  },

  async supportCategories(options?: RequestOptions) {
    return mockRequest(() => [...SUPPORT_CATEGORIES], options)
  },

  async contactTopics(options?: RequestOptions) {
    return mockRequest(() => [...CONTACT_TOPICS], options)
  },

  async reviewsFor(productId: string, options?: RequestOptions): Promise<Review[]> {
    return mockRequest(() => REVIEWS.filter((r) => r.productId === productId), {
      delay: 200,
      ...options,
    })
  },
}

export interface ContactInput {
  name: string
  email: string
  phone: string
  topic: string
  message: string
}

export const contactService = {
  async submit(_input: ContactInput, options?: RequestOptions): Promise<{ ticketId: string }> {
    return mockRequest(
      () => ({ ticketId: `VF-${Math.floor(100000 + Math.random() * 899999)}` }),
      { delay: 800, ...options },
    )
  },
}

export interface NewsletterResult {
  ok: true
  email: string
}

export const newsletterService = {
  async subscribe(email: string, options?: RequestOptions): Promise<NewsletterResult> {
    return mockRequest(() => ({ ok: true as const, email }), { delay: 640, ...options })
  },
}
