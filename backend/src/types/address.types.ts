import { z } from 'zod'
import { AddressType } from '@prisma/client'

// Indian phone number regex: 10 digits starting with 6-9, or international format
const phoneRegex = /^(?:(?:\+|0{0,2})91(\s*[-]\s*)?|[0]?)?[6789]\d{9}$/
// Indian PIN code regex: 6 digits, first digit non-zero
const pincodeRegex = /^[1-9][0-9]{5}$/

export const createAddressSchema = z.object({
  label: z.string().trim().min(1, 'Label is required').max(50).default('Home'),
  type: z.nativeEnum(AddressType).default(AddressType.HOME),
  fullName: z.string().trim().min(2, 'Full name must be at least 2 characters').max(100, 'Full name cannot exceed 100 characters'),
  phone: z.string().trim().refine(
    (val) => phoneRegex.test(val.replace(/\s+/g, '')),
    { message: 'Please provide a valid 10-digit Indian phone number (e.g. 9876543210)' }
  ),
  line1: z.string().trim().min(3, 'Address line 1 must be at least 3 characters').max(200, 'Address line 1 cannot exceed 200 characters'),
  line2: z.string().trim().max(200).optional().nullable(),
  landmark: z.string().trim().max(100).optional().nullable(),
  city: z.string().trim().min(2, 'City is required').max(100),
  state: z.string().trim().min(2, 'State is required').max(100),
  pincode: z.string().trim().refine(
    (val) => pincodeRegex.test(val),
    { message: 'Please enter a valid 6-digit Indian postal code (e.g. 500001)' }
  ),
  country: z.string().trim().max(100).default('India'),
  isDefault: z.boolean().default(false),
})

export const updateAddressSchema = z.object({
  label: z.string().trim().min(1).max(50).optional(),
  type: z.nativeEnum(AddressType).optional(),
  fullName: z.string().trim().min(2).max(100).optional(),
  phone: z.string().trim().refine(
    (val) => phoneRegex.test(val.replace(/\s+/g, '')),
    { message: 'Please provide a valid 10-digit Indian phone number' }
  ).optional(),
  line1: z.string().trim().min(3).max(200).optional(),
  line2: z.string().trim().max(200).optional().nullable(),
  landmark: z.string().trim().max(100).optional().nullable(),
  city: z.string().trim().min(2).max(100).optional(),
  state: z.string().trim().min(2).max(100).optional(),
  pincode: z.string().trim().refine(
    (val) => pincodeRegex.test(val),
    { message: 'Please enter a valid 6-digit Indian postal code' }
  ).optional(),
  country: z.string().trim().max(100).optional(),
  isDefault: z.boolean().optional(),
})

export type CreateAddressDTO = z.infer<typeof createAddressSchema>
export type UpdateAddressDTO = z.infer<typeof updateAddressSchema>

export interface AddressResponse {
  id: string
  userId: string
  label: string
  type: AddressType
  fullName: string
  phone: string
  line1: string
  line2: string | null
  landmark: string | null
  city: string
  state: string
  pincode: string
  country: string
  isDefault: boolean
  createdAt: string
  updatedAt: string
}
