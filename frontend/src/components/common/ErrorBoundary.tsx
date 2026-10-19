import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button, ButtonLink } from './Button'
import { ErrorState } from './States'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * Top-level render boundary for the storefront.
 *
 * Route errors are handled by the router's `errorElement`, but failures thrown
 * while mounting the providers themselves (settings/auth/cart) sit *outside*
 * the router and would otherwise blank the page. This catches those and renders
 * a recoverable fallback.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface the failure for ops; no user data is included.
    console.error('Storefront crashed:', error, info.componentStack)
  }

  override render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="section">
        <div className="container center">
          <ErrorState
            title="Something went wrong"
            description={error.message || 'The storefront hit an unexpected error. Please try again.'}
            action={
              <div className="cluster cluster-3" style={{ justifyContent: 'center' }}>
                <Button variant="primary" onClick={() => window.location.reload()} icon="refresh">
                  Reload page
                </Button>
                <ButtonLink to="/" variant="ghost">
                  Back to home
                </ButtonLink>
              </div>
            }
          />
        </div>
      </div>
    )
  }
}
