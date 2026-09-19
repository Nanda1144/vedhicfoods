import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { adminService } from '@/services/adminService'
import { useAdminAuth } from '@/context/AdminAuthContext'
import { useAsync } from '@/hooks'
import { useToast } from '@/context'
import { formatCurrency } from '@/utils/format'
import { AdminPageHeader, DataTable, StatusPill, ConfirmDialog, AdminToolbar, PaginationBar } from '@/components/admin'
import type { Column } from '@/components/admin'
import type { Product } from '@/types'
import { CATEGORIES } from '@/data/categories'
import { Badge, Button, Modal, Skeleton } from '@/components/common'
import { Field, Input, Select, Switch, Textarea, ImageUpload } from '@/components/common/form'

const PAGE_SIZE = 10

export function AdminProductsPage() {
  const { can } = useAdminAuth()
  const { push } = useToast()
  const [params, setParams] = useSearchParams()
  const view = params.get('view') ?? 'all'
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [stockFilter, setStockFilter] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<string[]>([])
  const [editing, setEditing] = useState<Product | 'new' | null>(params.get('action') === 'new' ? 'new' : null)
  const [deleting, setDeleting] = useState<Product | null>(null)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const { data, loading, error, run } = useAsync(() => adminService.products(), [])

  const filtered = useMemo(() => {
    const products = data ?? []
    const query = search.trim().toLowerCase()
    return products.filter((product) => {
      if (view === 'categories') return false
      if (view === 'archive') return false
      if (query && !`${product.name} ${product.sku} ${product.categorySlug}`.toLowerCase().includes(query)) return false
      if (category && product.categorySlug !== category) return false
      if (stockFilter === 'out' && product.stock > 0) return false
      if (stockFilter === 'low' && !(product.stock > 0 && product.stock <= 15)) return false
      if (stockFilter === 'in' && product.stock <= 15) return false
      return true
    })
  }, [data, search, category, stockFilter, view])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const categoriesColumn = useMemo(() => {
    const products = data ?? []
    const byCategory = CATEGORIES.map((cat) => ({
      category: cat,
      count: products.filter((product) => product.categorySlug === cat.slug).length,
    }))
    const allCount = products.length
    return { byCategory: byCategory.filter((entry) => entry.count > 0).sort((a, b) => b.count - a.count), allCount }
  }, [data])

  if (loading && !data) {
    return (
      <>
        <AdminPageHeader title="Products" description="Manage the catalogue, pricing and availability." />
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
        <AdminPageHeader title="Products" description="Manage the catalogue, pricing and availability." />
        <p className="admin-note admin-note--error">{error.message}</p>
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
            <strong>
              {product.name}
              {product.active === false && <Badge tone="secondary" dot>Offline</Badge>}
            </strong>
            <span className="type-caption">{product.sku} · {product.unit}</span>
          </span>
        </span>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      render: (product) => <span className="type-caption">{product.categorySlug.replace(/-/g, ' ')}</span>,
    },
    {
      key: 'price',
      header: 'Price',
      align: 'right',
      sortValue: (product) => product.price,
      render: (product) => <strong>{formatCurrency(product.price)}</strong>,
    },
    {
      key: 'stock',
      header: 'Stock',
      align: 'right',
      sortValue: (product) => product.stock,
      render: (product) => <StatusPill status={product.stock <= 0 ? 'out' : product.stock <= 15 ? 'low' : 'in'} label={String(product.stock)} />,
    },
    {
      key: 'flags',
      header: 'Flags',
      render: (product) => (
        <span className="cluster cluster-3">
          {product.isOrganic && <Badge tone="success" dot>Organic</Badge>}
          {product.isBestSeller && <Badge tone="accent" dot>Bestseller</Badge>}
          {product.isNew && <Badge tone="info" dot>New</Badge>}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (product) => (
        <Button size="sm" variant="ghost" icon="edit" onClick={() => setEditing(product)}>
          Edit
        </Button>
      ),
    },
  ]

  const toggleActive = async (product: Product) => {
    const next = !(product.active ?? true)
    await adminService.updateProduct(product.id, { active: next })
    push({ title: next ? 'Product published' : 'Product hidden', description: `“${product.name}” is now ${next ? 'live' : 'offline'} in the store.` })
    await run()
  }

  const doDelete = async (product: Product) => {
    setBusy(true)
    try {
      await adminService.deleteProduct(product.id)
      push({ title: 'Product deleted', description: `“${product.name}” was removed from the catalogue.` })
      setDeleting(null)
      await run()
    } finally {
      setBusy(false)
    }
  }

  const doBulkDelete = async () => {
    setBusy(true)
    try {
      await Promise.all(selected.map((id) => adminService.deleteProduct(id)))
      push({ title: 'Products deleted', description: `${selected.length} products were removed.` })
      setSelected([])
      setBulkDeleteOpen(false)
      await run()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <AdminPageHeader
        title="Products"
        description={`${data?.length ?? 0} products in the catalogue.`}
        actions={
          can('products:write') && (
            <Button icon="plus" onClick={() => setEditing('new')}>
              New product
            </Button>
          )
        }
      />

      {view === 'categories' ? (
        <section className="admin-card">
          <header className="admin-card__head">
            <h2>Categories</h2>
            <span className="admin-card__hint">catalogue distribution</span>
          </header>
          <ul className="categories-list">
            {categoriesColumn.byCategory.map(({ category, count }) => (
              <li key={category.slug} className="admin-product-cell" style={{ justifyContent: 'space-between' }}>
                <span>
                  <strong>{category.name}</strong>
                  <span className="type-caption">{category.slug}</span>
                </span>
                <Badge tone="neutral">{count} products</Badge>
              </li>
            ))}
            <li className="admin-product-cell" style={{ justifyContent: 'space-between' }}>
              <span>
                <strong>All categories</strong>
                <span className="type-caption">total catalogue</span>
              </span>
              <Badge tone="accent">{categoriesColumn.allCount} products</Badge>
            </li>
          </ul>
        </section>
      ) : (
        <>
          <AdminToolbar
            search={search}
            onSearch={(value) => {
              setSearch(value)
              setPage(1)
            }}
            searchPlaceholder="Search by name, SKU or category…"
            filters={[
              { label: 'Category', value: category, options: CATEGORIES.map((cat) => cat.slug.replace(/-/g, ' ')), onChange: setCategory },
              { label: 'Stock', value: stockFilter, options: ['In stock', 'Low stock', 'Out of stock'], onChange: setStockFilter },
            ]}
          >
            {can('products:write') && selected.length > 0 && (
              <Button size="sm" variant="danger" icon="trash" onClick={() => setBulkDeleteOpen(true)}>
                Delete {selected.length}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              icon="download"
              onClick={() => {
                push({ title: 'Export started', description: 'Catalogue export is being prepared.' })
              }}
            >
              Export
            </Button>
          </AdminToolbar>

          <section className="admin-card">
            <DataTable
              columns={columns}
              rows={paged}
              rowKey={(product) => product.id}
              caption="Catalogue products"
              selectable
              selected={selected}
              onSelectionChange={setSelected}
              footer={
                <PaginationBar
                  page={page}
                  pageCount={pageCount}
                  total={filtered.length}
                  pageSize={PAGE_SIZE}
                  onPageChange={setPage}
                />
              }
            />
          </section>

          {can('products:write') && (
            <section className="admin-grid admin-grid--2">
              <article className="admin-card">
                <header className="admin-card__head">
                  <h2>Active vs hidden</h2>
                </header>
                <ul className="categories-list">
                  {(data ?? [])
                    .filter((product) => product.active === false)
                    .slice(0, 6)
                    .map((product) => (
                      <li key={product.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                        <span className="admin-product-cell">
                          <img src={product.images[0] ?? ''} alt="" className="admin-product-cell__thumb" loading="lazy" />
                          <span>
                            <strong>{product.name}</strong>
                            <span className="type-caption">{product.sku}</span>
                          </span>
                        </span>
                        <Button size="sm" variant="ghost" icon="check" onClick={() => void toggleActive(product)}>
                          Publish
                        </Button>
                      </li>
                    ))}
                </ul>
              </article>
            </section>
          )}
        </>
      )}

      {editing && (
        <ProductModal
          product={editing === 'new' ? null : editing}
          onClose={() => {
            setEditing(null)
            setParams({}, { replace: true })
          }}
          onSaved={async () => {
            await run()
            setEditing(null)
            setParams({}, { replace: true })
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete product?"
        message={
          deleting
            ? `“${deleting.name}” will be removed permanently. This cannot be undone (an audit entry is recorded).`
            : ''
        }
        confirmLabel="Delete product"
        tone="danger"
        loading={busy}
        onConfirm={() => deleting && void doDelete(deleting)}
        onClose={() => setDeleting(null)}
      />

      <ConfirmDialog
        open={bulkDeleteOpen}
        title={`Delete ${selected.length} products?`}
        message="All selected products will be permanently removed from the catalogue."
        confirmLabel="Delete selected"
        tone="danger"
        loading={busy}
        onConfirm={() => void doBulkDelete()}
        onClose={() => setBulkDeleteOpen(false)}
      />
    </>
  )
}

function ProductModal({ product, onClose, onSaved }: { product: Product | null; onClose: () => void; onSaved: () => void }) {
  const { push } = useToast()
  const isNew = product === null
  const [form, setForm] = useState({
    name: product?.name ?? '',
    categorySlug: product?.categorySlug ?? CATEGORIES[0]?.slug ?? '',
    price: product?.price ?? '',
    mrp: product?.mrp ?? '',
    unit: product?.unit ?? '250 g',
    netWeight: product?.netWeight ?? 250,
    stock: product?.stock ?? 10,
    sku: product?.sku ?? '',
    image: product?.images[0] ?? '',
    shortDescription: product?.shortDescription ?? '',
    description: product?.description ?? '',
    tags: product?.tags.join(', ') ?? '',
    shelfLife: product?.shelfLife ?? '',
    storage: product?.storage ?? '',
    allergens: product?.allergens.join(', ') ?? '',
    isOrganic: product?.isOrganic ?? true,
    isBestSeller: product?.isBestSeller ?? false,
    isNew: product?.isNew ?? false,
    isFeatured: product?.isFeatured ?? false,
    active: product?.active ?? true,
  })
  const [saving, setSaving] = useState(false)

  const patch = (key: keyof typeof form, value: unknown) => setForm((current) => ({ ...current, [key]: value }))

  const setNumber = (key: 'price' | 'mrp' | 'netWeight' | 'stock') => (event: React.ChangeEvent<HTMLInputElement>) =>
    patch(key, event.target.value === '' ? '' : Number(event.target.value))

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      const payload = {
        name: form.name,
        slug: product?.slug ?? form.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
        categorySlug: form.categorySlug,
        price: Number(form.price),
        mrp: Number(form.mrp || form.price),
        currency: 'INR' as const,
        unit: form.unit,
        netWeight: Number(form.netWeight),
        images: form.image ? [form.image] : [''],
        tags: form.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
        shortDescription: form.shortDescription,
        description: form.description,
        stock: Number(form.stock),
        sku: form.sku || `SKU-${Date.now().toString(36).toUpperCase()}`,
        allergens: form.allergens.split(',').map((item) => item.trim()).filter(Boolean),
        shelfLife: form.shelfLife,
        storage: form.storage,
        ingredients: product?.ingredients ?? [],
        nutrition: product?.nutrition ?? [],
        specifications: product?.specifications ?? [],
        rating: product?.rating ?? 0,
        reviewCount: product?.reviewCount ?? 0,
        isOrganic: form.isOrganic,
        isBestSeller: form.isBestSeller,
        isNew: form.isNew,
        isFeatured: form.isFeatured,
        active: form.active,
      }
      if (isNew) {
        await adminService.createProduct(payload)
        push({ title: 'Product created', description: `“${form.name}” is live in the catalogue.` })
      } else {
        await adminService.updateProduct(product!.id, payload)
        push({ title: 'Product updated', description: `“${form.name}” was saved.` })
      }
      onSaved()
    } catch (caught) {
      push({ title: 'Could not save product', description: caught instanceof Error ? caught.message : 'Please try again.', tone: 'danger' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? 'New product' : 'Edit product'}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button icon="check" onClick={submit} loading={saving} form="product-form">
            {isNew ? 'Create product' : 'Save changes'}
          </Button>
        </>
      }
    >
      <form id="product-form" className="admin-form" onSubmit={submit} noValidate>
        <div className="admin-form__grid">
          <Field label="Name" required>
            <Input value={form.name} onChange={(event) => patch('name', event.target.value)} required />
          </Field>
          <Field label="Category" required>
<Select
              value={form.categorySlug}
              onChange={(event) => patch('categorySlug', event.target.value)}
              aria-label="Category"
              options={CATEGORIES.map((category) => ({ value: category.slug, label: category.name }))}
            />
          </Field>
          <Field label="Selling price (₹)" required>
            <Input type="number" min="0" step="0.01" value={form.price} onChange={setNumber('price')} required />
          </Field>
          <Field label="MRP (₹)" hint="Higher than price enables the discount badge.">
            <Input type="number" min="0" step="0.01" value={form.mrp} onChange={setNumber('mrp')} />
          </Field>
          <Field label="Unit (pack size)">
            <Input value={form.unit} onChange={(event) => patch('unit', event.target.value)} placeholder="250 g" />
          </Field>
          <Field label="Net weight (g)">
            <Input type="number" min="0" value={form.netWeight} onChange={setNumber('netWeight')} />
          </Field>
          <Field label="Stock">
            <Input type="number" min="0" value={form.stock} onChange={setNumber('stock')} />
          </Field>
          <Field label="SKU">
            <Input value={form.sku} onChange={(event) => patch('sku', event.target.value)} placeholder="Auto-generated if empty" />
          </Field>
        </div>

        <div className="admin-form__section">
          <p className="admin-form__section-title">Flags</p>
          <div className="switch-grid">
            <Switch label="Organic" checked={form.isOrganic} onCheckedChange={(value) => patch('isOrganic', value)} />
            <Switch label="Best seller" checked={form.isBestSeller} onCheckedChange={(value) => patch('isBestSeller', value)} />
            <Switch label="New arrival" checked={form.isNew} onCheckedChange={(value) => patch('isNew', value)} />
            <Switch label="Featured" checked={form.isFeatured} onCheckedChange={(value) => patch('isFeatured', value)} />
            <Switch label="Available in store" checked={form.active} onCheckedChange={(value) => patch('active', value)} />
          </div>
        </div>

        <div className="admin-form__grid">
          <div className="admin-form__span-2">
            <ImageUpload
              label="Product image"
              hint="Upload a photo from your device (recommended) or paste an image URL. Uploads are stored locally in this prototype."
              value={form.image}
              onChange={(value) => patch('image', value)}
            />
          </div>
          <Field label="Tags" hint="Comma separated">
            <Input value={form.tags} onChange={(event) => patch('tags', event.target.value)} placeholder="gluten-free, energy" />
          </Field>
          <Field label="Shelf life">
            <Input value={form.shelfLife} onChange={(event) => patch('shelfLife', event.target.value)} placeholder="6 months" />
          </Field>
          <Field label="Storage">
            <Input value={form.storage} onChange={(event) => patch('storage', event.target.value)} placeholder="Store in a cool, dry place" />
          </Field>
          <Field label="Allergens" hint="Comma separated">
            <Input value={form.allergens} onChange={(event) => patch('allergens', event.target.value)} placeholder="None" />
          </Field>
        </div>

        <Field label="Short description">
          <Textarea rows={2} value={form.shortDescription} onChange={(event) => patch('shortDescription', event.target.value)} />
        </Field>
        <Field label="Full description">
          <Textarea rows={5} value={form.description} onChange={(event) => patch('description', event.target.value)} />
        </Field>
      </form>
    </Modal>
  )
}
