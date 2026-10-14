import { Link, type LinkProps } from 'react-router-dom'
import { cn } from '@/utils/cn'
import { Icon } from './Icon'

export function SectionLink({ className, children, ...props }: LinkProps) {
  return (
    <Link {...props} className={cn('section-link', className)}>
      <span>{children}</span>
      <Icon name="arrow-right" size={16} />
    </Link>
  )
}