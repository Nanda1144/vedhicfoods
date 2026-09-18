import { useMemo, useState } from 'react'
import { adminService } from '@/services/adminService'
import { useAdminAuth } from '@/context/AdminAuthContext'
import { useAdminSettings } from './useAdminSettings'
import { useToast } from '@/context'
import { AdminPageHeader, ConfirmDialog } from '@/components/admin'
import type { WebsiteSettings } from '@/types'
import { Button, Skeleton } from '@/components/common'
import { Field, Input, Switch, Textarea } from '@/components/common/form'

export function AdminSettingsPage() {
  const { settings, loading, persist } = useAdminSettings()
  const { session, can } = useAdminAuth()
  const { push } = useToast()
  const [form, setForm] = useState<WebsiteSettings | null>(settings)
  const [saving, setSaving] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)

  const visible = form ?? settings

  const update = <K extends keyof WebsiteSettings>(key: K, value: WebsiteSettings[K]) =>
    setForm((current) => (current ? { ...current, [key]: value } : current))

  const dirty = useMemo(() => settings && form && JSON.stringify(settings) !== JSON.stringify(form), [settings, form])

  if (loading && !settings) {
    return (
      <>
        <AdminPageHeader title="Website settings" description="Storefront basics, business info and notifications." />
        <Skeleton style={{ width: '100%', height: 480 }} />
      </>
    )
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!visible) return
    setSaving(true)
    try {
      await persist({
        brandName: visible.brandName,
        tagline: visible.tagline,
        taxRate: Number(visible.taxRate),
        gstin: visible.gstin,
        freeShippingThreshold: Number(visible.freeShippingThreshold),
        standardShippingFee: Number(visible.standardShippingFee),
        announcement: visible.announcement,
        announcementActive: visible.announcementActive,
        businessHours: visible.businessHours,
        supportEmail: visible.supportEmail,
        supportPhone: visible.supportPhone,
      })
      push({ title: 'Settings saved', description: 'Storefront settings are up to date.' })
    } catch (caught) {
      push({ title: 'Could not save', description: caught instanceof Error ? caught.message : 'Please try again.', tone: 'danger' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <AdminPageHeader title="Website settings" description="Storefront basics, business info and notifications." />

      <form className="admin-form" onSubmit={submit} noValidate>
        <section className="admin-card admin-form__section">
          <p className="admin-form__section-title">Brand basics</p>
          <div className="admin-form__grid">
            <Field label="Business name">
              <Input value={visible.brandName} onChange={(event) => update('brandName', event.target.value)} />
            </Field>
            <Field label="Tagline">
              <Input value={visible.tagline} onChange={(event) => update('tagline', event.target.value)} />
            </Field>
            <Field label="GSTIN">
              <Input value={visible.gstin} onChange={(event) => update('gstin', event.target.value)} placeholder="29ABCDE1234F1Z5" />
            </Field>
            <Field label="Currency" hint="Fixed to the INR storefront for now.">
              <Input value="INR (₹)" disabled />
            </Field>
          </div>
        </section>

        <section className="admin-card admin-form__section">
          <p className="admin-form__section-title">Orders & pricing</p>
          <div className="admin-form__grid">
            <Field label="Free shipping threshold (₹)">
              <Input type="number" min="0" value={visible.freeShippingThreshold} onChange={(event) => update('freeShippingThreshold', Number(event.target.value))} />
            </Field>
            <Field label="Standard shipping fee (₹)">
              <Input type="number" min="0" step="0.01" value={visible.standardShippingFee} onChange={(event) => update('standardShippingFee', Number(event.target.value))} />
            </Field>
            <Field label="Tax rate (%)">
              <Input type="number" min="0" step="0.01" value={visible.taxRate} onChange={(event) => update('taxRate', Number(event.target.value))} />
            </Field>
          </div>
        </section>

        <section className="admin-card admin-form__section">
          <p className="admin-form__section-title">Announcement strip</p>
          <div className="row" style={{ gap: 12 }}>
            <Switch label="Show announcement bar" checked={visible.announcementActive} onCheckedChange={(value) => update('announcementActive', value)} />
          </div>
          <Field label="Announcement text">
            <Textarea rows={2} value={visible.announcement} onChange={(event) => update('announcement', event.target.value)} />
          </Field>
        </section>

        <section className="admin-card admin-form__section">
          <p className="admin-form__section-title">Operating hours</p>
          <Field label="Business hours">
            <Input value={visible.businessHours} onChange={(event) => update('businessHours', event.target.value)} placeholder="Mon–Sat, 9:00 AM – 6:00 PM" />
          </Field>
        </section>

        <section className="admin-card admin-form__section">
          <p className="admin-form__section-title">Danger zone</p>
          <p className="admin-muted" style={{ margin: 0 }}>
            Reset all admin demo data back to the seed. Useful for re-running the owner walkthrough.
          </p>
          {can('staff:write') && (
            <div>
              <Button variant="danger" icon="refresh" onClick={() => setResetOpen(true)}>
                Reset demo data
              </Button>
            </div>
          )}
        </section>

        <div className="admin-form__foot">
          <Button variant="ghost" onClick={() => setForm(settings)} disabled={!dirty}>
            Discard
          </Button>
          <Button type="submit" icon="check" loading={saving} disabled={!dirty}>
            Save settings
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={resetOpen}
        title="Reset demo data?"
        message="All admin changes (products, discounts, staff, tickets…) return to the factory seed. Signed-in staff accounts keep working."
        confirmLabel="Reset data"
        tone="danger"
        loading={saving}
        onConfirm={async () => {
          setSaving(true)
          try {
            await adminService.resetData()
            push({ title: 'Demo data reset', description: 'The admin store is back to its seed state.' })
            window.location.reload()
          } finally {
            setSaving(false)
          }
        }}
        onClose={() => setResetOpen(false)}
      />
    </>
  )
}