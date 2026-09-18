import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { adminService } from '@/services/adminService'
import { useAdminAuth } from '@/context/AdminAuthContext'
import { useAsync } from '@/hooks'
import { useToast } from '@/context'
import { formatCurrency, formatDate, formatDateTime } from '@/utils/format'
import { AdminPageHeader, DataTable, StatusPill, AdminToolbar, PaginationBar, ConfirmDialog } from '@/components/admin'
import type { Column } from '@/components/admin'
import type { Order, OrderStatus } from '@/types'
import { Badge, Button, Icon, Skeleton } from '@/components/common'

const PAGE_SIZE = 10

const STATUS_FLOW: OrderStatus[] = ['pending', 'confirmed', 'packed', 'shipped', 'out-for-delivery', 'delivered']
const STATUS_FILTERS: Array<OrderStatus | 'all'> = ['all', ...STATUS_FLOW, 'cancelled', 'returned']

export function AdminOrdersPage() {
  const { id } = useParams()
  return id ? <OrderDetail id={id} /> : <OrderList />
}

/* ---------------------------------------------------------------- List */

function OrderList() {
  const { can } = useAdminAuth()
  const { push } = useToast()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<OrderStatus | 'all'>('all')
  const [payment, setPayment] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<string[]>([])
  const [bulkAction, setBulkAction] = useState<'confirmed' | 'delivered' | null>(null)
  const [busy, setBusy] = useState(false)

  const { data, loading, error, run } = useAsync(() => adminService.orders(), [])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return (data ?? []).filter((order) => {
      if (
        query &&
        !`${order.orderNumber} ${order.customerName} ${order.customerEmail}`.toLowerCase().includes(query)
      )
        return false
      if (status !== 'all' && order.status !== status) return false
      if (payment && order.paymentStatus !== payment) return false
      return true
    })
  }, [data, search, status, payment])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const doBulk = async (target: OrderStatus) => {
    setBusy(true)
    try {
      await Promise.all(selected.map((orderId) => adminService.updateOrderStatus(orderId, target)))
      push({ title: 'Orders updated', description: `${selected.length} order${selected.length === 1 ? '' : 's'} marked ${target}.` })
      setSelected([])
      await run()
    } finally {
      setBusy(false)
    }
  }

  const columns: Array<Column<Order>> = [
    {
      key: 'order',
      header: 'Order',
      sortValue: (order) => order.orderNumber,
      render: (order) => (
        <span>
          <Link to={`/admin/orders/${order.id}`}>{order.orderNumber}</Link>
          <span className="type-caption" style={{ display: 'block' }}>{formatDate(order.placedAt)}</span>
        </span>
      ),
    },
    {
      key: 'customer',
      header: 'Customer',
      render: (order) => (
        <span>
          <strong>{order.customerName}</strong>
          <span className="type-caption" style={{ display: 'block' }}>{order.customerEmail}</span>
        </span>
      ),
    },
    {
      key: 'items',
      header: 'Items',
      align: 'right',
      render: (order) => order.items.reduce((sum, item) => sum + item.quantity, 0),
    },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      sortValue: (order) => order.total,
      render: (order) => <strong>{formatCurrency(order.total)}</strong>,
    },
    { key: 'status', header: 'Status', render: (order) => <StatusPill status={order.status} /> },
    {
      key: 'payment',
      header: 'Payment',
      render: (order) => (
        <span>
          <StatusPill status={order.paymentStatus} />
          <span className="type-caption" style={{ display: 'block' }}>{order.paymentMethod.toUpperCase()}</span>
        </span>
      ),
    },
  ]

  if (loading && !data) {
    return (
      <>
        <AdminPageHeader title="Orders" description="Track, fulfil and manage customer orders." />
        <section className="admin-card">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} style={{ width: '100%', height: 44, marginBottom: 8 }} />
          ))}
        </section>
      </>
    )
  }

  if (error) {
    return (
      <>
        <AdminPageHeader title="Orders" description="Track, fulfil and manage customer orders." />
        <p className="admin-note admin-note--error">{error.message}</p>
      </>
    )
  }

  return (
    <>
      <AdminPageHeader
        title="Orders"
        description={`${data!.length} orders · ${data!.filter((order) => order.status === 'pending').length} awaiting confirmation`}
      />

      <AdminToolbar
        search={search}
        onSearch={(value) => {
          setSearch(value)
          setPage(1)
        }}
        searchPlaceholder="Search order number, customer or email…"
        filters={[
          {
            label: 'Payment',
            value: payment,
            options: ['pending', 'processing', 'paid', 'failed', 'refunded'],
            onChange: setPayment,
          },
        ]}
      >
        {can('orders:write') && selected.length > 0 && (
          <>
            <Button size="sm" variant="outline" icon="check" onClick={() => setBulkAction('confirmed')}>
              Confirm {selected.length}
            </Button>
            <Button size="sm" variant="primary" icon="truck" onClick={() => setBulkAction('delivered')}>
              Deliver {selected.length}
            </Button>
          </>
        )}
        <Button
          size="sm"
          variant="outline"
          icon="download"
          onClick={() => push({ title: 'Export started', description: 'Order export is being prepared.' })}
        >
          Export
        </Button>
      </AdminToolbar>

      <div className="filter-chips" role="group" aria-label="Filter orders by status">
        {STATUS_FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            className={status === value ? 'chip is-active' : 'chip'}
            onClick={() => setStatus(value)}
          >
            {value === 'all' ? 'All' : value.replace(/-/g, ' ')}
          </button>
        ))}
      </div>

      <section className="admin-card">
        <DataTable
          columns={columns}
          rows={paged}
          rowKey={(order) => order.id}
          caption="Customer orders"
          selectable
          selected={selected}
          onSelectionChange={setSelected}
          footer={
            <PaginationBar page={page} pageCount={pageCount} total={filtered.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
          }
        />
      </section>

      <ConfirmDialog
        open={bulkAction !== null}
        title={bulkAction === 'confirmed' ? `Confirm ${selected.length} orders?` : `Mark ${selected.length} as delivered?`}
        message={
          bulkAction === 'confirmed'
            ? 'Confirmed orders move into fulfilment. Customers are not notified in this prototype.'
            : 'Delivered orders are closed and invoices move to paid.'
        }
        confirmLabel={bulkAction === 'confirmed' ? 'Confirm orders' : 'Mark delivered'}
        loading={busy}
        onConfirm={() => bulkAction && void doBulk(bulkAction)}
        onClose={() => setBulkAction(null)}
      />
    </>
  )
}

