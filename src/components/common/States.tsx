import type { ReactNode } from 'react'
import { cn } from '@/utils/cn'
import { Spinner } from './Spinner'
import { Button, ButtonLink } from './Button'
import { Icon, type IconName } from './Icon'

interface StateProps {
  title: string
  description?: string
  action?: ReactNode
  className?: string
}

function StateShell({ title, description, action, className, children }: StateProps & { children: ReactNode }) {
  return (
    <div className={cn('state', className)}>
      <div className="state__visual">{children}</div>
      <h3 className="state__title">{title}</h3>
      {description && <p className="state__desc">{description}</p>}
      {action && <div className="state__action">{action}</div>}
    </div>
  )
}

export function LoadingState({
  title = 'Loading',
  description = 'Please wait a moment…',
  className,
}: StateProps) {
  return (
    <StateShell title={title} description={description} className={className}>
      <Spinner size={30} />
    </StateShell>
  )
}

export function EmptyState({
  title,
  description,
  action,
  icon = 'box',
  className,
}: StateProps & { icon?: IconName }) {
  return (
    <StateShell title={title} description={description} action={action} className={className}>
      <span className="state__icon">
        <Icon name={icon} size={30} />
      </span>
    </StateShell>
  )
}

export function ErrorState({
  title = 'Something went wrong',
  description = 'This could not be loaded right now. Please try again in a moment.',
  onRetry,
  action,
  className,
}: StateProps & { onRetry?: () => void }) {
  return (
    <StateShell
      title={title}
      description={description}
      className={className}
      action={
        action ?? (onRetry ? <Button variant="secondary" onClick={onRetry} icon="refresh">Try again</Button> : undefined)
      }
    >
      <span className="state__icon state__icon--danger">
        <Icon name="alert" size={30} />
      </span>
    </StateShell>
  )
}

interface EmptyShopStateProps extends StateProps {
  reset?: () => void
  href?: string
}

export function EmptyShopState({ title, reset, href = '/shop', className }: EmptyShopStateProps) {
  return (
    <StateShell
      title={title}
      className={className}
      action={
        <div className="cluster cluster-3" style={{ justifyContent: 'center' }}>
          {reset ? <Button variant="secondary" onClick={reset} icon="refresh">Clear filters</Button> : null}
          <ButtonLink to={href} variant="primary" iconRight="arrow-right">Browse everything</ButtonLink>
        </div>
      }
    >
      <span className="state__icon">
        <Icon name="search-x" size={30} />
      </span>
    </StateShell>
  )
}

export function NotFoundState({ onRetry }: { onRetry?: () => void }) {
  return (
    <StateShell
      title="We couldn't find that page"
      description="The page may have moved, or the link is no longer valid."
      className="state--page"
      action={
        <div className="cluster cluster-3">
          <ButtonLink to="/" variant="primary" iconRight="arrow-right">Back to home</ButtonLink>
          {onRetry ? (
            <Button variant="ghost" onClick={onRetry} icon="refresh">
              Try again
            </Button>
          ) : null}
        </div>
      }
    >
      <span className="state__icon">
        <Icon name="search-x" size={30} />
      </span>
    </StateShell>
  )
}