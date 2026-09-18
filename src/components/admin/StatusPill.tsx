import { Badge, type BadgeProps } from '../common'

export type StatusLike = string

const STATUS_TONES: Record<string, BadgeProps['tone']> = {
  // orders
  pending: 'warning',
  confirmed: 'info',
  packed: 'info',
  shipped: 'info',
  'out-for-delivery': 'info',
  delivered: 'success',
  cancelled: 'neutral',
  returned: 'secondary',
  // payments
  processing: 'warning',
  paid: 'success',
  failed: 'danger',
  refunded: 'warning',
  // invoices
  draft: 'neutral',
  issued: 'info',
  void: 'secondary',
  // inventory stock
  in: 'success',
  low: 'warning',
  out: 'danger',
  // discount
  active: 'success',
  scheduled: 'warning',
  expired: 'neutral',
  disabled: 'secondary',
  // staff
  invited: 'warning',
  suspended: 'danger',
  deactivated: 'neutral',
  // support tickets
  open: 'info',
  'in-progress': 'warning',
  resolved: 'success',
  archived: 'neutral',
  closed: 'neutral',
  rejected: 'danger',
  // priority
  medium: 'info',
  high: 'warning',
  urgent: 'danger',
  // misc
  success: 'success',
  error: 'danger',
  info: 'info',
  review: 'warning',
}

function toTitle(value: string): string {
  return value
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

interface StatusPillProps {
  status: StatusLike
  label?: string
  dot?: boolean
}

export function StatusPill({ status, label, dot = true }: StatusPillProps) {
  return (
    <Badge tone={STATUS_TONES[status] ?? 'neutral'} dot={dot}>
      {label ?? toTitle(status)}
    </Badge>
  )
}