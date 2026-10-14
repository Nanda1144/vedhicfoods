import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { adminService } from '@/services/adminService'
import { useAsync } from '@/hooks'
import { formatDate, formatRelativeTime } from '@/utils/format'
import { AdminPageHeader, AdminToolbar, PaginationBar, TicketStatusBadge } from '@/components/admin'
import { Skeleton } from '@/components/common'

const PAGE_SIZE = 8

export function AdminSupportPage() {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [priority, setPriority] = useState('')
  const [page, setPage] = useState(1)

  const { data, loading, error } = useAsync(() => adminService.tickets(), [])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return (data ?? []).filter((ticket) => {
      if (query && !`${ticket.subject} ${ticket.ticketNumber} ${ticket.customerName} ${ticket.customerEmail}`.toLowerCase().includes(query))
        return false
      if (status && ticket.status !== status) return false
      if (priority && ticket.priority !== priority) return false
      return true
    })
  }, [data, search, status, priority])

  const openCount = (data ?? []).filter((ticket) => ticket.status === 'open' || ticket.status === 'in-progress').length
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  if (loading && !data) {
    return (
      <>
        <AdminPageHeader title="Customer support" description="Tickets raised from the storefront / contact pages." />
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} style={{ width: '100%', height: 64, marginBottom: 8 }} />
        ))}
      </>
    )
  }

  if (error) {
    return (
      <>
        <AdminPageHeader title="Customer support" description="Tickets raised from the storefront / contact pages." />
        <p className="admin-note admin-note--error">{error.message}</p>
      </>
    )
  }

  return (
    <>
      <AdminPageHeader
        title="Customer support"
        description={`${openCount} open ticket${openCount === 1 ? '' : 's'} · ${data!.filter((ticket) => ticket.priority === 'urgent' || ticket.priority === 'high').length} high/urgent`}
      />

      <AdminToolbar
        search={search}
        onSearch={(value) => {
          setSearch(value)
          setPage(1)
        }}
        searchPlaceholder="Search subject, ticket number or customer…"
        filters={[
          { label: 'Status', value: status, options: ['open', 'in-progress', 'resolved', 'closed'], onChange: setStatus },
          { label: 'Priority', value: priority, options: ['low', 'normal', 'high', 'urgent'], onChange: setPriority },
        ]}
      />

      <section className="admin-card">
        <ul className="ticket-list">
          {paged.map((ticket) => (
            <li key={ticket.id}>
              <Link to={`/admin/support/${ticket.id}`} className="ticket-row">
                <span className={`ticket-dot is-${ticket.priority}`} aria-hidden="true" />
                <span className="ticket-row__copy">
                  <span className="ticket-row__title">
                    <strong>{ticket.subject}</strong>
                    <TicketStatusBadge status={ticket.status} />
                  </span>
                  <span className="type-caption">
                    {ticket.ticketNumber} · {ticket.category} · {ticket.priority} priority
                  </span>
                  <span className="type-caption">
                    {ticket.customerName} ({ticket.customerEmail}) · last updated {formatRelativeTime(ticket.updatedAt)}
                  </span>
                </span>
                <span className="type-caption">{formatDate(ticket.createdAt)}</span>
              </Link>
            </li>
          ))}
        </ul>

        {filtered.length === 0 && (
          <div className="placeholder-page__inner">
            <h2>No tickets match.</h2>
            <p className="admin-muted">Adjust your search or filters.</p>
          </div>
        )}

        <div className="data-table__footer">
          <PaginationBar page={page} pageCount={pageCount} total={filtered.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
        </div>
      </section>
    </>
  )
}