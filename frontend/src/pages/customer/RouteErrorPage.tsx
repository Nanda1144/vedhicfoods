import { isRouteErrorResponse, useRouteError } from 'react-router-dom'
import { ButtonLink, ErrorState, PageHeader } from '@/components/common'

/**
 * Route-level error boundary.
 *
 * Without an `errorElement` the whole storefront is replaced by React Router's
 * built-in "Unexpected Application Error!" screen (stack trace, no chrome, no
 * way back). This keeps the header/footer shell intact and gives the shopper a
 * route back to safety.
 */
export function RouteErrorPage() {
  const error = useRouteError()

  let eyebrow = 'Error'
  let title = 'Something went wrong'
  let detail = 'This page could not be displayed right now. Please try again in a moment.'

  if (isRouteErrorResponse(error)) {
    eyebrow = `Error ${error.status}`
    title = error.status === 404 ? 'Page not found' : error.statusText || title
    detail = error.status === 404 ? 'That page does not exist.' : detail
  } else if (error instanceof Error) {
    detail = error.message || detail
  }

  return (
    <>
      <PageHeader eyebrow={eyebrow} title={title} />
      <section className="section">
        <div className="container center">
          <ErrorState
            title={title}
            description={detail}
            action={
              <div className="cluster cluster-3" style={{ justifyContent: 'center' }}>
                <ButtonLink to="/" variant="primary" iconRight="arrow-right">
                  Back to home
                </ButtonLink>
              </div>
            }
          />
        </div>
      </section>
    </>
  )
}
