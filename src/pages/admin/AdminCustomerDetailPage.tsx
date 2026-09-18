import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { adminService } from '@/services/adminService'
import { useAsync } from '@/hooks'
import { formatCurrency, formatDate, formatDateTime, initials } from '@/utils/format'
import { AdminPageHeader, DataTable, StatusPill } from '@/components/admin'
import type { Column } from '@/components/admin'
import type { Order } from '@/types'
import { Badge, Skeleton } from '@/components/common'

export function AdminCustomerDetailPage() {
  const { id } = useParams()
  const customer = useAsync(() => adminService.customer(id ?? ''), [id])
  const orders = useAsync(() => adminService.orders(), [])

  const customerOrders = useMemo(
    () => (orders.data ?? []).filter((order) => order.customerId === id),
    [orders.data, id],
  )

  if (customer.loading && !customer.data) {
    return (
      <>
        <AdminPageHeader title="Customer profile" description="Orders, addresses and account details." />
        <Skeleton style={{ width: '100%', height: 320 }} />
      </>
    )
  }

  if (customer.error || !customer.data) {
    return (
      <>
        <AdminPageHeader title="Customer profile" description="Orders, addresses and account details." />
        <p className="admin-note admin-note--error">{customer.error?.message ?? 'Customer not found.'}</p>
      </>
    )
  }

  const person = customer.data

  const columns: Array<Column<Order>> = [
    {
      key: 'order',
      header: 'Order',
      render: (order) => <Link to={`/admin/orders/${order.id}`}>{order.orderNumber}</Link>,
    },
    { key: 'date', header: 'Placed', render: (order) => <span className="type-caption">{formatDate(order.placedAt)}</span> },
    { key: 'items', header: 'Items', align: 'right', render: (order) => order.items.reduce((sum, item) => sum + item.quantity, 0) },
    { key: 'total', header: 'Total', align: 'right', render: (order) => <strong>{formatCurrency(order.total)}</strong> },
    { key: 'status', header: 'Status', render: (order) => <StatusPill status={order.status} /> },
    { key: 'payment', header: 'Payment', render: (order) => <StatusPill status={order.paymentStatus} /> },
  ]

  const defaultAddress = person.addresses.find((address) => address.isDefault) ?? person.addresses[0]

  return (
    <>
      <AdminPageHeader
        title="Customer profile"
        description={`Joined ${formatDate(person.joinedAt)}`}
        actions={
          <Link to={`/admin/customers`} className="link-button is-ghost">
            All customers
          </Link>
        }
      />

      <div className="admin-detail">
        <div className="admin-detail__main">
          <section className="admin-card">
            <header className="admin-card__head">
              <h2>Order history</h2>
              <span className="admin-card__hint">{customerOrders.length} orders</span>
            </header>
            <DataTable columns={columns} rows={customerOrders} rowKey={(order) => order.id} caption={`${person.name} orders`} />
          </section>
        </div>

        <aside className="admin-detail__side">
          <section className="admin-card">
            <header className="admin-card__head">
              <h2>Account</h2>
            </header>
            <div className="row" style={{ gap: 12 }}>
              <span className="admin-avatar-sm" >{initials(person.name, 2)}</span>
              <span>
                <strong>{person.name}</strong>
                <span className="type-caption" style={{ display: 'block' }}>{person.email}</span>
                <span className="type-caption" style={{ display: 'block' }}>{person.phone}</span>
              </span>
            </div>
            <div className="row" style={{ gap: 12, marginTop: 12 }}>
              <StatusPill status={person.status} />
              {person.marketingOptIn && <Badge tone="success" dot>Marketing opt-in</Badge>}
            </div>
          </section>

          <section className="admin-card">
            <header className="admin-card__head">
              <h2>Metrics</h2>
            </header>
            <dl className="detail-grid">
              <dt>Orders</dt>
              <dd>{person.orderCount}</dd>
              <dt>Lifetime spend</dt>
              <dd>{formatCurrency(person.totalSpent)}</dd>
              <dt>First order</dt>
              <dd>{person.lastOrderAt ? formatDateTime(person.lastOrderAt) : '—'}</dd>
            </dl>
          </section>

          <section className="admin-card">
            <header className="admin-card__head">
              <h2>Default address</h2>
            </header>
            {defaultAddress ? (
              <dl className="detail-grid">
                <dt>Label</dt>
                <dd>{defaultAddress.label}</dd>
                <dt>Address</dt>
                <dd>
                  {defaultAddress.fullName}<br />
                  {defaultAddress.line1}
                  {defaultAddress.line2 ? <>, {defaultAddress.line2}</> : null}<br />
                  {defaultAddress.city}, {defaultAddress.state} {defaultAddress.pincode}
                </dd>
                <dt>Phone</dt>
                <dd>{defaultAddress.phone}</dd>
              </dl>
            ) : (
              <p className="admin-muted">No saved address.</p>
            )}
          </section>
        </aside>
      </div>
    </>
  )
}