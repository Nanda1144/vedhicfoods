import { useState } from 'react'
import { contactService, contentService } from '@/services/contentService'
import { useAsync } from '@/hooks'
import { useToast, useSettings } from '@/context'
import { isEmail, isPhoneIN, required, validate } from '@/utils/validators'
import { PageHeader, Input, Textarea, Select, Button, Icon, FaqSection } from '@/components/common'

interface ContactForm {
  name: string
  email: string
  phone: string
  topic: string
  message: string
}

const EMPTY: ContactForm = { name: '', email: '', phone: '', topic: '', message: '' }

type ContactErrors = Partial<Record<keyof ContactForm, string>>

export function ContactPage() {
  const { push } = useToast()
  const { settings } = useSettings()
  const topics = useAsync(() => contentService.contactTopics(), [])
  const [form, setForm] = useState<ContactForm>(EMPTY)
  const [errors, setErrors] = useState<ContactErrors>({})
  const [busy, setBusy] = useState(false)
  const [ticketId, setTicketId] = useState<string | null>(null)

  const patch = (part: Partial<ContactForm>) => setForm((current) => ({ ...current, ...part }))

  const submit = async (event: { preventDefault: () => void }) => {
    event.preventDefault()
    const next: ContactErrors = {}
    const set = (key: keyof ContactForm, result: ReturnType<typeof validate>) => {
      if (!result.valid) next[key] = result.error
    }
    set('name', validate(required(form.name, 'Name')))
    set('email', validate(required(form.email, 'Email'), isEmail(form.email)))
    set('phone', validate(required(form.phone, 'Mobile number'), isPhoneIN(form.phone)))
    set('message', validate(required(form.message, 'Message')))
    setErrors(next)
    if (Object.keys(next).length > 0) return

    setBusy(true)
    try {
      const result = await contactService.submit({ ...form, topic: effectiveTopic })
      setTicketId(result.ticketId)
      push({ title: 'Message sent', description: `Reference ${result.ticketId} — we reply within 24 hours.` })
      setForm(EMPTY)
    } finally {
      setBusy(false)
    }
  }

  const topicOptions = topics.data ?? []
  const effectiveTopic = form.topic || topicOptions[0] || ''
  const patchTopic = (event: { target: { value: string } }) => {
    patch({ topic: event.target.value })
    if (errors.topic) setErrors((current) => ({ ...current, topic: undefined }))
  }

  return (
    <>
      <PageHeader
        eyebrow="Say hello"
        title="Contact us"
        description="Orders, wholesale, gifting or just a recipe question — we read every message."
        align="center"
      />

      <section className="section">
        <div className="container">
          <div className="contact-info">
            {[
              { icon: 'phone' as const, title: 'Call us', copy: settings.supportPhone, sub: settings.businessHours, href: `tel:${settings.supportPhone.replace(/\s/g, '')}` },
              { icon: 'mail' as const, title: 'Email', copy: settings.supportEmail, sub: 'Replies within 24 hours', href: `mailto:${settings.supportEmail}` },
              { icon: 'whatsapp' as const, title: 'WhatsApp', copy: settings.whatsapp, sub: 'Chat with the kitchen team', href: `https://wa.me/${settings.whatsapp.replace(/[^\d]/g, '')}` },
              { icon: 'clock' as const, title: 'Working hours', copy: settings.businessHours, sub: 'Orders processed Mon – Sat', href: undefined },
              { icon: 'map-pin' as const, title: 'Visit the kitchen', copy: `${settings.addressLine}, ${settings.city}`, sub: 'By appointment only', href: undefined },
            ].map((card) => {
              const inner = (
                <>
                  <span className="contact-card__icon">
                    <Icon name={card.icon} size={19} />
                  </span>
                  <span>
                    <strong>{card.title}</strong>
                    <span className="contact-card__copy">{card.copy}</span>
                    <span className="contact-card__sub">{card.sub}</span>
                  </span>
                </>
              )
              return card.href ? (
                <a key={card.title} href={card.href} className="contact-card">
                  {inner}
                </a>
              ) : (
                <div key={card.title} className="contact-card">
                  {inner}
                </div>
              )
            })}
          </div>

          <div className="contact-map" role="img" aria-label="Map showing Vedhi Foods farm & kitchen location">
            <Icon name="map-pin" size={22} />
            <strong>{settings.addressLine}, {settings.city}</strong>
            <span>Pincode {settings.pincode}</span>
            <span className="contact-map__hint">Map view replaces this placeholder on go-live</span>
          </div>

          <div className="contact-form-wrap">
            {ticketId && (
              <div className="contact-ticket">
                <Icon name="check-circle" size={16} />
                Your reference: <strong>{ticketId}</strong> — track it in your email.
              </div>
            )}

            <form className="contact-form" onSubmit={submit} noValidate>
              <h2 className="address-form__title">Send a message</h2>
              <div className="grid grid--2">
                <Input label="Name" value={form.name} onChange={(event) => patch({ name: event.target.value })} error={errors.name} required autoComplete="name" />
                <Input label="Mobile number" type="tel" value={form.phone} onChange={(event) => patch({ phone: event.target.value })} error={errors.phone} required autoComplete="tel" />
              </div>
              <Input label="Email address" type="email" value={form.email} onChange={(event) => patch({ email: event.target.value })} error={errors.email} required autoComplete="email" />
              <Select
                label="What's this about?"
                options={topicOptions.map((topic) => ({ label: topic, value: topic }))}
                value={effectiveTopic}
                onChange={patchTopic}
              />
              <Textarea label="Message" rows={5} value={form.message} onChange={(event) => patch({ message: event.target.value })} error={errors.message} placeholder="Tell us a little about what you need…" required />
              <Button type="submit" size="lg" iconRight="arrow-right" loading={busy} fullWidth>
                {busy ? 'Sending…' : 'Send message'}
              </Button>
            </form>
          </div>
        </div>
      </section>

      <section className="section section--alt">
        <div className="container">
          <FaqSection
            eyebrow="Before you reach out"
            title="Quick answers, first"
            description="Shipping, returns and payment queries are often answered in minutes — right here."
            align="center"
          />
        </div>
      </section>
    </>
  )
}