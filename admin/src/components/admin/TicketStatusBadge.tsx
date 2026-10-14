export function TicketStatusBadge({ status }: { status: string }) {
  const label = status.replace('-', ' ')
  const tone =
    status === 'resolved' ? 'is-success' : status === 'in-progress' ? 'is-warning' : status === 'closed' ? '' : 'is-info'
  return <span className={`ticket-status-badge ${tone}`}>{label}</span>
}