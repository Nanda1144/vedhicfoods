export type ID = string

export type Nullable<T> = T | null

export type StatusTone = 'neutral' | 'success' | 'danger' | 'warning' | 'info' | 'accent'

export interface Option<T extends string = string> {
  label: string
  value: T
  disabled?: boolean
}

export interface SelectOption<T extends string = string> extends Option<T> {
  description?: string
}

export interface Pagination {
  page: number
  perPage: number
  total: number
  totalPages: number
}

export interface Paginated<T> {
  items: T[]
  pagination: Pagination
}

export interface ApiError {
  code: string
  message: string
  field?: string
}

export interface NewsletterSubscription {
  email: string
  subscribedAt: string
}

export type SortDirection = 'asc' | 'desc'
