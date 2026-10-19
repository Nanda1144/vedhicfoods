import type { HTMLAttributes } from 'react'
import { cn } from '@/utils/cn'

type BadgeTone = 'primary' | 'secondary' | 'accent' | 'success' | 'warning' | 'danger' | 'neutral' | 'info'

const TONE_CLASS: Record<BadgeTone, string> = {
  primary: 'badge--primary',
  secondary: 'badge--secondary',
  accent: 'badge--accent',
  success: 'badge--success',
  warning: 'badge--warning',
  danger: 'badge--danger',
  neutral: 'badge--neutral',
  info: 'badge--info',
}

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone
  /** Renders a small status dot for tone-aware "live" badges. */
  dot?: boolean
  size?: 'sm' | 'md'
}

export function Badge({ tone = 'primary', dot = false, size = 'sm', className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn('badge', TONE_CLASS[tone], `badge--${size}`, dot && 'badge--dot', className)}
      {...props}
    >
      {dot && <span className="badge__dot" aria-hidden />}
      {children}
    </span>
  )
}