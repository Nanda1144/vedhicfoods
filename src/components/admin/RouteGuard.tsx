import { Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAdminAuth } from '@/context/AdminAuthContext'
import type { Permission } from '@/types'
import { Icon } from '../common'

/**
 * Route-level protection.
 *
 * Frontend guarding is UX only — the production backend MUST re-check every
 * permission on every API call and return 403 for unauthorized requests.
 */
export function RequireAdmin({ permission, children }: { permission?: Permission; children: ReactNode }) {
  const { session, can } = useAdminAuth()
  const location = useLocation()

  if (!session) {
    return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />
  }
  if (permission && !can(permission)) {
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
        <a className="link-button" href="/admin">
          Back to dashboard
        </a>
      </div>
    )
  }
  return <>{children}</>
}