import type { ReactNode } from 'react'
import { cn } from '@/utils/cn'
import { Button, type IconName } from '../common'

interface AdminPageHeaderProps {
  title: string
  description?: string
  actions?: ReactNode
  className?: string
}

export function AdminPageHeader({ title, description, actions, className }: AdminPageHeaderProps) {
  return (
    <header className={cn('admin-page-header', className)}>
      <div className="admin-page-header__copy">
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="admin-page-header__actions">{actions}</div>}
    </header>
  )
}

export function AdminPrimaryAction({ icon = 'plus', children, onClick }: { icon?: IconName; children: ReactNode; onClick?: () => void }) {
  return (
    <Button size="sm" icon={icon} onClick={onClick}>
      {children}
    </Button>
  )
}