export type ValidationResult = { valid: true } | { valid: false; error: string }

const OK: ValidationResult = { valid: true }

export function required(value: unknown, label = 'This field'): ValidationResult {
  if (value === null || value === undefined) return { valid: false, error: `${label} is required.` }
  if (typeof value === 'string' && value.trim().length === 0) {
    return { valid: false, error: `${label} is required.` }
  }
  return OK
}

export function minLength(value: string, min: number, label = 'This field'): ValidationResult {
  if (value.trim().length < min) {
    return { valid: false, error: `${label} must be at least ${min} characters.` }
  }
  return OK
}

export function isEmail(value: string): ValidationResult {
  const pattern = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i
  return pattern.test(value.trim()) ? OK : { valid: false, error: 'Enter a valid email address.' }
}

export function isPhoneIN(value: string): ValidationResult {
  const digits = value.replace(/\D/g, '')
  if (digits.length < 10) return { valid: false, error: 'Enter a valid 10-digit mobile number.' }
  return OK
}

export function isPincode(value: string): ValidationResult {
  return /^[1-9][0-9]{5}$/.test(value.trim())
    ? OK
    : { valid: false, error: 'Enter a valid 6-digit PIN code.' }
}

export function isPositiveNumber(value: number, label = 'Value'): ValidationResult {
  return Number.isFinite(value) && value > 0
    ? OK
    : { valid: false, error: `${label} must be greater than zero.` }
}

export function isFutureDate(value: string): ValidationResult {
  const date = new Date(value)
  return !Number.isNaN(date.getTime()) && date.getTime() > Date.now()
    ? OK
    : { valid: false, error: 'Choose a date in the future.' }
}

/** Runs validators in order, returning the first failure. */
export function validate(...results: ValidationResult[]): ValidationResult {
  for (const result of results) {
    if (!result.valid) return result
  }
  return OK
}

export function passwordStrength(value: string): { score: 0 | 1 | 2 | 3 | 4; label: string } {
  let score = 0
  if (value.length >= 8) score += 1
  if (/[A-Z]/.test(value) && /[a-z]/.test(value)) score += 1
  if (/[0-9]/.test(value)) score += 1
  if (/[^A-Za-z0-9]/.test(value)) score += 1
  const clamped = Math.min(score, 4) as 0 | 1 | 2 | 3 | 4
  const labels = ['Too weak', 'Weak', 'Fair', 'Strong', 'Excellent']
  return { score: clamped, label: labels[clamped] ?? 'Too weak' }
}
