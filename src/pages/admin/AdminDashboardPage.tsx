import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { adminService } from '@/services/adminService'
import { useAsync } from '@/hooks'
import { formatCurrency, formatNumber } from '@/utils/format'
import { AdminPageHeader, StatCard, DataTable, StatusPill } from '@/components/admin'
import type { Column } from '@/components/admin'
import type { Customer, Order } from '@/types'
import { CATEGORIES } from '@/data/categories'
import { Icon, Skeleton } from '@/components/common'
import { useAdminAuth } from '@/context/AdminAuthContext'

const TONE_MAP = {
  neutral: 'neutral',
  success: 'green',
  warning: 'amber',
  danger: 'red',
  info: 'blue',
  accent: 'amber',
} as const

const TREND_MAP = { up: 'up', down: 'down', flat: 'neutral' } as const

function hourGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

export function AdminDashboardPage() {
  const { session, can } = useAdminAuth()
  const name = session?.name?.split(' ')[0] ?? 'Vedhi'
  const result = useAsync(() => adminService.dashboard(), [])
  const recentOrders = result.data?.recentOrders ?? []
  const recentCustomers = result.data?.recentCustomers ?? []
  const revenueSeries = result.data?.revenueSeries ?? []
  const topProducts = result.data?.topProducts ?? []
  const breakdown = result.data?.orderStatusBreakdown ?? []
  const metrics = result.data?.metrics ?? []

  const { categoryPerformance, lowStockCount } = useMemo(() => {
    const products = adminService.snapshot().products
    const categoryName = new Map(CATEGORIES.map((category) => [category.slug, category.name]))
    const byCategory = new Map<string, { count: number; stock: number; value: number }>()
    for (const product of products) {
      const key = categoryName.get(product.categorySlug) ?? product.categorySlug
      const entry = byCategory.get(key) ?? { count: 0, stock: 0, value: 0 }
      entry.count += 1
      entry.stock += product.stock
      entry.value += product.price * product.stock
      byCategory.set(key, entry)
    }
    const entries = [...byCategory.entries()].map(([name, data]) => ({ name, ...data }))
    const maxValue = Math.max(...entries.map((entry) => entry.value), 1)
    return {
      categoryPerformance: entries
        .sort((a, b) => b.value - a.value)
        .slice(0, 6)
        .map((entry) => ({ ...entry, share: Math.round((entry.value / maxValue) * 100) })),
      lowStockCount: products.filter((product) => product.stock <= 50).length,
    }
  }, [])

  if (result.loading && !result.data) {
    return (
      <>
        <AdminPageHeader title={`${hourGreeting()}, ${name}`} description="Here's what's happening across the shop today." />
        <div className="stat-grid">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} style={{ width: '100%', height: 108, borderRadius: 14 }} />
          ))}
        </div>
        <Skeleton style={{ width: '100%', height: 280, marginTop: 16, borderRadius: 14 }} />
      </>
    )
  }

  if (result.error) {
    return (
      <>
        <AdminPageHeader title={`${hourGreeting()}, ${name}`} description="Here's what's happening across the shop today." />
        <p className="admin-note admin-note--error">{result.error.message}</p>
      </>
    )
  }

  const peakRevenue = Math.max(...revenueSeries.map((point) => point.revenue), 1)
  const peakOrders = Math.max(...revenueSeries.map((point) => point.orders), 1)
  const totalOrders = breakdown.reduce((sum, item) => sum + item.value, 0)
  const delivered = breakdown.find((item) => item.label === 'Delivered')?.value ?? 0

  const orderColumns: Array<Column<Order>> = [
    { key: 'order', header: 'Order', render: (order) => <Link to={`/admin/orders/${order.id}`}>{order.orderNumber}</Link> },
    { key: 'customer', header: 'Customer', render: (order) => <span>{order.customerName}</span> },
    { key: 'date', header: 'Date', render: (order) => <span className="type-caption">{order.placedAt.slice(0, 10)}</span> },
    { key: 'total', header: 'Total', align: 'right', render: (order) => <strong>{formatCurrency(order.total)}</strong> },
    { key: 'status', header: 'Status', render: (order) => <StatusPill status={order.status} /> },
  ]

  const customerColumns: Array<Column<Customer>> = [
    { key: 'name', header: 'Customer', render: (customer) => <Link to={`/admin/customers/${customer.id}`}>{customer.name}</Link> },
    { key: 'email', header: 'Email', render: (customer) => <span className="type-caption">{customer.email}</span> },
    { key: 'orders', header: 'Orders', align: 'right', render: (customer) => formatNumber(customer.orderCount) },
    { key: 'spend', header: 'Lifetime spend', align: 'right', render: (customer) => formatCurrency(customer.totalSpent) },
  ]

  return (
    <>
      <AdminPageHeader
        title={`${hourGreeting()}, ${name}`}
        description="Here's what's happening across the shop today."
        actions={
          <div className="row" style={{ gap: 8 }}>
            {can('products:write') && (
              <Link className="link-button" to="/admin/products?action=new">
                <Icon name="plus" size={15} /> New product
              </Link>
            )}
            {can('orders:read') && (
              <Link className="link-button is-ghost" to="/admin/orders">
                View orders <Icon name="arrow-right" size={14} />
              </Link>
            )}
          </div>
        }
      />

      <section className="stat-grid">
        {metrics.map((metric) => (
          <StatCard
            key={metric.id}
            label={metric.label}
            value={metric.value}
            delta={metric.delta}
            deltaLabel={metric.hint}
            icon={metricIcon(metric.id)}
            tone={TONE_MAP[metric.tone]}
            trend={TREND_MAP[metric.trend]}
          />
        ))}
      </section>

      {can('orders:read') && (
        <section className="admin-grid admin-grid--3">
          <article className="admin-card admin-card--wide">
            <header className="admin-card__head">
              <h2>Revenue · 10 weeks</h2>
              <span className="admin-card__hint">INR · thousands</span>
            </header>
            <div className="m-chart" role="img" aria-label="Revenue bar chart over 10 weeks">
              <div className="m-chart__bars">
                {revenueSeries.map((point) => (
                  <div
                    key={point.label}
                    className="m-chart__col"
                    title={`Week ${point.label}: ${formatCurrency(point.revenue)}`}
                  >
                    <div className="m-chart__bar" style={{ height: `${Math.max(6, (point.revenue / peakRevenue) * 100)}%` }} />
                    <span className="m-chart__label">{point.label.replace('Wk ', '')}</span>
                  </div>
                ))}
              </div>
              <div className="m-chart__y">
                <span>₹{(peakRevenue / 1000).toFixed(0)}k</span>
                <span>₹{(peakRevenue / 2000).toFixed(0)}k</span>
                <span>0</span>
              </div>
            </div>
          </article>

          <article className="admin-card">
            <header className="admin-card__head">
              <h2>Order status</h2>
              <span className="admin-card__hint">{totalOrders} total</span>
            </header>
            <div className="donut-wrap">
              <div
                className="donut"
                role="img"
                aria-label={`${delivered} of ${totalOrders} orders delivered`}
                style={{ '--p': Math.round((delivered / totalOrders) * 100) } as React.CSSProperties}
              >
                <span>
                  <strong>{Math.round((delivered / totalOrders) * 100)}%</strong>
                  delivered
                </span>
              </div>
              <ul className="donut__legend">
                {breakdown.map((item) => (
                  <li key={item.label}>
                    <span className={`donut__dot is-${item.tone === 'success' ? 'green' : item.tone}`} />
                    {item.label}
                    <strong>{formatNumber(item.value)}</strong>
                  </li>
                ))}
              </ul>
            </div>
          </article>

          <article className="admin-card">
            <header className="admin-card__head">
              <h2>Top products</h2>
              {can('products:read') && (
                <Link to="/admin/products" className="admin-card__more">
                  All products <Icon name="arrow-right" size={13} />
                </Link>
              )}
            </header>
            <ol className="top-products">
              {topProducts.map((product, index) => (
                <li key={product.productId}>
                  <span className="top-products__rank">{index + 1}</span>
                  <span className="top-products__name">
                    <strong>{product.name}</strong>
                    <span className="type-caption">{formatNumber(product.unitsSold)} units sold</span>
                  </span>
                  <strong>{formatCurrency(product.revenue)}</strong>
                </li>
              ))}
            </ol>
          </article>

          <article className="admin-card">
            <header className="admin-card__head">
              <h2>Category performance</h2>
              <span className="admin-card__hint">stock value</span>
            </header>
            <ul className="hbar-list">
              {categoryPerformance.map((entry) => (
                <li key={entry.name} className="hbar">
                  <div className="hbar__row">
                    <span>{entry.name}</span>
                    <strong>
                      {entry.count} item{entry.count === 1 ? '' : 's'}
                    </strong>
                  </div>
                  <div className="hbar__track">
                    <div className="hbar__fill" style={{ width: `${entry.share}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </article>

          <article className="admin-card admin-card--wide">
            <header className="admin-card__head">
              <h2>Weekly orders</h2>
              <span className="admin-card__hint">units</span>
            </header>
            <div className="m-chart" role="img" aria-label="Order volume line chart over 10 weeks">
              <svg
                className="m-chart__line"
                viewBox="0 0 100 40"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <polyline
                  points={revenueSeries
                    .map((point, index) => `${(index / (revenueSeries.length - 1)) * 100},${40 - (point.orders / peakOrders) * 36 - 2}`)
                    .join(' ')}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="0.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <div className="m-chart__labels">
                {revenueSeries.map((point) => (
                  <span key={point.label}>{point.label.replace('Wk ', '')}</span>
                ))}
              </div>
            </div>
          </article>
        </section>
      )}

      {can('orders:read') && (
        <section className="admin-card">
          <header className="admin-card__head">
            <h2>Recent orders</h2>
            <Link to="/admin/orders" className="admin-card__more">
              Manage orders <Icon name="arrow-right" size={13} />
            </Link>
          </header>
          <DataTable columns={orderColumns} rows={recentOrders} rowKey={(order) => order.id} />
        </section>
      )}

      <section className="admin-grid admin-grid--2">
        {can('customers:read') && (
          <article className="admin-card">
            <header className="admin-card__head">
              <h2>Recent customers</h2>
              <Link to="/admin/customers" className="admin-card__more">
                All customers <Icon name="arrow-right" size={13} />
              </Link>
            </header>
            <DataTable columns={customerColumns} rows={recentCustomers} rowKey={(customer) => customer.id} />
          </article>
        )}

        {can('support:read') && (
          <article className="admin-card">
            <header className="admin-card__head">
              <h2>Support inbox</h2>
              <Link to="/admin/support" className="admin-card__more">
                Open inbox <Icon name="arrow-right" size={13} />
              </Link>
            </header>
            <SupportInboxPreview />
          </article>
        )}
      </section>

      <section className="admin-grid admin-grid--3 quick-grid">
        {can('inventory:read') && (
          <Link to="/admin/inventory" className="quick-tile">
            <span className="quick-tile__icon is-warning">
              <Icon name="package-open" size={18} />
            </span>
            <span>
              <strong>{lowStockCount} low-stock items</strong>
              <small>Review inventory & reorder list</small>
            </span>
          </Link>
        )}
        {can('audit:read') && (
          <Link to="/admin/audit-logs" className="quick-tile">
            <span className="quick-tile__icon is-info">
              <Icon name="clock" size={18} />
            </span>
            <span>
              <strong>Audit trail</strong>
              <small>Every admin action is logged</small>
            </span>
          </Link>
        )}
        {can('settings:read') && (
          <Link to="/admin/theme#theme" className="quick-tile">
            <span className="quick-tile__icon is-accent">
              <Icon name="sliders" size={18} />
            </span>
            <span>
              <strong>Storefront theme</strong>
              <small>Brand colours & presentation</small>
            </span>
          </Link>
        )}
      </section>
    </>
  )
}

function SupportInboxPreview() {
  const { data } = useAsync(() => adminService.tickets(), [])
  const open = (data ?? []).filter((ticket) => ticket.status !== 'resolved' && ticket.status !== 'closed').slice(0, 4)
  return (
    <ul className="inbox-list">
      {data === undefined && Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} style={{ width: '100%', height: 44 }} />)}
      {open.length === 0 && <li className="admin-muted">No open tickets. You’re all caught up.</li>}
      {open.map((ticket) => (
        <li key={ticket.id}>
          <Link to={`/admin/support/${ticket.id}`} className="inbox-list__item">
            <span className={`ticket-dot is-${ticket.priority}`} />
            <span className="inbox-list__copy">
              <strong>{ticket.subject}</strong>
              <small>
                Ticket {ticket.ticketNumber} · {ticket.customerName}
              </small>
            </span>
            <StatusPill status={ticket.status} />
          </Link>
        </li>
      ))}
    </ul>
  )
}

function metricIcon(id: string) {
  const map: Record<string, Parameters<typeof StatCard>[0]['icon']> = {
    revenue: 'rupee',
    orders: 'cart',
    aov: 'wallet',
    repeat: 'gift',
    conversion: 'chart',
    profit: 'trend-up',
    customers: 'users',
    tickets: 'mail',
    lowstock: 'package-open',
    delivery: 'truck',
  }
  return map[id] ?? 'chart'
}