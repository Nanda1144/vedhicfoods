import { useId, type ReactNode } from 'react'
import { cn } from '@/utils/cn'

interface FieldProps {
  label: string
  htmlFor?: string
  error?: string
  hint?: ReactNode
  required?: boolean
  children: ReactNode
  className?: string
  /** visually accessible but hidden? */
  srOnly?: boolean
}

export function Field({ label, htmlFor, error, hint, required, children, className, srOnly }: FieldProps) {
  const fallbackId = useId()
  const forId = htmlFor ?? fallbackId
  const describedBy = error || hint ? `${forId}-help` : undefined

  return (
    <div className={cn('field', error && 'field--error', className)}>
      <label className={cn('field__label', srOnly && 'visually-hidden')} htmlFor={forId}>
        {label}
        {required && <span className="field__required" aria-hidden="true"> *</span>}
      </label>
      {children}
      {(error || hint) && (
        <div className={cn('field__help', error && 'field__help--error')} id={describedBy}>
          {error ?? hint}
        </div>
      )}
    </div>
  )
}