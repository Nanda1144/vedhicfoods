/**
 * Canonical company / brand identity used across outbound email and generated
 * invoice PDFs. Declared once so the two surfaces never drift apart.
 *
 * NOTE: the admin-editable equivalents live in the `settings` table
 * (`business_name`, `gst_number`, `brand_name`, …). Wiring the invoice and
 * email generators to those DB values is the long-term fix; until then this is
 * the single source of truth for statically-rendered documents.
 */
export interface Branding {
  brandName: string
  tagline: string
  supportEmail: string
  supportPhone: string
  website: string
  address: string
  gstin: string
  fssaiLicense: string
}

export const BRANDING: Branding = {
  brandName: 'Vedhic Foods',
  tagline: 'Pure Farm-Fresh Millets & Heritage Organic Laddus',
  supportEmail: 'care@vedhicfoods.com',
  supportPhone: '+91 98765 43210',
  website: 'https://vedhicfoods.com',
  address: 'Bengaluru, Karnataka - 560038',
  gstin: '29AABCU9603R1ZM',
  fssaiLicense: '11224333000123',
}
