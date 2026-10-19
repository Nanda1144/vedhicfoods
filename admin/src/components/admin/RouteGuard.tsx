import { Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAdminAuth } from '@/context/AdminAuthContext'
import { ADMIN_NAV } from '@/data/adminNavigation'
import type { Permission } from '@/types'
import { Icon } from '../common'

/** First console route the signed-in account is actually allowed to open. */
function firstAccessibleHref(can: (permission: Permission) => boolean): string | null {
  for (const section of ADMIN_NAV) {
    for (const item of section.items) {
      if (!item.permission || can(item.permission)) return item.href
    }
  }
  return null
}

/**
 * Route-level protection.
 *
 * Frontend guarding is UX only — the production backend MUST re-check every
 * permission on every API call and return 403 for unauthorized requests.
 */
export function RequireAdmin({ permission, children }: { permission?: Permission; children: ReactNode }) {
  const { session, can, sessionExpired } = useAdminAuth()
  const location = useLocation()

  if (!session) {
    return <Navigate to="/admin/login" replace state={{ from: location.pathname, expired: sessionExpired }} />
  }
  if (permission && !can(permission)) {
    const target = firstAccessibleHref(can) ?? '/admin/login'
    return (
      <div className="admin-forbidden">
        <span className="admin-forbidden__icon">
          <Icon name="shield" size={26} />
        </span>
        <h1>403 — Access denied</h1>
        <p>
          Your role does not include access to this module. If you need it, ask the owner to grant the
          permission — an audit trail is recorded for every attempt.
        </p>
        <a className="link-button" href={target}>
          Go to an available page
        </a>
      </div>
    )
  }
  return <>{children}</>
}

/**
 * The console index. Dashboard/revenue analytics require `reports.read`, which
 * the STAFF role does not hold — rather than render the dashboard shell and let
 * every API call answer 403, accounts without it are sent straight to the first
 * module their role can open.
 */
export function AdminHome({ children }: { children: ReactNode }) {
  const { session, can, sessionExpired } = useAdminAuth()
  const location = useLocation()

  if (!session) {
    return <Navigate to="/admin/login" replace state={{ from: location.pathname, expired: sessionExpired }} />
  }
  if (can('reports.read')) return <>{children}</>

  return <Navigate to={firstAccessibleHref(can) ?? '/admin/login'} replace />
}
