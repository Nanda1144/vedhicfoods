import { useRef } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { cn } from '@/utils/cn'
import { PRIMARY_NAV } from '@/data/navigation'
import { useAsync, useEscapeKey, useFocusFirst, useFocusTrap, useLockBodyScroll } from '@/hooks'
import { useSettings } from '@/context'
import { productService } from '@/services/productService'
import { Icon, Logo, IconButton } from '../common'
import type { IconName } from '../common'

interface MobileNavProps {
  open: boolean
  onClose: () => void
}

const PLATFORM_ICON: Partial<Record<string, IconName>> = {
  instagram: 'instagram',
  facebook: 'facebook',
  youtube: 'youtube',
}

export function MobileNav({ open, onClose }: MobileNavProps) {
  const { settings } = useSettings()
  const panelRef = useRef<HTMLElement>(null)

  useLockBodyScroll(open)
  useEscapeKey(onClose, open)
  useFocusFirst(panelRef, open)
  useFocusTrap(panelRef, open)
  const categories = useAsync(() => productService.categories(), [])

  if (!open) return null

  return (
    <div className="mobile-nav" role="presentation">
      <div className="mobile-nav__scrim" aria-hidden="true" onMouseDown={onClose} />
      <aside ref={panelRef} className="mobile-nav__panel" role="dialog" aria-modal="true" aria-label="Menu">
        <div className="mobile-nav__head">
          <Logo size="sm" to="/" />
          <IconButton label="Close menu" onClick={onClose}>
            <Icon name="close" size={20} />
          </IconButton>
        </div>
        <nav className="mobile-nav__nav" aria-label="Mobile">
          <ul className="mobile-nav__list">
            {PRIMARY_NAV.map((link) => (
              <li key={link.href}>
                <NavLink
                  to={link.href}
                  end={link.href === '/'}
                  className={({ isActive }) => cn('mobile-nav__link', isActive && 'is-active')}
                  onClick={onClose}
                >
                  {link.label}
                  <Icon name="arrow-up-right" size={16} />
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="mobile-nav__login">
          <NavLink to="/admin/login" className="mobile-nav__login-link" onClick={onClose}>
            <Icon name="user" size={18} />
            Admin &amp; Staff Login
          </NavLink>
        </div>
        <div className="mobile-nav__categories">
          <p className="type-label">Shop by category</p>
          <ul>
            {categories.data?.slice(0, 6).map((category) => (
              <li key={category.slug}>
                <Link to={`/shop?category=${category.slug}`} onClick={onClose}>
                  {category.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <footer className="mobile-nav__foot">
          <p className="type-caption">{settings.supportPhone} · {settings.supportEmail}</p>
          <div className="cluster cluster-2">
            {settings.socials.map((social) => (
              <a key={social.platform} href={social.href} className="icon-btn" aria-label={social.label} target={social.href.startsWith('http') ? '_blank' : undefined} rel="noreferrer">
                <Icon name={PLATFORM_ICON[social.platform] ?? 'external'} size={18} />
              </a>
            ))}
          </div>
        </footer>
      </aside>
    </div>
  )
}