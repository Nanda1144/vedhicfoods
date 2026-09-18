import type { ReactNode } from 'react'
import { cn } from '@/utils/cn'
import { Icon, type IconName } from './Icon'

interface SectionHeaderProps {
  eyebrow?: string
  title: ReactNode
  description?: ReactNode
  align?: 'left' | 'center'
  action?: ReactNode
  className?: string
  icon?: IconName
}

export function SectionHeader({
  eyebrow,
  title,
  description,
  align = 'left',
  action,
  className,
  icon,
}: SectionHeaderProps) {
  return (
    <div className={cn('section-header', `section-header--${align}`, className)}>
      <div className="section-header__copy">
        {eyebrow && (
          <p className="type-eyebrow section-header__eyebrow">
            {icon && <Icon name={icon} size={15} />}
            {eyebrow}
          </p>
        )}
        <h2 className="section-header__title">{title}</h2>
        {description && <p className="section-header__desc">{description}</p>}
      </div>
      {action && <div className="section-header__action">{action}</div>}
    </div>
  )
}