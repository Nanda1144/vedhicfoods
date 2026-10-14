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
  { label, error, hint, required, srLabel, className, id, ...props },
  ref,
) {
  const generatedId = useId()
  const inputId = id ?? generatedId

  const control = (
    <span className={cn('input input--textarea', error && 'is-invalid')}>
      <textarea
        ref={ref}
        id={inputId}
        className={cn('input__control', className)}
        aria-invalid={Boolean(error)}
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