/* ------------------------------------------------------------- Detail */

function OrderDetail({ id }: { id: string }) {
  const { can } = useAdminAuth()
  const { push } = useToast()
  const [busy, setBusy] = useState(false)
  const { data, loading, error, run } = useAsync(() => adminService.order(id), [id])

  const advance = async (status: OrderStatus) => {
    setBusy(true)
    try {
      await adminService.updateOrderStatus(id, status)
      push({ title: 'Order updated', description: `Order is now ${status.replace(/-/g, ' ')}.` })
      await run()
    } finally {
      setBusy(false)
    }
  }

  if (loading && !data) {
    return (
      <>
        <AdminPageHeader title="Order detail" description="Track fulfilment and payment." />
        <Skeleton style={{ width: '100%', height: 320 }} />
      </>
    )
  }

  if (error || !data) {
    return (
      <>
        <AdminPageHeader title="Order detail" description="Track fulfilment and payment." />
        <p className="admin-note admin-note--error">{error?.message ?? 'Order not found.'}</p>
      </>
    )
  }

  const order = data
  const nextIndex = STATUS_FLOW.indexOf(order.status)
  const next = STATUS_FLOW[nextIndex + 1]
  const currentStep = order.status === 'cancelled' ? -1 : nextIndex

  return (
    <>
      <AdminPageHeader
        title={`Order ${order.orderNumber}`}
        description={`Placed ${formatDateTime(order.placedAt)} · ${order.paymentMethod.toUpperCase()}`}
        actions={
          <>
            {can('orders:write') && next && (
              <Button icon="arrow-right" loading={busy} onClick={() => void advance(next)}>
                Move to {next.replace(/-/g, ' ')}
              </Button>
            )}
            {can('orders:write') && order.status !== 'cancelled' && order.status !== 'returned' && (
              <Button variant="ghost" icon="ban" loading={busy} onClick={() => void advance('cancelled')}>
                Cancel order
              </Button>
            )}
          </>
        }
      />

      <div className="admin-detail">
        <div className="admin-detail__main">
          <section className="admin-card">
            <header className="admin-card__head">
              <h2>Items</h2>
              <span className="admin-card__hint">
                {order.items.reduce((sum, item) => sum + item.quantity, 0)} units
              </span>
            </header>
            <ul className="order-items">
              {order.items.map((item) => (
                <li key={item.productId} className="order-items__row">
                  <img src={item.image} alt="" className="admin-product-cell__thumb" loading="lazy" />
                  <span className="order-items__copy">
                    <strong>{item.name}</strong>
                    <span className="type-caption">{item.sku} · {item.unit}</span>
                  </span>
                  <span className="type-caption">{item.quantity} × {formatCurrency(item.price)}</span>
                  <strong>{formatCurrency(item.quantity * item.price)}</strong>
                </li>
              ))}
            </ul>
            <dl className="order-summary">
              <div>
                <dt>Subtotal</dt>
                <dd>{formatCurrency(order.subtotal)}</dd>
              </div>
              <div>
                <dt>Shipping</dt>
                <dd>{formatCurrency(order.shipping)}</dd>
              </div>
              <div>
                <dt>Tax (GST)</dt>
                <dd>{formatCurrency(order.tax)}</dd>
              </div>
              {order.discount > 0 && (
                <div>
                  <dt>Discount{order.couponCode ? ` (${order.couponCode})` : ''}</dt>
                  <dd className="is-negative">−{formatCurrency(order.discount)}</dd>
                </div>
              )}
              <div className="order-summary__total">
                <dt>Total</dt>
                <dd>{formatCurrency(order.total)}</dd>
              </div>
            </dl>
          </section>

          <section className="admin-card">
            <header className="admin-card__head">
              <h2>Fulfilment timeline</h2>
            </header>
            <ol className="timeline">
              {order.timeline.map((entry) => (
                <li key={`${entry.status}-${entry.at}`} className={entry.completed ? 'is-done' : ''}>
                  <span className="timeline__dot">
                    {entry.completed && <Icon name="check" size={12} />}
                  </span>
                  <span className="timeline__copy">
                    <strong>{entry.label}</strong>
                    <span className="type-caption">{formatDateTime(entry.at)}</span>
                  </span>
                </li>
              ))}
            </ol>
            {order.status === 'cancelled' && (
              <p className="admin-muted">This order was cancelled.</p>
            )}
          </section>
        </div>

        <aside className="admin-detail__side">
          <section className="admin-card">
            <header className="admin-card__head">
              <h2>Status</h2>
            </header>
            <div className="admin-detail__status">
              <StatusPill status={order.status} label={order.status} />
              <StatusPill status={order.paymentStatus} label={`payment ${order.paymentStatus}`} />
              {order.status === 'delivered' && <Badge tone="success" dot>Closed</Badge>}
            </div>
            <div className="detail-progress" role="img" aria-label={`Step ${currentStep + 1} of ${STATUS_FLOW.length}`}>
              <span className="detail-progress__track">
                <span
                  className="detail-progress__fill"
                  style={{ width: `${currentStep >= 0 ? ((currentStep + 1) / STATUS_FLOW.length) * 100 : 0}%` }}
                />
              </span>
              <span className="type-caption">
                {currentStep >= 0 ? `Step ${currentStep + 1} of ${STATUS_FLOW.length}` : 'Cancelled'}
              </span>
            </div>
          </section>

          <section className="admin-card">
            <header className="admin-card__head">
              <h2>Customer</h2>
            </header>
            <dl className="detail-grid">
              <dt>Name</dt>
              <dd>{order.customerName}</dd>
              <dt>Email</dt>
              <dd>{order.customerEmail}</dd>
              <dt>Delivery to</dt>
              <dd>
                {order.address.fullName}<br />
                {order.address.line1}
                {order.address.line2 ? <>, {order.address.line2}</> : null}<br />
                {order.address.city}, {order.address.state} {order.address.pincode}
              </dd>
              <dt>Phone</dt>
              <dd>{order.address.phone}</dd>
            </dl>
            {can('customers:read') && (
              <Link to={`/admin/customers/${order.customerId}`} className="link-button is-ghost">
                View customer profile
              </Link>
            )}
          </section>

          <section className="admin-card">
            <header className="admin-card__head">
              <h2>Tracking</h2>
            </header>
            <dl className="detail-grid">
              <dt>Courier</dt>
              <dd>{order.courier ?? '—'}</dd>
              <dt>Tracking ID</dt>
              <dd>{order.trackingNumber ?? '—'}</dd>
            </dl>
            {order.invoiceId && (
              <Link to={`/invoice/${order.invoiceId}`} target="_blank" className="link-button is-ghost">
                <Icon name="download" size={15} /> View invoice
              </Link>
            )}
          </section>
        </aside>
      </div>
    </>
  )
}