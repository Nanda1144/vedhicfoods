import { useMemo, useState } from 'react'
import { adminService } from '@/services/adminService'
import { useAdminAuth } from '@/context/AdminAuthContext'
import { useAsync } from '@/hooks'
import { useToast } from '@/context'
import { formatCurrency } from '@/utils/format'
import { AdminPageHeader, DataTable, StatusPill } from '@/components/admin'
import type { Column } from '@/components/admin'
import type { Product } from '@/types'
import { Button, Modal, Skeleton, Icon } from '@/components/common'
import { Field, Input, Select } from '@/components/common/form'

const REORDER_LEVEL = 20

export function AdminInventoryPage() {
  const { can } = useAdminAuth()
  const { push } = useToast()
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [adjusting, setAdjusting] = useState<Product | null>(null)
  const [delta, setDelta] = useState('')
  const [busy, setBusy] = useState(false)

  const alerts = useAsync(() => adminService.inventoryAlerts(), [])
  const products = useAsync(() => adminService.products(), [])

  const rows = useMemo(() => {
    const list = products.data ?? []
    const query = search.trim().toLowerCase()
    return list.filter((product) => {
      if (query && !`${product.name} ${product.sku}`.toLowerCase().includes(query)) return false
      if (filter === 'low' && !(product.stock > 0 && product.stock <= REORDER_LEVEL)) return false
      if (filter === 'out' && product.stock > 0) return false
      if (filter === 'healthy' && product.stock < REORDER_LEVEL * 2) return false
      return true
    })
  }, [products.data, search, filter])

  const lowCount = useMemo(() => (products.data ?? []).filter((product) => product.stock <= REORDER_LEVEL).length, [products.data])
  const stockValue = useMemo(
    () => (products.data ?? []).reduce((sum, product) => sum + product.price * product.stock, 0),
    [products.data],
  )

  const submitAdjust = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!adjusting) return
    setBusy(true)
    try {
      const next = Math.max(0, adjusting.stock + Number(delta || 0))
      await adminService.updateProduct(adjusting.id, { stock: next })
      push({
        title: 'Stock updated',
        description: `“${adjusting.name}” stock is now ${next} unit${next === 1 ? '' : 's'}.`,
      })
      setAdjusting(null)
      setDelta('')
      await products.run()
      await alerts.run()
    } finally {
      setBusy(false)
    }
  }

  if (products.loading && !products.data) {
    return (
      <>
        <AdminPageHeader title="Inventory" description="Monitor stock levels and reorder low items." />
        <section className="admin-card">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} style={{ width: '100%', height: 44, marginBottom: 8 }} />
          ))}
        </section>
      </>
    )
  }

  if (products.error) {
    return (
      <>
        <AdminPageHeader title="Inventory" description="Monitor stock levels and reorder low items." />
        <p className="admin-note admin-note--error">{products.error.message}</p>
      </>
    )
  }

  const columns: Array<Column<Product>> = [
    {
      key: 'product',
      header: 'Product',
      sortValue: (product) => product.name,
      render: (product) => (
        <span className="admin-product-cell">
          <img src={product.images[0] ?? ''} alt="" className="admin-product-cell__thumb" loading="lazy" />
          <span>
            <strong>{product.name}</strong>
            <span className="type-caption">{product.sku} · {product.unit}</span>
          </span>
        </span>
      ),
    },
    { key: 'category', header: 'Category', render: (product) => <span className="type-caption">{product.categorySlug.replace(/-/g, ' ')}</span> },
    { key: 'price', header: 'Unit price', align: 'right', sortValue: (product) => product.price, render: (product) => formatCurrency(product.price) },
    {
      key: 'stock',
      header: 'Stock',
      align: 'right',
      sortValue: (product) => product.stock,
      render: (product) => (
        <StatusPill
          status={product.stock <= 0 ? 'out' : product.stock <= REORDER_LEVEL ? 'low' : 'in'}
          label={`${product.stock} unit${product.stock === 1 ? '' : 's'}`}
        />
      ),
    },
    {
      key: 'value',
      header: 'Stock value',
      align: 'right',
      sortValue: (product) => product.price * product.stock,
      render: (product) => <strong>{formatCurrency(product.price * product.stock)}</strong>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (product) =>
        can('inventory:write') ? (
          <Button size="sm" variant="ghost" icon="edit" onClick={() => setAdjusting(product)}>
            Adjust
          </Button>
        ) : (
          <span className="type-caption">read-only</span>
        ),
    },
  ]

  interface ReorderAlert {
    productId: string
    name: string
    sku: string
    image: string
    stock: number
    reorderLevel: number
  }

  const reorderColumns: Array<Column<ReorderAlert>> = [
    {
      key: 'product',
      header: 'Product',
      render: (alert) => (
        <span className="admin-product-cell">
          <img src={alert.image} alt="" className="admin-product-cell__thumb" loading="lazy" />
          <span>
            <strong>{alert.name}</strong>
            <span className="type-caption">{alert.sku}</span>
          </span>
        </span>
      ),
    },
    {
      key: 'stock',
      header: 'Stock',
      align: 'right',
      render: (alert) => <StatusPill status={alert.stock <= 0 ? 'out' : 'low'} label={`${alert.stock} left`} />,
    },
    {
      key: 'level',
      header: 'Reorder level',
      align: 'right',
      render: (alert) => <strong>{alert.reorderLevel}</strong>,
    },
    {
      key: 'suggested',
      header: 'Suggested qty',
      align: 'right',
      sortValue: (alert) => Math.max(alert.reorderLevel * 4 - alert.stock, 0),
      render: (alert) => <strong>{Math.max(alert.reorderLevel * 4 - alert.stock, 0)}</strong>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (alert) =>
        can('inventory:write') ? (
          <Button
            size="sm"
            variant="outline"
            icon="plus"
            onClick={() => {
              const product = rows.find((candidate) => candidate.id === alert.productId)
              setAdjusting(product ?? null)
              setDelta(product ? String(Math.max(alert.reorderLevel * 4 - product.stock, 0)) : '0')
            }}
          >
            Restock
          </Button>
        ) : null,
    },
  ]

  return (
    <>
      <AdminPageHeader
        title="Inventory"
        description={`${lowCount} items at or below reorder level · stock value ${formatCurrency(stockValue)}`}
      />

      {(alerts.data?.length ?? 0) > 0 && (
        <div className="admin-alert is-warning" style={{ marginBottom: 16 }}>
          <Icon name="alert" size={16} />
          <span>
            {alerts.data!.length} product{alerts.data!.length === 1 ? '' : 's'} need reordering (≤ {REORDER_LEVEL} units).
          </span>
        </div>
      )}

      <div className="filter-chips" role="group" aria-label="Filter inventory">
        {['all', 'in', 'low', 'out'].map((value) => (
          <button
            key={value}
            type="button"
            className={filter === value ? 'chip is-active' : 'chip'}
            onClick={() => setFilter(value)}
          >
            {value === 'all' ? 'All' : value === 'in' ? 'Healthy stock' : value === 'low' ? 'Low stock' : 'Out of stock'}
          </button>
        ))}
      </div>

      <section className="admin-card">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(product) => product.id}
          caption="Inventory levels"
          footer={
            <div className="admin-toolbar__search" style={{ minWidth: 220 }}>
              <Input
                type="search"
                placeholder="Search product or SKU…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                icon="search"
                aria-label="Search inventory"
              />
            </div>
          }
        />
      </section>

      <section className="admin-card">
        <header className="admin-card__head">
          <h2>Reorder suggestions</h2>
          <span className="admin-card__hint">{alerts.data?.length ?? 0} items at or below reorder level</span>
        </header>
        {alerts.loading ? (
          <div className="stack stack-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} style={{ width: '100%', height: 48 }} />
            ))}
          </div>
        ) : (
          <DataTable
            columns={reorderColumns}
            rows={alerts.data ?? []}
            rowKey={(alert) => alert.productId}
            caption="Reorder suggestions"
          />
        )}
      </section>

      {adjusting && (
        <Modal
          open
          onClose={() => setAdjusting(null)}
          title={`Adjust stock — ${adjusting.name}`}
          size="sm"
          footer={
            <>
              <Button variant="ghost" onClick={() => setAdjusting(null)} disabled={busy}>
                Cancel
              </Button>
              <Button icon="check" onClick={submitAdjust} loading={busy}>
                Save stock
              </Button>
            </>
          }
        >
          <form className="admin-form" onSubmit={submitAdjust} noValidate>
            <div className="admin-stats-inline">
              <span className="type-caption">Current</span>{' '}
              <strong>{adjusting.stock} unit{adjusting.stock === 1 ? '' : 's'}</strong>
            </div>
            <Field label="Adjustment" hint="Use + or −, e.g. +50 adds stock, −10 removes stock.">
              <Input
                type="text"
                inputMode="numeric"
                value={delta}
                onChange={(event) => setDelta(event.target.value)}
                placeholder="+50"
                autoFocus
              />
            </Field>
            <Field label="Reason">
              <Select
                defaultValue="stock-count"
                aria-label="Reason for adjustment"
                options={[
                  { value: 'stock-count', label: 'Stock count / audit' },
                  { value: 'restock', label: 'Supplier restock' },
                  { value: 'damage', label: 'Damage / expiry' },
                  { value: 'return', label: 'Customer return' },
                ]}
              />
            </Field>
          </form>
        </Modal>
      )}
    </>
  )
}