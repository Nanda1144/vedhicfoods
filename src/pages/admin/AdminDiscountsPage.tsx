import { useState } from 'react'
import { adminService } from '@/services/adminService'
import { useAdminAuth } from '@/context/AdminAuthContext'
import { useAsync } from '@/hooks'
import { useToast } from '@/context'
import { formatCurrency, formatDate } from '@/utils/format'
import { AdminPageHeader, DataTable, StatusPill, ConfirmDialog, AdminToolbar, PaginationBar } from '@/components/admin'
import type { Column } from '@/components/admin'
import type { Discount, DiscountType } from '@/types'
import { Badge, Button, Modal, Skeleton, Icon } from '@/components/common'
import { Field, Input, Select, Switch } from '@/components/common/form'
import { CATEGORIES } from '@/data/categories'

const PAGE_SIZE = 8

const TYPE_META: Record<DiscountType, string> = {
  percent: '% off',
  flat: '₹ off',
  shipping: 'Free shipping',
}

export function AdminDiscountsPage() {
  const { can } = useAdminAuth()
  const { push } = useToast()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<Discount | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Discount | null>(null)
  const [busy, setBusy] = useState(false)

  const { data, loading, error, run } = useAsync(() => adminService.discounts(), [])

  const filtered = (data ?? []).filter((discount) => {
    const query = search.trim().toLowerCase()
    if (query && !`${discount.code} ${discount.label}`.toLowerCase().includes(query)) return false
    if (status === 'active' && !discount.active) return false
    if (status === 'expired' && new Date(discount.expiresAt) > new Date()) return false
    if (status === 'scheduled' && (discount.active || new Date(discount.startsAt) <= new Date())) return false
    return true
  })

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const columns: Array<Column<Discount>> = [
    {
      key: 'code',
      header: 'Code',
      render: (discount) => (
        <span className="discount-code">
          {discount.code}
          <Icon name="copy" size={13} />
        </span>
      ),
    },
    {
      key: 'label',
      header: 'Discount',
      render: (discount) => (
        <span>
          {discount.type === 'percent' && `${discount.value}% off`}
          {discount.type === 'flat' && formatCurrency(discount.value) + ' off'}
          {discount.type === 'shipping' && 'Free shipping'}
          <span className="type-caption" style={{ display: 'block' }}>
            {discount.label}
          </span>
        </span>
      ),
    },
    { key: 'min', header: 'Min. order', align: 'right', render: (discount) => formatCurrency(discount.minOrderValue) },
    { key: 'uses', header: 'Uses', align: 'right', render: (discount) => `${discount.usedCount} / ${discount.maxUses}` },
    {
      key: 'window',
      header: 'Valid window',
      render: (discount) => (
        <span className="type-caption">
          {formatDate(discount.startsAt)} → {formatDate(discount.expiresAt)}
        </span>
      ),
    },
    { key: 'state', header: 'Status', render: (discount) => <StatusPill status={discountState(discount)} /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (discount) => (
        <span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
          <button
            type="button"
            role="switch"
            aria-checked={discount.active}
            aria-label={`Toggle ${discount.code}`}
            className={`switch switch--sm${discount.active ? ' is-on' : ''}`}
            onClick={() => void toggle(discount)}
          >
            <span className="switch__track" aria-hidden="true">
              <span className="switch__thumb" />
            </span>
          </button>
          {can('discounts:write') && (
            <Button size="sm" variant="ghost" icon="edit" onClick={() => setEditing(discount)}>
              Edit
            </Button>
          )}
          {can('discounts:write') && (
            <Button size="sm" variant="ghost" icon="trash" onClick={() => setDeleting(discount)} aria-label={`Delete ${discount.code}`} />
          )}
        </span>
      ),
    },
  ]

  const toggle = async (discount: Discount) => {
    await adminService.updateDiscount(discount.id, { active: !discount.active })
    push({
      title: discount.active ? 'Discount paused' : 'Discount active',
      description: `“${discount.code}” is now ${discount.active ? 'paused' : 'live'}.`,
    })
    await run()
  }

  const doDelete = async (discount: Discount) => {
    setBusy(true)
    try {
      await adminService.deleteDiscount(discount.id)
      push({ title: 'Discount deleted', description: `“${discount.code}” was removed.` })
      setDeleting(null)
      await run()
    } finally {
      setBusy(false)
    }
  }

  if (loading && !data) {
    return (
      <>
        <AdminPageHeader title="Discounts" description="Coupons and automatic price reductions." />
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
        <AdminPageHeader title="Discounts" description="Coupons and automatic price reductions." />
        <p className="admin-note admin-note--error">{error.message}</p>
      </>
    )
  }

  return (
    <>
      <AdminPageHeader
        title="Discounts"
        description={`${data!.filter((d) => d.active).length} of ${data!.length} discounts active.`}
        actions={
          can('discounts:write') && (
            <Button icon="plus" onClick={() => setEditing('new')}>
              New discount
            </Button>
          )
        }
      />

      <AdminToolbar
        search={search}
        onSearch={(value) => {
          setSearch(value)
          setPage(1)
        }}
        searchPlaceholder="Search code or label…"
        filters={[{ label: 'State', value: status, options: ['Active', 'Scheduled', 'Expired'], onChange: setStatus }]}
      >
        <Badge tone="accent" dot>{data!.filter((d) => d.active).length} live</Badge>
      </AdminToolbar>

      <section className="admin-card">
        <DataTable columns={columns} rows={paged} rowKey={(discount) => discount.id} caption="Active discounts"
          footer={
            <PaginationBar page={page} pageCount={pageCount} total={filtered.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
          }
        />
      </section>

      {editing && (
        <DiscountModal
          discount={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await run()
            setEditing(null)
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete discount?"
        message={deleting ? `“${deleting.code}” will be removed permanently. Active coupons using it will stop working.` : ''}
        confirmLabel="Delete discount"
        tone="danger"
        loading={busy}
        onConfirm={() => deleting && void doDelete(deleting)}
        onClose={() => setDeleting(null)}
      />
    </>
  )
}

function DiscountModal({ discount, onClose, onSaved }: { discount: Discount | null; onClose: () => void; onSaved: () => void }) {
  const { push } = useToast()
  const isNew = discount === null
  const [form, setForm] = useState({
    code: discount?.code ?? '',
    label: discount?.label ?? '',
    type: discount?.type ?? ('percent' as DiscountType),
    value: discount?.value ?? '',
    minOrderValue: discount?.minOrderValue ?? '',
    maxUses: discount?.maxUses ?? '',
    appliesTo: discount?.appliesTo ?? ('all' as Discount['appliesTo']),
    active: discount?.active ?? true,
  })
  const [saving, setSaving] = useState(false)

  const patch = (key: keyof typeof form, value: unknown) => setForm((current) => ({ ...current, [key]: value }))
  const toNumber = (key: 'value' | 'minOrderValue' | 'maxUses') => (event: React.ChangeEvent<HTMLInputElement>) =>
    patch(key, event.target.value === '' ? '' : Number(event.target.value))

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      const payload = {
        code: form.code.trim().toUpperCase(),
        label: form.label,
        type: form.type,
        value: Number(form.value),
        minOrderValue: Number(form.minOrderValue || 0),
        maxUses: Number(form.maxUses || 0),
        usedCount: discount?.usedCount ?? 0,
        appliesTo: form.appliesTo,
        targetIds: discount?.targetIds ?? [],
        startsAt: new Date().toISOString(),
        expiresAt: discount?.expiresAt ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        active: form.active,
      }
      if (isNew) {
        await adminService.createDiscount(payload)
        push({ title: 'Discount created', description: `“${form.code}” is ready to use.` })
      } else {
        await adminService.updateDiscount(discount!.id, payload)
        push({ title: 'Discount updated', description: `“${form.code}” was saved.` })
      }
      onSaved()
    } catch (caught) {
      push({ title: 'Could not save discount', description: caught instanceof Error ? caught.message : 'Please try again.', tone: 'danger' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? 'New discount' : 'Edit discount'}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button icon="check" onClick={submit} loading={saving} form="discount-form">
            {isNew ? 'Create discount' : 'Save changes'}
          </Button>
        </>
      }
    >
      <form id="discount-form" className="admin-form" onSubmit={submit} noValidate>
        <div className="admin-form__grid">
          <Field label="Code" required hint="Customers type this at checkout.">
            <Input value={form.code} onChange={(event) => patch('code', event.target.value)} placeholder="VEDHI10" required />
          </Field>
          <Field label="Type" required>
            <Select
              value={form.type}
              onChange={(event) => patch('type', event.target.value)}
              aria-label="Discount type"
              options={(Object.keys(TYPE_META) as DiscountType[]).map((type) => ({
                value: type,
                label: TYPE_META[type],
              }))}
            />
          </Field>
          <Field label={form.type === 'percent' ? 'Percent off' : form.type === 'flat' ? 'Amount off (₹)' : 'Range (₹)'} required>
            <Input type="number" min="0" value={form.value} onChange={toNumber('value')} required />
          </Field>
          <Field label="Min. order value (₹)" hint="0 = no minimum.">
            <Input type="number" min="0" value={form.minOrderValue} onChange={toNumber('minOrderValue')} />
          </Field>
          <Field label="Max uses" hint="0 = unlimited.">
            <Input type="number" min="0" value={form.maxUses} onChange={toNumber('maxUses')} />
          </Field>
          <Field label="Applies to">
            <Select
              value={form.appliesTo}
              onChange={(event) => patch('appliesTo', event.target.value)}
              aria-label="Applies to"
              options={[
                { value: 'all', label: 'All products' },
                { value: 'category', label: 'Entire category' },
                { value: 'product', label: 'Specific products' },
              ]}
            />
          </Field>
        </div>
        {form.appliesTo === 'category' && (
          <Field label="Target category">
            <Select
              defaultValue={CATEGORIES[0]?.slug}
              aria-label="Target category"
              options={CATEGORIES.map((category) => ({ value: category.slug, label: category.name }))}
            />
          </Field>
        )}
        <div className="row" style={{ gap: 12 }}>
          <Switch label="Active immediately" checked={form.active} onCheckedChange={(value) => patch('active', value)} />
        </div>
      </form>
    </Modal>
  )
}

function discountState(discount: Discount): string {
  if (!discount.active) return 'disabled'
  const now = new Date()
  if (new Date(discount.expiresAt) < now) return 'expired'
  if (new Date(discount.startsAt) > now) return 'scheduled'
  return 'active'
}