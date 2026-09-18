import type { InputHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/utils/cn'

export interface RadioProps extends InputHTMLAttributes<HTMLInputElement> {
  label: ReactNode
  description?: string
  /** Extra content rendered when this radio is selected. */
  supporting?: ReactNode
}

export function Radio({ label, description, supporting, className, ...inputProps }: RadioProps) {
  const checked = inputProps.checked ?? inputProps['aria-checked']
  return (
    <label className={cn('radio', checked && 'is-selected', className)}>
      <span className="radio__mark">
        <input type="radio" {...inputProps} className="radio__input" />
        <span className="radio__dot" aria-hidden="true" />
      </span>
      <span className="radio__copy">
        <span className="radio__label">{label}</span>
        {description && <span className="radio__desc">{description}</span>}
        {checked && supporting}
      </span>
    </label>
  )
}