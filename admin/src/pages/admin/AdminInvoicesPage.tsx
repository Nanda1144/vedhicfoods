import { useMemo, useState } from 'react'
import { adminService } from '@/services/adminService'
import { invoiceService } from '@/services/invoiceService'
import { useAsync } from '@/hooks'
import { useToast } from '@/context'
import { formatCurrency, formatDate } from '@/utils/format'
import { AdminPageHeader, DataTable, StatusPill, AdminToolbar, PaginationBar } from '@/components/admin'
import type { Column } from '@/components/admin'
import type { Invoice, OrderLineItem } from '@/types'
import { Badge, Button, Icon, Modal, Skeleton } from '@/components/common'
import { Input } from '@/components/common/form'

const PAGE_SIZE = 10

/** Business day in IST, matching the backend's daily-invoice grouping. */
function todayInBusinessTimezone(): string {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)
}

export function AdminInvoicesPage() {
  const { push } = useToast()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [downloadedIds, setDownloadedIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('vedhic:downloaded-invoices')
      return new Set(raw ? (JSON.parse(raw) as string[]) : [])
    } catch {
      return new Set()
    }
  })
  const [page, setPage] = useState(1)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [detail, setDetail] = useState<Invoice | null>(null)
  const [deliveryDate, setDeliveryDate] = useState(todayInBusinessTimezone)
  const [downloadingAll, setDownloadingAll] = useState(false)

  const { data, loading, error } = useAsync(() => adminService.invoices(), [])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    const from = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : null
    const to = toDate ? new Date(`${toDate}T23:59:59.999`).getTime() : null
    return (data ?? []).filter((invoice) => {
      if (query && !`${invoice.invoiceNumber} ${invoice.orderNumber} ${invoice.customerName}`.toLowerCase().includes(query)) return false
      if (status && invoice.status !== status) return false
      const issued = new Date(invoice.issuedAt).getTime()
      if (from !== null && Number.isFinite(issued) && issued < from) return false
      if (to !== null && Number.isFinite(issued) && issued > to) return false
      return true
    })
  }, [data, search, status, fromDate, toDate])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const totals = useMemo(() => {
    const issued = data ?? []
    return {
      outstanding: issued.filter((invoice) => invoice.status === 'issued').reduce((sum, invoice) => sum + invoice.total, 0),
      paid: issued.filter((invoice) => invoice.status === 'paid').reduce((sum, invoice) => sum + invoice.total, 0),
    }
  }, [data])

  /**
   * Opens or downloads a PDF blob without ever navigating to the storage
   * origin. The bytes are streamed from the API with the admin's credentials.
   */
  const openPdfBlob = (blob: Blob, filename: string, download: boolean) => {
    const url = URL.createObjectURL(blob)
    if (download) {
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      link.remove()
    } else {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
    // Give the new tab/download a moment to consume the blob before releasing it.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  const handleDownload = async (invoice: Invoice) => {
    if (downloadedIds.has(invoice.id)) {
      push({ title: 'Already downloaded', description: `${invoice.invoiceNumber} has already been downloaded.` })
      return
    }

    try {
      const blob = await invoiceService.fetchPdf(invoice.id)
      setDownloadedIds((prev) => {
        const next = new Set(prev)
        next.add(invoice.id)
        try {
          localStorage.setItem('vedhic:downloaded-invoices', JSON.stringify([...next]))
        } catch {
          // ignore storage errors
        }
        return next
      })
      openPdfBlob(blob, `${invoice.invoiceNumber}.pdf`, true)
      push({ title: 'Download started', description: `Opening ${invoice.invoiceNumber}.` })
    } catch (caught) {
      push({
        title: 'Could not download invoice',
        description: caught instanceof Error ? caught.message : 'Please try again in a moment.',
        tone: 'danger',
      })
    }
  }

  /** Opens the generated PDF from the API — no external storage navigation. */
  const handleView = async (invoice: Invoice) => {
    try {
      const blob = await invoiceService.fetchPdf(invoice.id)
      openPdfBlob(blob, `${invoice.invoiceNumber}.pdf`, false)
    } catch (caught) {
      push({
        title: 'Could not open invoice',
        description: caught instanceof Error ? caught.message : 'Please try again in a moment.',
        tone: 'danger',
      })
    }
  }

  /** One PDF for the whole delivery run: every invoice for the chosen day. */
  const handleDownloadAll = async () => {
    setDownloadingAll(true)
    try {
      const blob = await invoiceService.fetchDailyPdf(deliveryDate)
      openPdfBlob(blob, `invoices-${deliveryDate}.pdf`, true)
      push({ title: 'Download started', description: `All invoices for ${deliveryDate}.` })
    } catch (caught) {
      push({
        title: 'Could not download invoices',
        description: caught instanceof Error ? caught.message : 'Please try again in a moment.',
        tone: 'danger',
      })
    } finally {
      setDownloadingAll(false)
    }
  }

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
      render: (invoice) => {
        const isDownloaded = downloadedIds.has(invoice.id)
        return (
          <span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
            <Button size="sm" variant="ghost" onClick={() => setDetail(invoice)}>
              Details
            </Button>
            <Button size="sm" variant="ghost" onClick={() => handleView(invoice)}>
              View
            </Button>
            {isDownloaded ? (
              <Badge tone="success" className="admin-invoice-downloaded">
                <Icon name="check" size={14} /> Downloaded
              </Badge>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                icon="download"
                aria-label={`Download ${invoice.invoiceNumber}`}
                onClick={() => handleDownload(invoice)}
              />
            )}
          </span>
        )
      },
    },
  ]

  const itemColumns: Array<Column<OrderLineItem>> = [
    { key: 'item', header: 'Item', render: (item) => (
      <span>
        <strong>{item.name}</strong>
        <span className="type-caption" style={{ display: 'block' }}>{item.sku}</span>
      </span>
    ) },
    { key: 'qty', header: 'Qty', align: 'right', render: (item) => item.quantity },
    { key: 'price', header: 'Price', align: 'right', render: (item) => formatCurrency(item.price) },
    {
      key: 'subtotal',
      header: 'Subtotal',
      align: 'right',
      render: (item) => <strong>{formatCurrency(item.price * item.quantity)}</strong>,
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
      >
        <Input
          type="date"
          aria-label="Invoices issued from"
          value={fromDate}
          onChange={(event) => {
            setFromDate(event.target.value)
            setPage(1)
          }}
        />
        <Input
          type="date"
          aria-label="Invoices issued to"
          value={toDate}
          onChange={(event) => {
            setToDate(event.target.value)
            setPage(1)
          }}
        />
        {(fromDate || toDate) && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setFromDate('')
              setToDate('')
              setPage(1)
            }}
          >
            Clear dates
          </Button>
        )}
      </AdminToolbar>

      <section className="admin-card" style={{ padding: 16, display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label className="stack" style={{ gap: 4 }}>
          <span className="type-caption">Delivery date</span>
          <Input
            type="date"
            aria-label="Delivery date"
            value={deliveryDate}
            onChange={(event) => setDeliveryDate(event.target.value)}
          />
        </label>
        <Button
          icon="download"
          loading={downloadingAll}
          disabled={!deliveryDate}
          onClick={handleDownloadAll}
        >
          Download all invoices (PDF)
        </Button>
        <span className="type-caption">One combined PDF with one invoice per page, for the delivery run.</span>
      </section>

      <section className="admin-card">
        <DataTable
          columns={columns}
          rows={paged}
          rowKey={(invoice) => invoice.id}
          caption="Invoices"
          footer={<PaginationBar page={page} pageCount={pageCount} total={filtered.length} pageSize={PAGE_SIZE} onPageChange={setPage} />}
        />
      </section>

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail ? `Invoice ${detail.invoiceNumber}` : 'Invoice'}
        size="lg"
        footer={
          detail && (
            <>
              <Button variant="ghost" onClick={() => setDetail(null)}>
                Close
              </Button>
              <Button variant="outline" icon="eye" onClick={() => handleView(detail)}>
                Open PDF
              </Button>
              <Button icon="download" onClick={() => handleDownload(detail)}>
                Download PDF
              </Button>
            </>
          )
        }
      >
        {detail && (
          <div className="stack" style={{ gap: 20 }}>
            <div className="row" style={{ gap: 24, flexWrap: 'wrap', justifyContent: 'space-between' }}>
              <div>
                <span className="type-caption">Order</span>
                <p><strong>{detail.orderNumber}</strong></p>
                <span className="type-caption">Customer</span>
                <p>{detail.customerName}<br />{detail.customerEmail}</p>
              </div>
              <div>
                <span className="type-caption">Issued</span>
                <p>{formatDate(detail.issuedAt)}</p>
                <span className="type-caption">Status</span>
                <p><StatusPill status={detail.status} /></p>
              </div>
              <div>
                <span className="type-caption">Ship to</span>
                <p>
                  {detail.shippingAddress.fullName}<br />
                  {detail.shippingAddress.line1}
                  {detail.shippingAddress.line2 ? <><br />{detail.shippingAddress.line2}</> : null}
                  <br />
                  {[detail.shippingAddress.city, detail.shippingAddress.state, detail.shippingAddress.pincode]
                    .filter(Boolean)
                    .join(', ')}
                </p>
              </div>
            </div>

            <DataTable
              columns={itemColumns}
              rows={detail.items}
              rowKey={(item, index) => `${item.sku}-${index}`}
              caption={`Items on ${detail.invoiceNumber}`}
            />

            <div className="stack" style={{ gap: 4, alignItems: 'flex-end' }}>
              <span>Subtotal <strong>{formatCurrency(detail.subtotal)}</strong></span>
              <span>Discount <strong>-{formatCurrency(detail.discount)}</strong></span>
              <span>Shipping <strong>{formatCurrency(detail.shipping)}</strong></span>
              <span>Tax <strong>{formatCurrency(detail.tax)}</strong></span>
              <span className="type-body-lg">Total <strong>{formatCurrency(detail.total)}</strong></span>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}