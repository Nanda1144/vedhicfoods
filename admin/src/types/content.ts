import type { ID } from './common'

export interface AdminTestimonial {
  id: ID
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

export interface AdminFaq {
  id: ID
  question: string
  answer: string
  category: string
  sortOrder: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface AdminReview {
  id: ID
  productId: ID
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

export type ReviewModerationStatus = 'pending' | 'approved' | 'rejected' | 'all'

export interface AdminSubscriber {
  id: ID
  email: string
  name?: string | null
  source: string
  active: boolean
  unsubscribedAt?: string | null
  createdAt: string
}