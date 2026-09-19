import { useState } from 'react'
import { adminService } from '@/services/adminService'
import { useAdminAuth } from '@/context/AdminAuthContext'
import { useAsync } from '@/hooks'
import { useToast } from '@/context'
import { formatDate } from '@/utils/format'
import { AdminPageHeader, ConfirmDialog, AdminToolbar } from '@/components/admin'
import type { Promotion } from '@/types'
import { Badge, Button, Icon, Modal, Skeleton } from '@/components/common'
import { Field, Input, Switch, Textarea } from '@/components/common/form'

type Placement = Promotion['placement']

const PLACEMENT_META: Record<Placement, { label: string; icon: string }> = {
  hero: { label: 'Homepage hero banner', icon: 'home' },
  strip: { label: 'Announcement strip', icon: 'check' },
  popup: { label: 'Sitewide popup', icon: 'sparkles' },
  collection: { label: 'Collection badge', icon: 'grid' },
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
    return !query || `${promotion.title} ${promotion.subtitle} ${promotion.placement}`.toLowerCase().includes(query)
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
          can('promotions:write') && (
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
          const meta = PLACEMENT_META[promotion.placement]
          return (
            <article key={promotion.id} className={`promo-card${promotion.active ? '' : ' is-off'}`}>
              <header className="promo-card__head">
                <span className="promo-card__placement">
                  <Icon name={meta.icon as keyof typeof Icon} size={15} />
                  {meta.label}
                </span>
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
                  {can('promotions:write') && (
                    <Button size="sm" variant="ghost" icon="edit" onClick={() => setEditing(promotion)}>
                      Edit
                    </Button>
                  )}
                  {can('promotions:write') && (
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
    placement: promotion?.placement ?? ('hero' as Placement),
    ctaLabel: promotion?.ctaLabel ?? '',
    ctaHref: promotion?.ctaHref ?? '/shop',
    active: promotion?.active ?? true,
  })
  const [saving, setSaving] = useState(false)

  const patch = (key: keyof typeof form, value: unknown) => setForm((current) => ({ ...current, [key]: value }))

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      const payload = {
        title: form.title,
        subtitle: form.subtitle,
        placement: form.placement,
        ctaLabel: form.ctaLabel.trim(),
        ctaHref: form.ctaHref.trim() || '/shop',
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
          <p className="admin-form__section-title">Placement</p>
          <div className="radio-grid">
            {(Object.keys(PLACEMENT_META) as Placement[]).map((placement) => (
              <label
                key={placement}
                className={`placement-card${form.placement === placement ? ' is-selected' : ''}`}
              >
                <input
                  type="radio"
                  name="placement"
                  value={placement}
                  checked={form.placement === placement}
                  onChange={() => patch('placement', placement)}
                />
                <Icon name={PLACEMENT_META[placement].icon as keyof typeof Icon} size={16} />
                <span>{PLACEMENT_META[placement].label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="admin-form__grid">
          <Field label="Button label">
            <Input value={form.ctaLabel} onChange={(event) => patch('ctaLabel', event.target.value)} placeholder="Shop now" />
          </Field>
          <Field label="Button link" hint="Where this button takes shoppers — the page it opens when clicked. Optional: leave blank to link to the /shop page.">
            <Input value={form.ctaHref} onChange={(event) => patch('ctaHref', event.target.value)} placeholder="/shop" />
          </Field>
        </div>

        <div className="row" style={{ gap: 12 }}>
          <Switch label="Live on storefront" checked={form.active} onCheckedChange={(value) => patch('active', value)} />
        </div>
      </form>
    </Modal>
  )
}