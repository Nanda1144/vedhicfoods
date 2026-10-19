import { useMemo, useRef, useState } from 'react'
import { NavLink, Outlet, useNavigate, useLocation, Navigate } from 'react-router-dom'
import { cn } from '@/utils/cn'
import { ADMIN_NAV } from '@/data/adminNavigation'
import { Logo, Icon, IconButton, Badge, Spinner } from '../common'
import type { IconName } from '../common'
import { useSettings, useToast } from '@/context'
import { useRealtime } from '@/hooks'
import type { RealtimeEvent } from '@/services/realtimeService'
import { publishRealtime } from '@/services/realtimeBus'
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

/**
 * Realtime toast guards. A burst of identical events (a retried webhook, or two
 * channels describing one status change) must not stack duplicate toasts, and a
 * genuine flood of orders must not bury the screen: at most `TOAST_LIMIT` realtime
 * toasts are shown per `TOAST_WINDOW_MS`. Refreshes are unaffected — they are
 * coalesced separately by `useRealtimeEvents`.
 */
const TOAST_WINDOW_MS = 4_000
const TOAST_LIMIT = 4

function AdminShell() {
  const navigate = useNavigate()
  const location = useLocation()
  const { settings } = useSettings()
  const { push } = useToast()
  const { session, can, logout, loading, sessionExpired } = useAdminAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const recentToasts = useRef<Map<string, number>>(new Map())

  // Live updates: new orders and customer notifications surface as toasts
  // without a manual refresh, and every event is republished so the mounted page
  // (orders list, dashboard) can refetch. Self-triggered order updates are
  // suppressed from the toast side (the payload carries the actor id) so staff do
  // not get toasted for their own clicks — but they are still published, since a
  // page that is open should still reconcile.
  const realtimeStatus = useRealtime(session?.token ?? null, (event: RealtimeEvent) => {
    publishRealtime(event)

    const now = Date.now()
    for (const [key, at] of recentToasts.current) {
      if (now - at > TOAST_WINDOW_MS) recentToasts.current.delete(key)
    }

    const announce = (key: string, draft: Parameters<typeof push>[0]) => {
      if (recentToasts.current.has(key)) return
      if (recentToasts.current.size >= TOAST_LIMIT) return
      recentToasts.current.set(key, now)
      push(draft)
    }

    if (event.channel === 'order.created') {
      const data = event.data as { orderNumber?: string } | null
      announce(`created:${data?.orderNumber ?? ''}`, {
        title: 'New order received',
        description: data?.orderNumber ?? 'A new order was placed.',
      })
    } else if (event.channel === 'order.updated') {
      const data = event.data as { orderNumber?: string; status?: string; actorId?: string } | null
      if (data?.actorId && data.actorId === session?.id) return
      announce(`updated:${data?.orderNumber ?? ''}:${data?.status ?? ''}`, {
        title: 'Order updated',
        description: data?.orderNumber ? `${data.orderNumber} → ${data.status}` : 'An order status changed.',
      })
    } else if (event.channel === 'notification.created') {
      const data = event.data as { id?: string; title?: string } | null
      announce(`notification:${data?.id ?? data?.title ?? ''}`, {
        title: data?.title ?? 'New notification',
      })
    }
  })

  const visibleNav = useMemo(
    () =>
      ADMIN_NAV.map((section) => ({
        ...section,
        items: section.items.filter((item) => !item.permission || can(item.permission)),
      })).filter((section) => section.items.length > 0),
    [can],
  )

  const currentTitle = useMemo(() => {
    const match = visibleNav
      .flatMap((section) => section.items)
      .find((item) => location.pathname.startsWith(item.href.split('#')[0]))
    if (match) {
      if (location.hash?.includes('logo')) return 'Logo'
      if (location.hash?.includes('theme')) return 'Theme'
      return match.label
    }
    return 'Console'
  }, [visibleNav, location.pathname, location.hash])

  const bottomLinks = BOTTOM_LINKS.filter((link) =>
    visibleNav.some((section) =>
      section.items.some((item) => {
        const href = item.href.split('#')[0]
        return link.end ? href === link.href : href.startsWith(link.href)
      }),
    ),
  )

  // Render the console as soon as a persisted session exists rather than blocking
  // the whole UI on the `/admin/auth/me` round trip. The mounted page's own data
  // calls then run in parallel with that validation instead of strictly after it,
  // which roughly halves the time to first content on a high-latency API link.
  //
  // Authorization is unchanged: frontend guarding is UX only, every protected
  // request re-checks the token server-side, and a rejected session clears state
  // and redirects through the same `onExpired` path — so no privileged *data* is
  // ever rendered for a credential the API refuses. The spinner is kept for the
  // one window where a session is expected but not yet readable.
  if (loading && !session) {
    return (
      <div className="admin-boot" role="status" aria-live="polite">
        <Spinner />
        <p className="admin-boot__text">Restoring your session…</p>
      </div>
    )
  }

  if (!session) {
    return <Navigate to="/admin/login" replace state={{ from: location.pathname, expired: sessionExpired }} />
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
          <div className="row admin__topbar-actions" style={{ gap: 12 }}>
            {realtimeStatus !== 'idle' && (
              <Badge tone={realtimeStatus === 'open' ? 'success' : realtimeStatus === 'error' ? 'danger' : 'neutral'} dot>
                {realtimeStatus === 'open' ? 'Live' : realtimeStatus === 'error' ? 'Reconnecting' : 'Connecting'}
              </Badge>
            )}
            {session.role === 'owner' && (
              <Badge tone="accent" dot>
                Owner
              </Badge>
            )}
            <div className="admin__avatar" aria-hidden="true">
              {initials(session.name, 2)}
            </div>
            <div className="admin__who">
              <p className="admin__who-name">{session.name || session.email}</p>
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