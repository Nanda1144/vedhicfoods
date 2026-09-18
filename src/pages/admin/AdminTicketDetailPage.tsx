import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { adminService } from '@/services/adminService'
import { useAdminAuth } from '@/context/AdminAuthContext'
import { useAsync } from '@/hooks'
import { useToast } from '@/context'
import { formatDateTime, formatRelativeTime, initials } from '@/utils/format'
import { AdminPageHeader } from '@/components/admin'
import type { StaffMember, SupportTicket, TicketStatus } from '@/types'
import { Badge, Button, Skeleton, Icon } from '@/components/common'
import { Select, Textarea } from '@/components/common/form'
import { TicketStatusBadge } from '@/components/admin'

export function AdminTicketDetailPage() {
  const { id } = useParams()
  const { can } = useAdminAuth()
  const { push } = useToast()
  const [reply, setReply] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [busy, setBusy] = useState(false)

  const ticket = useAsync(() => adminService.tickets(), [])
  const staff = useAsync(() => adminService.staff(), [])

  const current: SupportTicket | undefined = (ticket.data ?? []).find((candidate) => candidate.id === id)

  if (ticket.loading && !ticket.data) {
    return (
      <>
        <AdminPageHeader title="Support ticket" description="Issue details and conversation." />
        <Skeleton style={{ width: '100%', height: 320 }} />
      </>
    )
  }

  if (ticket.error || !current) {
    return (
      <>
        <AdminPageHeader title="Support ticket" description="Issue details and conversation." />
        <p className="admin-note admin-note--error">{ticket.error?.message ?? 'Ticket not found.'}</p>
      </>
    )
  }

  const canWrite = can('support:write')

  const setStatus = async (status: TicketStatus) => {
    setBusy(true)
    try {
      await adminService.updateTicketStatus(current.id, status)
      push({ title: 'Ticket updated', description: `Ticket marked ${status.replace('-', ' ')}.` })
      await ticket.run()
    } finally {
      setBusy(false)
    }
  }

  const assign = async (memberId: string) => {
    const member: StaffMember | undefined = staff.data?.find((candidate) => candidate.id === memberId)
    setAssigneeId(memberId)
    await adminService.updateTicketAssignee(current.id, memberId, member?.name)
    push({ title: 'Ticket assigned', description: member ? `Now with ${member.name}.` : 'Unassigned.' })
    await ticket.run()
  }

  const sendReply = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!reply.trim()) return
    setBusy(true)
    try {
      await adminService.replyTicket(current.id, reply.trim())
      push({ title: 'Reply recorded', description: 'Customer would receive this via email in production.' })
      setReply('')
      await ticket.run()
    } finally {
      setBusy(false)
    }
  }

  const replies = current.replies ?? []

  return (
    <>
      <AdminPageHeader
        title={`${current.ticketNumber} — ${current.subject}`}
        description={`${current.category} · ${current.priority} priority`}
        actions={
          <>
            <Link to="/admin/support" className="link-button is-ghost">
              Back to inbox
            </Link>
            {canWrite && (
              <Select
                aria-label="Assign to staff member"
                value={assigneeId || current.assigneeId || ''}
                onChange={(event) => void assign(event.target.value)}
                className="ticket-assign"
                placeholder="Assignee…"
                options={(staff.data ?? []).map((member) => ({ value: member.id, label: member.name }))}
              />
            )}
          </>
        }
      />

      <div className="admin-detail">
        <div className="admin-detail__main">
          <section className="admin-card">
            <header className="admin-card__head">
              <h2>Conversation</h2>
              <span className="admin-card__hint">last updated {formatRelativeTime(current.updatedAt)}</span>
            </header>

            <div className="thread">
              <div className="thread__entry">
                <span className="admin-avatar-sm">{initials(current.customerName, 2)}</span>
                <div className="thread__bubble">
                  <strong>{current.customerName}</strong>
                  <span className="type-caption"> · {formatDateTime(current.createdAt)}</span>
                  <p>{current.message}</p>
                </div>
              </div>
              {replies.map((replyText) => (
                <div key={replyText.at} className="thread__entry is-internal">
                  <span className="admin-avatar-sm">AD</span>
                  <div className="thread__bubble">
                    <strong>{replyText.authorName}</strong>
                    <span className="type-caption"> · {formatDateTime(replyText.at)}</span>
                    <p>{replyText.content}</p>
                  </div>
                </div>
              ))}
            </div>

            {canWrite && (
              <form className="ticket-reply" onSubmit={sendReply}>
                <Textarea
                  rows={3}
                  placeholder="Type a reply for the customer…"
                  value={reply}
                  onChange={(event) => setReply(event.target.value)}
                />
                <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
                  <Button size="sm" variant="ghost" icon="check" onClick={() => void setStatus('resolved')}>
                    Resolve
                  </Button>
                  <Button size="sm" type="submit" icon="mail" loading={busy}>
                    Send reply
                  </Button>
                </div>
              </form>
            )}
          </section>
        </div>

        <aside className="admin-detail__side">
          <section className="admin-card">
            <header className="admin-card__head">
              <h2>Status</h2>
            </header>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <TicketStatusBadge status={current.status} />
              <Badge tone="accent">{current.priority} priority</Badge>
            </div>
            <div className="ticket-status-actions">
              <Button size="sm" variant="outline" onClick={() => void setStatus('open')} disabled={busy}>
                Open
              </Button>
              <Button size="sm" variant="outline" onClick={() => void setStatus('in-progress')} disabled={busy}>
                In progress
              </Button>
              <Button size="sm" variant="outline" onClick={() => void setStatus('resolved')} disabled={busy}>
                Resolved
              </Button>
              <Button size="sm" variant="outline" onClick={() => void setStatus('closed')} disabled={busy}>
                Close
              </Button>
            </div>
          </section>

          <section className="admin-card">
            <header className="admin-card__head">
              <h2>Customer</h2>
            </header>
            <p>
              <strong>{current.customerName}</strong>
              <span className="type-caption" style={{ display: 'block' }}>{current.customerEmail}</span>
            </p>
            <p className="admin-muted" style={{ marginBottom: 0 }}>
              <Icon name="clock" size={13} /> Opened {formatDateTime(current.createdAt)}
            </p>
          </section>
        </aside>
      </div>
    </>
  )
}