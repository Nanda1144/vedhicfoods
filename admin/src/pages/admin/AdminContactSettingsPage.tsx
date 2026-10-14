import { useEffect, useState } from 'react'
import { useAdminSettings } from './useAdminSettings'
import { useToast } from '@/context'
import { AdminPageHeader } from '@/components/admin'
import type { SocialLink, WebsiteSettings } from '@/types'
import { Button, Skeleton } from '@/components/common'
import { Field, Input } from '@/components/common/form'

const PLATFORM_LABEL: Record<SocialLink['platform'], string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  youtube: 'YouTube',
  x: 'X (Twitter)',
  linkedin: 'LinkedIn',
}

export function AdminContactSettingsPage() {
  const { settings, loading, persist } = useAdminSettings()
  const { push } = useToast()
  const [form, setForm] = useState<WebsiteSettings | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (settings && !form) setForm(settings)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings])

  if (loading && !settings) {
    return (
      <>
        <AdminPageHeader title="Contact details" description="Phone, email, WhatsApp and address shown across the site." />
        <Skeleton style={{ width: '100%', height: 420 }} />
      </>
    )
  }

  const visible = form ?? settings!

  const set = <K extends keyof WebsiteSettings>(key: K, value: WebsiteSettings[K]) =>
    setForm((current) => (current ? { ...current, [key]: value } : current))

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      await persist({
        supportEmail: visible.supportEmail,
        supportPhone: visible.supportPhone,
        whatsapp: visible.whatsapp,
        addressLine: visible.addressLine,
        city: visible.city,
        state: visible.state,
        pincode: visible.pincode,
        businessHours: visible.businessHours,
        socials: visible.socials,
      })
      push({ title: 'Contact details saved', description: 'The Contact page now reflects these details.' })
    } catch (caught) {
      push({ title: 'Could not save', description: caught instanceof Error ? caught.message : 'Please try again.', tone: 'danger' })
    } finally {
      setSaving(false)
    }
  }

  const updateSocial = (platform: SocialLink['platform'], href: string) => {
    const socials = [...visible.socials]
    const index = socials.findIndex((link) => link.platform === platform)
    if (index >= 0) socials[index] = { ...socials[index], href }
    else socials.push({ platform, label: PLATFORM_LABEL[platform], href })
    set('socials', socials)
  }

  return (
    <>
      <AdminPageHeader title="Contact details" description="Phone, email, WhatsApp and address shown across the site." />

      <form className="admin-form" onSubmit={submit} noValidate>
        <section className="admin-card admin-form__section">
          <p className="admin-form__section-title">Support channels</p>
          <div className="admin-form__grid">
            <Field label="Support email">
              <Input type="email" value={visible.supportEmail} onChange={(event) => set('supportEmail', event.target.value)} />
            </Field>
            <Field label="Support phone">
              <Input type="tel" value={visible.supportPhone} onChange={(event) => set('supportPhone', event.target.value)} />
            </Field>
            <Field label="WhatsApp number" hint="Used for the wa.me quick-chat button.">
              <Input value={visible.whatsapp} onChange={(event) => set('whatsapp', event.target.value)} placeholder="+91 98450 00000" />
            </Field>
            <Field label="Business hours">
              <Input value={visible.businessHours} onChange={(event) => set('businessHours', event.target.value)} />
            </Field>
          </div>
        </section>

        <section className="admin-card admin-form__section">
          <p className="admin-form__section-title">Store address</p>
          <div className="admin-form__grid">
            <Field label="Address line">
              <Input value={visible.addressLine} onChange={(event) => set('addressLine', event.target.value)} />
            </Field>
            <Field label="City">
              <Input value={visible.city} onChange={(event) => set('city', event.target.value)} />
            </Field>
            <Field label="State">
              <Input value={visible.state} onChange={(event) => set('state', event.target.value)} />
            </Field>
            <Field label="Pincode">
              <Input value={visible.pincode} onChange={(event) => set('pincode', event.target.value)} />
            </Field>
          </div>
        </section>

        <section className="admin-card admin-form__section">
          <p className="admin-form__section-title">Social profiles</p>
          <div className="admin-form__grid">
            {(Object.keys(PLATFORM_LABEL) as SocialLink['platform'][]).map((platform) => {
              const link = visible.socials.find((social) => social.platform === platform)
              return (
                <Field key={platform} label={PLATFORM_LABEL[platform]}>
                  <Input
                    value={link?.href ?? ''}
                    onChange={(event) => updateSocial(platform, event.target.value)}
                    placeholder={`https://${platform}.com/your-page`}
                  />
                </Field>
              )
            })}
          </div>
        </section>

        <div className="admin-form__foot">
          <Button type="submit" icon="check" loading={saving}>
            Save contact details
          </Button>
        </div>
      </form>
    </>
  )
}