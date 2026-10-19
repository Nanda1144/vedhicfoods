import { forwardRef, useId, type SelectHTMLAttributes } from 'react'
import { cn } from '@/utils/cn'
import { Field } from './Field'
import { Icon } from '../Icon'
import type { Option } from '@/types'

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
  hint?: string
  required?: boolean
  options: Array<Option<string>>
  placeholder?: string
  srLabel?: boolean
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    label,
    error,
    hint,
    required,
    options,
    placeholder,
    srLabel,
    className,
    id,
    'aria-invalid': ariaInvalid,
    'aria-describedby': ariaDescribedBy,
    ...props
  },
  ref,
) {
  const generatedId = useId()
  const selectId = id ?? generatedId
  const helpId = error || hint ? `${selectId}-help` : undefined
  const describedBy = [ariaDescribedBy, helpId].filter(Boolean).join(' ') || undefined

  const control = (
    <span className={cn('select', error && 'is-invalid', className)}>
      <select
        ref={ref}
        id={selectId}
        className={cn('select__control', placeholder !== undefined && 'has-placeholder')}
        required={required}
        aria-required={required || undefined}
        aria-invalid={ariaInvalid ?? Boolean(error)}
        aria-describedby={describedBy}
        {...props}
      >
        {placeholder !== undefined && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <Icon name="chevron-down" size={18} className="select__chevron" />
    </span>
  )

  if (!label) return control

  return (
    <Field label={label} htmlFor={selectId} error={error} hint={hint} required={required} srOnly={srLabel}>
      {control}
    </Field>
  )
})
