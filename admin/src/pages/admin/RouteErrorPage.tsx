import { Button } from '@/components/common'
import { Logo } from '@/components/common'
import { Link, isRouteErrorResponse, useRouteError } from 'react-router-dom'

/**
 * Route-level error boundary (added after a render crash took down the whole
 * console).
 *
 * React Router's built-in fallback replaces the entire document with
 * "Unexpected Application Error!" and a stack trace, which means any error in
 * any page — a missing session field, a failed lazy chunk, a bad API payload —
 * left the operator with a blank page and no way back into the app. This keeps
 * the shell, reports the failure in context, and offers recovery.
 */
export function RouteErrorPage() {
  const error = useRouteError()

  let title = 'Something went wrong'
  let detail =
    'An unexpected error interrupted this screen. The rest of the console is still available.'
  let code: number | undefined

  if (isRouteErrorResponse(error)) {
    code = error.status
    detail =
      error.status === 404
        ? 'That admin screen does not exist.'
        : error.statusText || detail
    if (code === 403) title = 'Not permitted'
    else if (code === 404) title = 'Page not found'
  } else if (error instanceof Error) {
    detail = error.message || detail
  }

  return (
    <div className="admin-error" role="alert">
      <Logo />
      <h1 className="admin-error__title">
        {code ? `${code} — ` : ''}
        {title}
      </h1>
      <p className="admin-error__detail">{detail}</p>
      <div className="admin-error__actions">
        <Button variant="primary" onClick={() => window.location.reload()}>
          Reload console
        </Button>
        <Link to="/admin">
          <Button variant="ghost">Go to dashboard</Button>
        </Link>
      </div>
    </div>
  )
}