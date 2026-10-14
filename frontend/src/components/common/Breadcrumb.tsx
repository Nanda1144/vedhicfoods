import { Fragment } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '@/utils/cn'
import { Icon, type IconName } from './Icon'

export interface Crumb {
  label: string
  href?: string
  icon?: IconName
  /** Marks the final breadcrumb as the current page. */
  current?: boolean
}

interface BreadcrumbProps {
  items: Crumb[]
  className?: string
  /** Replaces the "Home" root with a custom entry. */
  homeLabel?: string
  homeHref?: string
}

export function Breadcrumb({
  items,
  className,
  homeLabel = 'Home',
  homeHref = '/',
}: BreadcrumbProps) {
  // Callers commonly pass their own leading "Home" crumb; only prepend the
  // synthetic one when they have not, otherwise the list contains two `Home`
  // entries with identical keys (React warns, and the link renders twice).
  const firstIsHome =
    items.length > 0 && (items[0].href === homeHref || items[0].label === homeLabel)

  const all: Crumb[] = firstIsHome
    ? [{ ...items[0], icon: items[0].icon ?? 'home' }, ...items.slice(1)]
    : [{ label: homeLabel, href: homeHref, icon: 'home' as IconName }, ...items]

  return (
    <nav className={cn('breadcrumb', className)} aria-label="Breadcrumb">
      <ol>
        {all.map((item, index) => {
          const isLast = index === all.length - 1
          return (
            <Fragment key={`${item.label}-${index}`}>
              <li className="breadcrumb__item">
                {isLast ? (
                  <span className="breadcrumb__current" aria-current="page">
                    {item.label}
                  </span>
                ) : (
                  <Link className="breadcrumb__link" to={item.href ?? '#'}>
                    {item.icon && <Icon name={item.icon} size={14} />}
                    {item.label}
                  </Link>
                )}
              </li>
              {!isLast && (
                <li className="breadcrumb__sep" aria-hidden="true">
                  <Icon name="chevron-right" size={14} />
                </li>
              )}
            </Fragment>
          )
        })}
      </ol>
    </nav>
  )
}