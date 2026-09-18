import { Link } from 'react-router-dom'
import { cn } from '@/utils/cn'
import { Icon } from './Icon'

interface LogoProps {
  size?: 'sm' | 'md' | 'lg'
  tone?: 'light' | 'dark'
  to?: string
  className?: string
}

const MARK_SIZES = { sm: 30, md: 36, lg: 44 } as const
const WORD_SIZES = { sm: 'logo__word--sm', md: '', lg: 'logo__word--lg' } as const

export function Logo({ size = 'md', tone = 'dark', to = '/', className }: LogoProps) {
  const markSize = MARK_SIZES[size]
  const root = cn('logo', `logo--${tone}`, className)

  return (
    <Link to={to} className={root} aria-label="Vedhi Foods — Home">
      <span className="logo__mark">
        <Icon name="leaf" size={markSize * 0.52} strokeWidth={1.5} />
      </span>
      <span className={cn('logo__text', WORD_SIZES[size])}>
        <span className="logo__brand">Vedhi</span>
        <span className="logo__tag">Foods · Organic &amp; Traditional</span>
      </span>
    </Link>
  )
}