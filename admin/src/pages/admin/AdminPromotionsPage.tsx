import { useState } from 'react'
import { adminService } from '@/services/adminService'
import { useAdminAuth } from '@/context/AdminAuthContext'
import { useAsync } from '@/hooks'
import { useToast } from '@/context'
import { formatDate } from '@/utils/format'
import { AdminPageHeader, ConfirmDialog, AdminToolbar } from '@/components/admin'
import type { DiscountType, Promotion } from '@/types'
import { Badge, Button, Modal, Skeleton } from '@/components/common'
import { Field, Input, Select, Switch, Textarea } from '@/components/common/form'

/**
 * The backend `Promotion` row is a discount-shaped campaign (name, description,
 * discountType, discountValue, minOrderValue, start/end, priority) — there is
 * no placement or call-to-action column in the schema, so the card reports the
 * discount the campaign actually grants instead of a surface it cannot have.
 */
function discountLabel(promotion: Promotion): string {
  const value = Number(promotion.value) || 0
  return promotion.type === 'flat' ? `₹${value} off` : `${value}% off`
}

export function AdminPromotionsPage() {
  const { can } = useAdminAuth()
  const { push } = useToast()
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Promotion | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Promotion | null>(null)
  const [busy, setBusy] = useState(false)

  const { data, loading, error, run } = useAsync(() => adminService.promotions(), [])

  const filtered = (data ?? []).filter((promotion) => {
    const query = search.trim().toLowerCase()
    return !query || `${promotion.title} ${promotion.subtitle} ${promotion.type}`.toLowerCase().includes(query)
  })

  const toggle = async (promotion: Promotion) => {
    await adminService.updatePromotion(promotion.id, { active: !promotion.active })
    push({
      title: promotion.active ? 'Promotion paused' : 'Promotion live',
      description: `“${promotion.title}” is now ${promotion.active ? 'paused' : 'live'}.`,
    })
    await run()
  }

  const doDelete = async (promotion: Promotion) => {
    setBusy(true)
    try {
      await adminService.deletePromotion(promotion.id)
      push({ title: 'Promotion deleted', description: `“${promotion.title}” was removed.` })
      setDeleting(null)
      await run()
    } finally {
      setBusy(false)
    }
  }

  if (loading && !data) {
    return (
      <>
        <AdminPageHeader title="Festival promotions" description="Seasonal sales, hero banners and popups." />
        <section className="admin-card">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} style={{ width: '100%', height: 96, marginBottom: 12 }} />
          ))}
        </section>
      </>
    )
  }

  if (error) {
    return (
      <>
        <AdminPageHeader title="Festival promotions" description="Seasonal sales, hero banners and popups." />
        <p className="admin-note admin-note--error">{error.message}</p>
      </>
    )
  }

  const liveCount = data!.filter((promotion) => promotion.active).length

  return (
    <>
      <AdminPageHeader
        title="Festival promotions"
        description={`${liveCount} of ${data!.length} promotions running right now.`}
        actions={
          can('discounts.update') && (
            <Button icon="sparkles" onClick={() => setEditing('new')}>
              New promotion
            </Button>
          )
        }
      />

      <AdminToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search promotions…"
      />

      <section className="promo-grid">
        {filtered.map((promotion) => {
          return (
            <article key={promotion.id} className={`promo-card${promotion.active ? '' : ' is-off'}`}>
              <header className="promo-card__head">
                <span className="promo-card__placement">{discountLabel(promotion)}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={promotion.active}
                  aria-label={`Toggle ${promotion.title}`}
                  className={`switch switch--sm${promotion.active ? ' is-on' : ''}`}
                  onClick={() => void toggle(promotion)}
                >
                  <span className="switch__track" aria-hidden="true">
                    <span className="switch__thumb" />
                  </span>
                </button>
              </header>
              <h3>{promotion.title}</h3>
              <p>{promotion.subtitle}</p>
              <div className="promo-card__foot">
                <span className="type-caption">
                  {formatDate(promotion.startsAt)} → {formatDate(promotion.expiresAt)}
                </span>
                <span className="row" style={{ gap: 4 }}>
                  <Badge tone={promotion.active ? 'success' : 'neutral'} dot>
                    {promotion.active ? 'Live' : 'Paused'}
                  </Badge>
                  {can('discounts.update') && (
                    <Button size="sm" variant="ghost" icon="edit" onClick={() => setEditing(promotion)}>
                      Edit
                    </Button>
                  )}
                  {can('discounts.update') && (
                    <Button size="sm" variant="ghost" icon="ban" onClick={() => setDeleting(promotion)} aria-label={`Delete ${promotion.title}`} />
                  )}
                </span>
              </div>
            </article>
          )
        })}
        {filtered.length === 0 && (
          <section className="admin-card" style={{ gridColumn: '1 / -1' }}>
            <div className="placeholder-page__inner">
              <h2>No promotions match.</h2>
              <p className="admin-muted">Adjust your search or create a new one.</p>
            </div>
          </section>
        )}
      </section>

      {editing && (
        <PromotionModal
          promotion={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await run()
            setEditing(null)
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete promotion?"
        message={deleting ? `“${deleting.title}” will stop showing across the storefront.` : ''}
        confirmLabel="Delete promotion"
        tone="danger"
        loading={busy}
        onConfirm={() => deleting && void doDelete(deleting)}
        onClose={() => setDeleting(null)}
      />
    </>
  )
}

function PromotionModal({
  promotion,
  onClose,
  onSaved,
}: {
  promotion: Promotion | null
  onClose: () => void
  onSaved: () => void
}) {
  const { push } = useToast()
  const isNew = promotion === null
  const [form, setForm] = useState({
    title: promotion?.title ?? '',
    subtitle: promotion?.subtitle ?? '',
    type: promotion?.type ?? ('percent' as DiscountType),
    value: promotion?.value ?? '',
    minOrderValue: promotion?.minOrderValue ?? '',
    active: promotion?.active ?? true,
  })
  const [saving, setSaving] = useState(false)

  const patch = (key: keyof typeof form, value: unknown) => setForm((current) => ({ ...current, [key]: value }))
  const toNumber = (key: 'value' | 'minOrderValue') => (event: React.ChangeEvent<HTMLInputElement>) =>
    patch(key, event.target.value === '' ? '' : Number(event.target.value))

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      const payload: Omit<Promotion, 'id'> = {
        title: form.title.trim(),
        subtitle: form.subtitle.trim(),
        type: form.type,
        value: Number(form.value),
        minOrderValue: Number(form.minOrderValue || 0),
        active: form.active,
        startsAt: promotion?.startsAt ?? new Date().toISOString(),
        expiresAt: promotion?.expiresAt ?? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      }
      if (isNew) {
        await adminService.createPromotion(payload)
        push({ title: 'Promotion created', description: `“${form.title}” is ready.` })
      } else {
        await adminService.updatePromotion(promotion!.id, payload)
        push({ title: 'Promotion updated', description: `“${form.title}” was saved.` })
      }
      onSaved()
    } catch (caught) {
      push({
        title: 'Could not save promotion',
        description: caught instanceof Error ? caught.message : 'Please try again.',
        tone: 'danger',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? 'New promotion' : 'Edit promotion'}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button icon="check" onClick={submit} loading={saving} form="promotion-form">
            {isNew ? 'Create promotion' : 'Save changes'}
          </Button>
        </>
      }
    >
      <form id="promotion-form" className="admin-form" onSubmit={submit} noValidate>
        <div className="admin-form__section">
          <p className="admin-form__section-title">Campaign</p>
          <Field label="Title" required hint="e.g. Deepavali Mega Sale">
            <Input value={form.title} onChange={(event) => patch('title', event.target.value)} required />
          </Field>
          <Field label="Subtitle" required>
            <Textarea
              rows={2}
              value={form.subtitle}
              onChange={(event) => patch('subtitle', event.target.value)}
              required
            />
          </Field>
        </div>

        <div className="admin-form__section">
          <p className="admin-form__section-title">Discount</p>
          <Field label="Type" required>
            <Select
              value={form.type}
              onChange={(event) => patch('type', event.target.value)}
              options={[
                { value: 'percent', label: 'Percentage off' },
                { value: 'flat', label: 'Flat amount off' },
              ]}
            />
          </Field>
          <Field
            label={form.type === 'flat' ? 'Amount off (₹)' : 'Percent off (%)'}
            required
            hint={form.type === 'flat' ? 'Flat reduction, e.g. 250 takes ₹250 off a qualifying order.' : 'Share of the order, e.g. 20 takes 20% off.'}
          >
            <Input type="number" min="0" value={form.value} onChange={toNumber('value')} required />
          </Field>
          <Field label="Min. order value (₹)" hint="0 = no minimum.">
            <Input type="number" min="0" value={form.minOrderValue} onChange={toNumber('minOrderValue')} />
          </Field>
        </div>

        <div className="row" style={{ gap: 12 }}>
          <Switch label="Live on storefront" checked={form.active} onCheckedChange={(value) => patch('active', value)} />
        </div>
      </form>
    </Modal>
  )
}