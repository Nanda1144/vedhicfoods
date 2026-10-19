import { forwardRef, useId, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/utils/cn'
import { Field } from './Field'

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
  hint?: string
  required?: boolean
  srLabel?: boolean
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, error, hint, required, srLabel, className, id, 'aria-invalid': ariaInvalid, 'aria-describedby': ariaDescribedBy, ...props },
  ref,
) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const helpId = error || hint ? `${inputId}-help` : undefined
  const describedBy = [ariaDescribedBy, helpId].filter(Boolean).join(' ') || undefined

  const control = (
    <span className={cn('input input--textarea', error && 'is-invalid')}>
      <textarea
        ref={ref}
        id={inputId}
        className={cn('input__control', className)}
        required={required}
        aria-required={required || undefined}
        aria-invalid={ariaInvalid ?? Boolean(error)}
        aria-describedby={describedBy}
        {...props}
      />
    </span>
  )

  if (!label) return control

  return (
    <Field label={label} htmlFor={inputId} error={error} hint={hint} required={required} srOnly={srLabel}>
      {control}
    </Field>
  )
})
