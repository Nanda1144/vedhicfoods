import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { cn } from '@/utils/cn'
import { Breadcrumb, type Crumb } from './Breadcrumb'
import { Icon } from './Icon'
import { IconButton } from './Button'

export function BackButton({ className }: { className?: string }) {
  const navigate = useNavigate()
  const location = useLocation()
  if (location.pathname === '/') return null
  return (
    <IconButton label="Go back" className={className} onClick={() => navigate(-1)}>
      <Icon name="arrow-left" size={18} />
    </IconButton>
  )
}

interface PageHeaderProps {
  eyebrow?: string
  title: ReactNode
  description?: ReactNode
  crumbs?: Crumb[]
  meta?: ReactNode
  align?: 'left' | 'center'
  className?: string
}

export function PageHeader({
  eyebrow,
  title,
  description,
  crumbs,
  meta,
  align = 'left',
  className,
}: PageHeaderProps) {
  return (
    <header className={cn('page-header', `page-header--${align}`, className)}>
      <div className="container">
        <BackButton className="page-header__back" />
        {crumbs && crumbs.length > 0 && <Breadcrumb items={crumbs} className="page-header__crumbs" />}
        {eyebrow && <p className="type-eyebrow page-header__eyebrow">{eyebrow}</p>}
        <h1 className="page-header__title">{title}</h1>
        {description && <p className="page-header__desc">{description}</p>}
        {meta && <div className="page-header__meta">{meta}</div>}
      </div>
    </header>
  )
}