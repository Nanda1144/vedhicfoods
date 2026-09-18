import { forwardRef, useId, type InputHTMLAttributes } from 'react'
import { cn } from '@/utils/cn'
import { Field } from './Field'
import { Icon, type IconName } from '../Icon'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
  prefix?: string
  icon?: IconName
  required?: boolean
  srLabel?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    error,
    hint,
    prefix,
    icon,
    required,
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
  const inputId = id ?? generatedId

  const control = (
    <span className={cn('input', icon && 'input--icon', prefix !== undefined && 'input--prefix', error && 'is-invalid', className)}>
      {icon && <Icon name={icon} size={17} className="input__icon" />}
      {prefix !== undefined && <span className="input__prefix">{prefix}</span>}
      <input
        ref={ref}
        id={inputId}
        className="input__control"
        aria-invalid={ariaInvalid ?? Boolean(error)}
        aria-describedby={ariaDescribedBy ?? (error || hint ? `${inputId}-help` : undefined)}
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