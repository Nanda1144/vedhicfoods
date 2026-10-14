import { z } from 'zod'
import { TicketPriority, TicketStatus, TicketSource } from '@prisma/client'

// ==========================================
// SHARED PRIMITIVES
// ==========================================

/**
 * Indian mobile number. Accepts the common human formats a customer might type
 * ("9876543210", "+91 98765 43210", "098765-43210") and normalises to 10 digits.
 */
const INDIAN_MOBILE_REGEX = /^(?:\+?91[\s-]?)?([6-9]\d{9})$/

export const phoneSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s-]/g, ''))
  .refine((value) => INDIAN_MOBILE_REGEX.test(value), {
    message: 'Phone must be a valid 10-digit Indian mobile number (may start with +91).',
  })
  .transform((value) => {
    const digits = value.replace(/^\+?91/, '')
    return digits
  })

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(5, 'Email is required.')
  .max(254, 'Email must be at most 254 characters.')
  .email('A valid email address is required.')

const nameSchema = z
  .string()
  .trim()
  .min(2, 'Name must be at least 2 characters.')
  .max(120, 'Name must be at most 120 characters.')
  // Reject script/HTML injection attempts in a field rendered back to staff
  .refine((value) => !/[<>]/.test(value), {
    message: 'Name must not contain angle brackets.',
  })

const messageSchema = z
  .string()
  .trim()
  .min(10, 'Message must be at least 10 characters.')
  .max(5000, 'Message must be at most 5000 characters.')

// ==========================================
// CONTACT FORM
// ==========================================

/**
 * Categories where a phone number is mandatory. An order or delivery enquiry
 * cannot be actioned without a reachable number, so the field is enforced
 * instead of merely recommended.
 */
export const PHONE_REQUIRED_CONTACT_CATEGORIES = [
  'ORDER_ENQUIRY',
  'DELIVERY_ISSUE',
  'RETURN_REFUND',
] as const

export const CONTACT_CATEGORIES = [
  'GENERAL',
  'PRODUCT_QUESTION',
  'ORDER_ENQUIRY',
  'DELIVERY_ISSUE',
  'RETURN_REFUND',
  'WHOLESALE',
  'FEEDBACK',
  'COMPLAINT',
] as const

export type ContactCategory = (typeof CONTACT_CATEGORIES)[number]

export const contactSubmissionSchema = z
  .object({
    name: nameSchema,
    email: emailSchema,
    // Optional at the schema level, conditionally required in the superRefine below
    phone: z.union([phoneSchema, z.literal(''), z.null()]).optional(),
    subject: z
      .string()
      .trim()
      .min(5, 'Subject must be at least 5 characters.')
      .max(200, 'Subject must be at most 200 characters.'),
    category: z.enum(CONTACT_CATEGORIES).default('GENERAL'),
    message: messageSchema,
    /**
     * Honeypot. Hidden from humans via CSS/attribute tricks; any value proves an
     * automated client.
     *
     * Deliberately *permissive* at the schema layer: rejecting a non-empty value
     * with a 400 would hand the bot a precise "you were caught" signal and let it
     * tune the field out of its payload. The value is instead carried through to
     * the spam scorer, which quarantines the submission, and the controller
     * answers with an indistinguishable success response.
     */
    website: z.string().max(200).optional(),
  })
  .superRefine((data, ctx) => {
    const categoryRequiresPhone = (PHONE_REQUIRED_CONTACT_CATEGORIES as readonly string[]).includes(
      data.category
    )
    const hasPhone = typeof data.phone === 'string' && data.phone.length > 0

    if (categoryRequiresPhone && !hasPhone) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['phone'],
        message: `A phone number is required for ${data.category.replace(/_/g, ' ').toLowerCase()} enquiries.`,
      })
    }
  })

export type ContactSubmissionDTO = z.infer<typeof contactSubmissionSchema>

// ==========================================
// SUPPORT TICKETS (CUSTOMER)
// ==========================================

export const TICKET_CATEGORIES = [
  'GENERAL',
  'ORDER_ENQUIRY',
  'DELIVERY_ISSUE',
  'RETURN_REFUND',
  'PAYMENT_ISSUE',
  'PRODUCT_QUALITY',
  'WHOLESALE',
] as const

export const createTicketSchema = z.object({
  subject: z
    .string()
    .trim()
    .min(5, 'Subject must be at least 5 characters.')
    .max(200, 'Subject must be at most 200 characters.'),
  description: messageSchema,
  category: z.enum(TICKET_CATEGORIES).default('GENERAL'),
  priority: z.nativeEnum(TicketPriority).default(TicketPriority.MEDIUM),
  /**
   * Optional related order. Verified server-side to belong to the caller
   * before it is attached, so customers cannot reference someone else's order.
   */
  orderId: z.string().trim().uuid('orderId must be a valid identifier.').optional(),
  /** Honeypot, same semantics as the contact form. See `website` above. */
  website: z.string().max(200).optional(),
})

export type CreateTicketDTO = z.infer<typeof createTicketSchema>

export const ticketReplySchema = z.object({
  message: messageSchema,
  /** Honeypot, same semantics as the contact form. See `website` above. */
  website: z.string().max(200).optional(),
})

export type TicketReplyDTO = z.infer<typeof ticketReplySchema>

export const closeTicketSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(3, 'A closure reason of at least 3 characters is required.')
    .max(500, 'Closure reason must be at most 500 characters.'),
})

export type CloseTicketDTO = z.infer<typeof closeTicketSchema>

// ==========================================
// SUPPORT TICKETS (STAFF)
// ==========================================

