import { useId } from 'react'
import { cn } from '@/utils/cn'
import { Icon } from './Icon'

interface QuantitySelectorProps {
  value: number
  min?: number
  max?: number
  onChange: (value: number) => void
  size?: 'sm' | 'md'
  disabled?: boolean
  className?: string
  label?: string
}

export function QuantitySelector({
  value,
  min = 1,
  max = 99,
  onChange,
  size = 'md',
  disabled = false,
  className,
  label = 'Quantity',
}: QuantitySelectorProps) {
  const id = useId()

  const clamp = (next: number) => Math.max(min, Math.min(max, next))

  return (
    <div className={cn('qty', `qty--${size}`, disabled && 'is-disabled', className)}>
      <span className="visually-hidden" id={id}>
        {label}
      </span>
      <button
        type="button"
        className="qty__btn"
        onClick={() => onChange(clamp(value - 1))}
        disabled={disabled || value <= min}
        aria-label="Decrease quantity"
        aria-controls={id}
      >
        <Icon name="minus" size={16} />
      </button>
      <span className="qty__value" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        className="qty__btn"
        onClick={() => onChange(clamp(value + 1))}
        disabled={disabled || value >= max}
        aria-label="Increase quantity"
        aria-controls={id}
      >
        <Icon name="plus" size={16} />
      </button>
    </div>
  )
}