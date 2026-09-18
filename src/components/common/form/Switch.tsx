import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/utils/cn'

export interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label: string
  description?: string
  size?: 'sm' | 'md'
}

export function Switch({
  checked,
  onCheckedChange,
  label,
  description,
  size = 'md',
  className,
  id,
  ...props
}: SwitchProps) {
  const switchId = id ?? label.toLowerCase().replace(/\s+/g, '-')
  return (
    <div className={cn('switch-row', className)}>
      <button
        type="button"
        role="switch"
        id={switchId}
        aria-checked={checked}
        className={cn('switch', `switch--${size}`, checked && 'is-on')}
        onClick={() => onCheckedChange(!checked)}
        {...props}
      >
        <span className="switch__track" aria-hidden="true">
          <span className="switch__thumb" />
        </span>
      </button>
      <label className="switch-row__copy" htmlFor={switchId}>
        <span className="switch-row__label">{label}</span>
        {description && <span className="switch-row__desc">{description}</span>}
      </label>
    </div>
  )
}