/**
 * Legal ticket state transitions. Enforced server-side so a ticket can never be
 * moved into an incoherent state (e.g. CLOSED -> WAITING_FOR_CUSTOMER).
 */
export const TICKET_STATUS_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  [TicketStatus.OPEN]: [
    TicketStatus.IN_PROGRESS,
    TicketStatus.WAITING_FOR_CUSTOMER,
    TicketStatus.RESOLVED,
    TicketStatus.CLOSED,
  ],
  [TicketStatus.IN_PROGRESS]: [
    TicketStatus.WAITING_FOR_CUSTOMER,
    TicketStatus.RESOLVED,
    TicketStatus.CLOSED,
  ],
  [TicketStatus.WAITING_FOR_CUSTOMER]: [
    TicketStatus.IN_PROGRESS,
    TicketStatus.RESOLVED,
    TicketStatus.CLOSED,
  ],
  [TicketStatus.RESOLVED]: [
    TicketStatus.CLOSED,
    TicketStatus.IN_PROGRESS,
    TicketStatus.OPEN,
  ],
  [TicketStatus.CLOSED]: [TicketStatus.OPEN],
}

export const staffStatusUpdateSchema = z
  .object({
    status: z.nativeEnum(TicketStatus),
    resolution: z.string().trim().max(2000, 'Resolution must be at most 2000 characters.').optional(),
    closeReason: z.string().trim().max(500, 'Close reason must be at most 500 characters.').optional(),
    priority: z.nativeEnum(TicketPriority).optional(),
    internalNote: z.string().trim().max(2000, 'Internal note must be at most 2000 characters.').optional(),
    /**
     * Present only for audited admin status changes. When the actor is not a
     * customer the change is written to the audit trail regardless.
     */
    reason: z.string().trim().max(500, 'Reason must be at most 500 characters.').optional(),
  })
  .superRefine((data, ctx) => {
    if (data.status === TicketStatus.RESOLVED && !data.resolution) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['resolution'],
        message: 'A resolution summary is required when marking a ticket RESOLVED.',
      })
    }
    if (data.status === TicketStatus.CLOSED && !data.closeReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['closeReason'],
        message: 'A close reason is required when closing a ticket.',
      })
    }
  })

export type StaffStatusUpdateDTO = z.infer<typeof staffStatusUpdateSchema>

export const assignTicketSchema = z.object({
  assignedStaffId: z
    .string()
    .trim()
    .uuid('assignedStaffId must be a valid identifier.')
    .nullable()
    .optional(),
})

export type AssignTicketDTO = z.infer<typeof assignTicketSchema>

// ==========================================
// LIST / FILTER QUERIES
// ==========================================

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
})

export const listCustomerTicketsQuerySchema = paginationSchema.extend({
  status: z.nativeEnum(TicketStatus).optional(),
  /** Free-text search over subject and ticket number. */
  search: z.string().trim().max(120).optional(),
})

export type ListCustomerTicketsQuery = z.infer<typeof listCustomerTicketsQuerySchema>

export const listStaffTicketsQuerySchema = paginationSchema.extend({
  status: z.nativeEnum(TicketStatus).optional(),
  priority: z.nativeEnum(TicketPriority).optional(),
  source: z.nativeEnum(TicketSource).optional(),
  assignedStaffId: z.string().trim().uuid().optional(),
  /** Shorthand for "tickets assigned to me". */
  assignedToMe: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  search: z.string().trim().max(120).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
})

export type ListStaffTicketsQuery = z.infer<typeof listStaffTicketsQuerySchema>

export const listContactSubmissionsQuerySchema = paginationSchema.extend({
  status: z.enum(['NEW', 'TRIAGED', 'SPAM', 'ARCHIVED']).optional(),
  includeSpam: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .default('false'),
  search: z.string().trim().max(120).optional(),
})

export type ListContactSubmissionsQuery = z.infer<typeof listContactSubmissionsQuerySchema>

export const triageContactSchema = z.object({
  status: z.enum(['TRIAGED', 'ARCHIVED']),
  internalNotes: z.string().trim().max(2000).optional(),
  /**
   * Escalate the inquiry into a SupportTicket owned by the submitting customer.
   * Requires the submitter to already have a registered account.
   */
  escalateToTicket: z.boolean().default(false),
  ticketId: z.string().trim().uuid().optional(),
})

export type TriageContactDTO = z.infer<typeof triageContactSchema>

// ==========================================
// RESPONSE SHAPES
// ==========================================

export interface SupportMessageResponse {
  id: string
  ticketId: string
  senderId: string
  senderName?: string
  senderRole?: string
  message: string
  isStaff: boolean
  createdAt: string
}

export interface SupportTicketResponse {
  id: string
  ticketNumber: string
  userId: string
  customerName?: string
  customerEmail?: string
  assignedStaffId: string | null
  assignedStaffName?: string | null
  subject: string
  description: string
  status: TicketStatus
  priority: TicketPriority
  source: TicketSource
  category: string | null
  resolution: string | null
  resolvedAt: string | null
  closedAt: string | null
  closeReason: string | null
  firstResponseAt: string | null
  lastMessageAt: string
  reopenedCount: number
  createdAt: string
  updatedAt: string
  messageCount: number
  messages?: SupportMessageResponse[]
}

export interface ContactSubmissionResponse {
  id: string
  reference: string
  name: string
  email: string
  phone: string | null
  subject: string
  category: string | null
  message: string
  status: string
  spamScore: number
  spamReasons: string[]
  isSpam: boolean
  userId: string | null
  ticketId: string | null
  submittedAt: string
  triagedAt: string | null
  internalNotes?: string | null
}