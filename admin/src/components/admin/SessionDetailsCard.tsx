import { Badge } from '../common'
import { useAdminAuth } from '@/context/AdminAuthContext'
import { permissionLabel } from '@/data/admin'

/**
 * Read-only summary of who is signed in, for the operations dashboard.
 *
 * SECURITY — what is deliberately absent: `session.token`, `session.refreshToken`
 * and the raw `session.id` are all reachable from the object this component
 * receives, and none of them are rendered here. An operations panel is a screen
 * people screenshot into tickets and Slack threads, so anything on it will end up
 * copied somewhere with a longer retention than the session it came from. A token
 * in a screenshot is a live bearer credential, and pasting one into a support
 * channel hands over the session itself, since the backend does not bind tokens to
 * an IP or user-agent. Only human-readable identity and authorization metadata
 * belongs on this panel; the staff ID is likewise omitted because it is an
 * internal database identifier with no diagnostic value for the person reading it.
 *
 * The permission list is the useful half: when an operator cannot find a button,
 * this is the fastest way to tell "wrong role" apart from "route bug".
 */

function formatSignedInAt(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'unknown'

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

/** Compact "how long has this session been open", derived from `signedInAt`. */
function sessionAge(iso: string): string {
  const started = new Date(iso).getTime()
  if (Number.isNaN(started)) return 'unknown'

  const seconds = Math.max(0, Math.floor((Date.now() - started) / 1000))
  if (seconds < 60) return `${seconds}s`

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`

  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

export function SessionDetailsCard() {
  const { session } = useAdminAuth()

  if (!session) return null

  const permissions = session.permissions ?? []

  return (
    <article className="admin-card admin-card--wide">
      <header className="admin-card__head">
        <h2>Signed in as</h2>
        <Badge tone="info" dot>
          {session.role}
        </Badge>
      </header>

      <dl className="m-kv">
        <div className="m-kv__row">
          <dt>Name</dt>
          <dd>{session.name}</dd>
        </div>
        <div className="m-kv__row">
          <dt>Email</dt>
          <dd>{session.email}</dd>
        </div>
        <div className="m-kv__row">
          <dt>Job title</dt>
          <dd>{session.title || '—'}</dd>
        </div>
        <div className="m-kv__row">
          <dt>Signed in</dt>
          <dd>
            {formatSignedInAt(session.signedInAt)}
            <span className="type-caption"> · {sessionAge(session.signedInAt)} ago</span>
          </dd>
        </div>
        <div className="m-kv__row">
          <dt>Session</dt>
          <dd>
            <Badge tone={session.remember ? 'success' : 'neutral'}>
              {session.remember ? 'Remembered' : 'This browser only'}
            </Badge>
          </dd>
        </div>
        <div className="m-kv__row">
          <dt>Granted permissions</dt>
          <dd>{permissions.length}</dd>
        </div>
      </dl>

      {permissions.length > 0 && (
        <details className="m-permissions">
          <summary className="admin-card__hint">View permission list</summary>
          <ul className="m-permissions__list">
            {permissions.map((permission) => (
              <li key={permission}>
                <Badge tone="neutral">{permissionLabel(permission)}</Badge>
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  )
}