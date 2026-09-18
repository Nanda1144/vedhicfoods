import { useMemo, useState } from 'react'
import { adminService } from '@/services/adminService'
import { useAsync } from '@/hooks'
import { formatDateTime } from '@/utils/format'
import { AdminPageHeader, DataTable, StatusPill, AdminToolbar, PaginationBar } from '@/components/admin'
import type { Column } from '@/components/admin'
import type { AuditLog } from '@/types'
import { Skeleton, Icon } from '@/components/common'

const PAGE_SIZE = 12
const ACTIONS = ['create', 'update', 'delete', 'login', 'logout', 'export', 'settings'] as const

export function AdminAuditLogsPage() {
  const [search, setSearch] = useState('')
  const [action, setAction] = useState('')
  const [entity, setEntity] = useState('')
  const [page, setPage] = useState(1)

  const { data, loading, error } = useAsync(() => adminService.auditLogs(), [])

  const entities = useMemo(
    () => [...new Set((data ?? []).map((log) => log.entity))].sort(),
    [data],
  )

  const filtered = (data ?? []).filter((log) => {
    const query = search.trim().toLowerCase()
    if (query && !`${log.actor} ${log.summary} ${log.entity} ${log.entityId ?? ''}`.toLowerCase().includes(query)) return false
    if (action && log.action !== action) return false
    if (entity && log.entity !== entity) return false
    return true
  })

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const columns: Array<Column<AuditLog>> = [
    {
      key: 'time',
      header: 'When',
      render: (log) => (
        <span>
          {formatDateTime(log.createdAt)}
          <span className="type-caption" style={{ display: 'block' }}>{log.ipAddress}</span>
        </span>
      ),
    },
    { key: 'actor', header: 'Actor', render: (log) => <strong>{log.actor}</strong> },
    { key: 'action', header: 'Action', render: (log) => <StatusPill status={actionTone(log.action)} label={log.action} /> },
    {
      key: 'entity',
      header: 'Entity',
      render: (log) => (
        <span>
          {log.entity}
          {log.entityId && <code className="audit-code">{log.entityId}</code>}
        </span>
      ),
    },
    { key: 'summary', header: 'Details', render: (log) => <span className="type-caption">{log.summary}</span> },
  ]

  return (
    <>
      <AdminPageHeader
        title="Audit logs"
        description={`${data?.length ?? 0} logged actions. Immutable trail of who did what, when.`}
      />

      <AdminToolbar
        search={search}
        onSearch={(value) => {
          setSearch(value)
          setPage(1)
        }}
        searchPlaceholder="Search actor, entity or detail…"
        filters={[
          { label: 'Action', value: action, options: [...ACTIONS], onChange: setAction },
          { label: 'Entity', value: entity, options: entities, onChange: setEntity },
        ]}
      >
        {data && (
          <span className="row" style={{ gap: 8 }}>
            <Icon name="download" size={15} />
            <span className="type-caption">Export CSV</span>
          </span>
        )}
      </AdminToolbar>

      <section className="admin-card">
        {loading && !data ? (
          Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} style={{ width: '100%', height: 44, marginBottom: 8 }} />
          ))
        ) : error ? (
          <p className="admin-note admin-note--error">{error.message}</p>
        ) : (
          <DataTable
            columns={columns}
            rows={paged}
            rowKey={(log) => log.id}
            caption="Administration audit trail"
            footer={
              <div className="pagination-bar">
                <PaginationBar page={page} pageCount={pageCount} total={filtered.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
              </div>
            }
          />
        )}
      </section>
    </>
  )
}

function actionTone(action: string): string {
  if (action === 'delete') return 'danger'
  if (action === 'create') return 'success'
  if (action === 'update' || action === 'settings') return 'info'
  return 'neutral'
}