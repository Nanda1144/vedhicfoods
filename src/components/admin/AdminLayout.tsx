import { useMemo, useState } from 'react'
import { NavLink, Outlet, useNavigate, useLocation, Navigate } from 'react-router-dom'
import { cn } from '@/utils/cn'
import { ADMIN_NAV } from '@/data/adminNavigation'
import { Logo, Icon, IconButton, Badge } from '../common'
import type { IconName } from '../common'
import { useSettings } from '@/context'
import { initials } from '@/utils/format'
import { AdminAuthProvider, useAdminAuth } from '@/context/AdminAuthContext'

function NavSection({ section, onNavigate }: { section: (typeof ADMIN_NAV)[number]; onNavigate: () => void }) {
  return (
    <div className="admin__section">
      <p className="admin__section-title">{section.title}</p>
      <ul className="admin__section-list">
        {section.items.map((item) => (
          <li key={item.href}>
            <NavLink
              to={item.href}
              end={item.end}
              className={({ isActive }) => cn('admin__nav-item', isActive && 'is-active')}
              onClick={onNavigate}
            >
              <Icon name={item.icon} size={17} />
              <span>{item.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  )
}

const BOTTOM_LINKS: { href: string; icon: IconName; label: string; end?: boolean }[] = [
  { href: '/admin', icon: 'home', label: 'Home', end: true },
  { href: '/admin/products', icon: 'box', label: 'Products' },
  { href: '/admin/orders', icon: 'cart', label: 'Orders' },
  { href: '/admin/discounts', icon: 'tag', label: 'Deals' },
  { href: '/admin/settings', icon: 'sliders', label: 'Settings' },
]

function AdminShell() {
  const navigate = useNavigate()
  const location = useLocation()
  const { settings } = useSettings()
  const { session, can, logout } = useAdminAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const visibleNav = useMemo(
    () =>
      ADMIN_NAV.map((section) => ({
        ...section,
        items: section.items.filter((item) => !item.permission || can(item.permission)),
      })).filter((section) => section.items.length > 0 || section.title === 'Dashboard'),
    [can],
  )

  const currentTitle = useMemo(() => {
    const match = visibleNav
      .flatMap((section) => section.items)
      .find((item) => location.pathname.startsWith(item.href.split('#')[0]))
    if (match) {
      if (location.hash.includes('logo')) return 'Logo'
      if (location.hash.includes('theme')) return 'Theme'
      return match.label
    }
    return 'Console'
  }, [visibleNav, location.pathname, location.hash])

  const bottomLinks = BOTTOM_LINKS.filter((link) =>
    visibleNav.some((section) => section.items.some((item) => item.href.split('#')[0].startsWith(link.href))),
  )

  if (!session) {
    return <Navigate to="/admin/login" replace />
  }

  const signOut = () => {
    logout()
    navigate('/admin/login')
  }

  const closeSidebar = () => setSidebarOpen(false)

  return (
    <div className="admin">
      <div
        className={cn('admin__scrim', sidebarOpen && 'is-open')}
        onClick={closeSidebar}
        aria-hidden="true"
      />

      <aside className={cn('admin__sidebar', sidebarOpen && 'is-open')}>
        <div className="admin__sidebar-head">
          <Logo size="sm" to="/admin" tone="light" />
        </div>
        <nav className="admin__nav" aria-label="Admin navigation">
          {visibleNav.map((section) => (
            <NavSection key={section.title} section={section} onNavigate={closeSidebar} />
          ))}
        </nav>
        <div className="admin__sidebar-foot">
          <a className="admin__nav-item" href="/" target="_blank" rel="noreferrer">
            <Icon name="store" size={17} />
            <span>View storefront</span>
          </a>
        </div>
      </aside>

      <div className="admin__main">
        <header className="admin__topbar">
          <div className="row" style={{ gap: 12 }}>
            <IconButton label="Toggle sidebar" className="admin__menu-btn" onClick={() => setSidebarOpen((open) => !open)}>
              <Icon name="menu" size={20} />
            </IconButton>
            <div>
              <p className="admin__crumb">{currentTitle}</p>
              <p className="admin__brandline">{settings.brandName} · Admin</p>
            </div>
          </div>
          <div className="row" style={{ gap: 12 }}>
            {session.isOwner && (
              <Badge tone="accent" dot>
                Owner
              </Badge>
            )}
            <div className="admin__avatar" aria-hidden="true">
              {initials(session.name, 2)}
            </div>
            <div className="admin__who">
              <p className="admin__who-name">{session.name}</p>
              <p className="admin__who-role">{session.title}</p>
            </div>
            <button type="button" className="icon-btn" aria-label="Sign out" onClick={signOut}>
              <Icon name="logout" size={19} />
            </button>
          </div>
        </header>

        <main className="admin__content">
          <Outlet />
        </main>
      </div>

      <nav className="bottom-nav" aria-label="Admin mobile navigation">
        <ul className="bottom-nav__list">
          {bottomLinks.map((link) => (
            <li key={link.href}>
              <NavLink
                to={link.href}
                end={link.end}
                className={({ isActive }) => cn('bottom-nav__item', isActive && 'is-active')}
              >
                <span className="bottom-nav__icon">
                  <Icon name={link.icon} size={20} />
                </span>
                <span>{link.label}</span>
              </NavLink>
            </li>
          ))}
          <li>
            <button
              type="button"
              className="bottom-nav__item"
              aria-label="Open admin menu"
              onClick={() => setSidebarOpen(true)}
            >
              <span className="bottom-nav__icon">
                <Icon name="menu" size={20} />
              </span>
              <span>Menu</span>
            </button>
          </li>
        </ul>
      </nav>
    </div>
  )
}

/**
 * Wraps the whole admin area so every `/admin/*` page can read the reactive
 * session (permission changes made by the owner reflect immediately).
 */
export function AdminLayout() {
  return (
    <AdminAuthProvider>
      <AdminShell />
    </AdminAuthProvider>
  )
}