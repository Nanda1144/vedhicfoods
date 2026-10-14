import type { InputHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/utils/cn'
import { Icon } from '../Icon'

export interface CheckboxProps extends InputHTMLAttributes<HTMLInputElement> {
  label: ReactNode
  description?: string
  error?: string
  srLabel?: boolean
}

export function Checkbox({ label, description, error, srLabel, className, ...inputProps }: CheckboxProps) {
  return (
    <label className={cn('check', error && 'is-invalid', className)}>
      <span className="check__box">
        <input type="checkbox" {...inputProps} className="check__input" />
        <span className="check__mark" aria-hidden="true">
          <Icon name="check" size={12} />
        </span>
      </span>
      <span className="check__copy">
        <span className={cn('check__label', srLabel && 'visually-hidden')}>{label}</span>
        {description && <span className="check__desc">{description}</span>}
        {error && <span className="check__error">{error}</span>}
      </span>
    </label>
  )
}