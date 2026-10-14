import type { HTMLAttributes } from 'react'
import { cn } from '@/utils/cn'
import { useReveal } from '@/hooks/useReveal'

interface RevealProps extends HTMLAttributes<HTMLElement> {
  /** entrance direction */
  variant?: 'up' | 'left' | 'right' | 'scale' | 'fade'
  delay?: number
  as?: 'div' | 'section' | 'li' | 'article' | 'figure'
}

export function Reveal({
  variant = 'up',
  delay = 0,
  as: Tag = 'div',
  className,
  children,
  ...props
}: RevealProps) {
  const { ref, visible } = useReveal<HTMLElement>({ variant, delay })
  return (
    <Tag
      ref={ref as never}
      className={cn('reveal', `reveal--${variant}`, visible && 'is-visible', className)}
      {...props}
    >
      {children}
    </Tag>
  )
}