import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { adminService } from '@/services/adminService'
import { useAsync } from '@/hooks'
import { useToast } from '@/context'
import { formatCurrency, formatDate } from '@/utils/format'
import { AdminPageHeader, DataTable, StatusPill, AdminToolbar, PaginationBar } from '@/components/admin'
import type { Column } from '@/components/admin'
import type { Invoice } from '@/types'
import { Badge, Button, Skeleton } from '@/components/common'

const PAGE_SIZE = 10

export function AdminInvoicesPage() {
  const { push } = useToast()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)

  const { data, loading, error } = useAsync(() => adminService.invoices(), [])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return (data ?? []).filter((invoice) => {
      if (query && !`${invoice.invoiceNumber} ${invoice.orderNumber} ${invoice.customerName}`.toLowerCase().includes(query)) return false
      if (status && invoice.status !== status) return false
      return true
    })
  }, [data, search, status])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const totals = useMemo(() => {
    const issued = data ?? []
    return {
      outstanding: issued.filter((invoice) => invoice.status === 'issued').reduce((sum, invoice) => sum + invoice.total, 0),
      paid: issued.filter((invoice) => invoice.status === 'paid').reduce((sum, invoice) => sum + invoice.total, 0),
    }
  }, [data])

  const columns: Array<Column<Invoice>> = [
    {
      key: 'invoice',
      header: 'Invoice',
      sortValue: (invoice) => invoice.invoiceNumber,
      render: (invoice) => (
        <span>
          <strong>{invoice.invoiceNumber}</strong>
          <span className="type-caption" style={{ display: 'block' }}>Order {invoice.orderNumber}</span>
        </span>
      ),
    },
    { key: 'customer', header: 'Customer', render: (invoice) => (
      <span>
        <strong>{invoice.customerName}</strong>
        <span className="type-caption" style={{ display: 'block' }}>{invoice.customerEmail}</span>
      </span>
    ) },
    { key: 'issued', header: 'Issued', render: (invoice) => <span className="type-caption">{formatDate(invoice.issuedAt)}</span> },
    { key: 'gstin', header: 'GSTIN', render: (invoice) => <span className="type-caption">{invoice.gstin ?? '—'}</span> },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      sortValue: (invoice) => invoice.total,
      render: (invoice) => <strong>{formatCurrency(invoice.total)}</strong>,
    },
    { key: 'status', header: 'Status', render: (invoice) => <StatusPill status={invoice.status} /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (invoice) => (
        <span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
          <Link to={`/invoice/${invoice.id}`} target="_blank" className="button button--sm button--ghost">
            <span>View</span>
          </Link>
          <Button
            size="sm"
            variant="ghost"
            icon="download"
            aria-label={`Download ${invoice.invoiceNumber}`}
            onClick={() => push({ title: 'Invoice queued', description: `PDF for ${invoice.invoiceNumber} is being generated.` })}
          />
        </span>
      ),
    },
  ]

  if (loading && !data) {
    return (
      <>
        <AdminPageHeader title="Invoices" description="GST-compliant invoices for every order." />
        <section className="admin-card">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} style={{ width: '100%', height: 44, marginBottom: 8 }} />
          ))}
        </section>
      </>
    )
  }

  if (error) {
    return (
      <>
        <AdminPageHeader title="Invoices" description="GST-compliant invoices for every order." />
        <p className="admin-note admin-note--error">{error.message}</p>
      </>
    )
  }

  return (
    <>
      <AdminPageHeader
        title="Invoices"
        description="GST-compliant invoices, generated at checkout."
        actions={
          <>
            <Badge tone="warning" dot>Outstanding {formatCurrency(totals.outstanding)}</Badge>
            <Badge tone="success" dot>Collected {formatCurrency(totals.paid)}</Badge>
          </>
        }
      />

      <AdminToolbar
        search={search}
        onSearch={(value) => {
          setSearch(value)
          setPage(1)
        }}
        searchPlaceholder="Search invoice, order or customer…"
        filters={[{ label: 'Status', value: status, options: ['draft', 'issued', 'paid', 'cancelled'], onChange: setStatus }]}
      />

      <section className="admin-card">
        <DataTable
          columns={columns}
          rows={paged}
          rowKey={(invoice) => invoice.id}
          caption="Invoices"
          footer={<PaginationBar page={page} pageCount={pageCount} total={filtered.length} pageSize={PAGE_SIZE} onPageChange={setPage} />}
        />
      </section>
    </>
  )
}