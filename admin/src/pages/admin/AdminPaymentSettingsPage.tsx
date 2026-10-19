import { useEffect, useState } from 'react'
import { adminService } from '@/services/adminService'
import { useAdminAuth } from '@/context/AdminAuthContext'
import { useAsync } from '@/hooks'
import { useToast } from '@/context'
import { AdminPageHeader } from '@/components/admin'
import type { PaymentGatewaySettings } from '@/types'
import { Button, Icon, Skeleton } from '@/components/common'
import { Field, Input, Switch } from '@/components/common/form'

const METHOD_LABEL: Record<string, string> = {
  razorpay: 'Razorpay checkout',
  upi: 'UPI',
  card: 'Credit / debit card',
  netbanking: 'Net banking',
}

const CONFIGURATION_STATE: Record<
  NonNullable<PaymentGatewaySettings['configurationState']>,
  { label: string; tone: string; copy: string }
> = {
  disabled: {
    label: 'Online payments off',
    tone: 'is-warning',
    copy: 'Customers will not be offered online payment at checkout.',
  },
  incomplete: {
    label: 'Needs credentials',
    tone: 'is-warning',
    copy: 'Add a key id and key secret, then run the connection test.',
  },
  ready_test: {
    label: 'Ready - Test mode',
    tone: 'is-info',
    copy: 'Online payments are live in Razorpay test mode. No real money moves.',
  },
  ready_live: {
    label: 'Ready - Live mode',
    tone: 'is-success',
    copy: 'Online payments are live and will charge real customers.',
  },
}

export function AdminPaymentSettingsPage() {
  const { can } = useAdminAuth()
  const { push } = useToast()
  const [gateway, setGateway] = useState<PaymentGatewaySettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  const result = useAsync(() => adminService.paymentGateway(), [])

  useEffect(() => {
    if (result.data && !gateway) setGateway(result.data)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.data])

  if (result.loading && !result.data) {
    return (
      <>
        <AdminPageHeader title="Payment settings" description="Razorpay gateway keys and accepted payment methods." />
        <Skeleton style={{ width: '100%', height: 460 }} />
      </>
    )
  }

  if (result.error) {
    return (
      <>
        <AdminPageHeader title="Payment settings" description="Razorpay gateway keys and accepted payment methods." />
        <p className="admin-note admin-note--error">{result.error.message}</p>
      </>
    )
  }

  const form = gateway ?? result.data!

  const set = <K extends keyof PaymentGatewaySettings>(key: K, value: PaymentGatewaySettings[K]) =>
    setGateway((current) => (current ? { ...current, [key]: value } : current))

  const toggleMethod = (method: string) => {
    const methods = form.enabledMethods.includes(method as PaymentGatewaySettings['enabledMethods'][number])
      ? form.enabledMethods.filter((item) => item !== method)
      : [...form.enabledMethods, method as PaymentGatewaySettings['enabledMethods'][number]]
    set('enabledMethods', methods)
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      await adminService.savePaymentGateway(form)
      push({ title: 'Payment settings saved', description: 'Gateway configuration updated.' })
    } catch (caught) {
      push({ title: 'Could not save', description: caught instanceof Error ? caught.message : 'Please try again.', tone: 'danger' })
    } finally {
      setSaving(false)
    }
  }

  const runConnectionTest = async () => {
    setTesting(true)
    try {
      const outcome = await adminService.testPaymentGateway()
      push({
        title: 'Connection test passed',
        description: outcome.message,
      })
    } catch (caught) {
      push({
        title: 'Connection test failed',
        description: caught instanceof Error ? caught.message : 'Razorpay credentials were rejected.',
        tone: 'danger',
      })
    } finally {
      setTesting(false)
    }
  }

  const configurationState = form.configurationState ?? (form.onlineEnabled ? 'incomplete' : 'disabled')
  const statusCopy = CONFIGURATION_STATE[configurationState]

  return (
    <>
      <AdminPageHeader
        title="Payment settings"
        description="Razorpay gateway keys and accepted payment methods."
        actions={
          <span className={`admin-alert ${statusCopy.tone}`} style={{ paddingBlock: 8 }}>
            <Icon name="shield" size={15} />
            <span>{statusCopy.label}</span>
          </span>
        }
      />

      <form className="admin-form" onSubmit={submit} noValidate>
        <section className="admin-card admin-form__section">
          <div className="row row--between" style={{ alignItems: 'center', gap: 16 }}>
            <div>
              <p className="admin-form__section-title" style={{ marginBottom: 4 }}>Online payments</p>
              <p className="admin-note">{statusCopy.copy}</p>
            </div>
            <Switch
              label={form.onlineEnabled ? 'Enabled' : 'Disabled'}
              checked={form.onlineEnabled}
              onCheckedChange={(value) => set('onlineEnabled', value)}
            />
          </div>
          <div className="admin-note" style={{ marginTop: 12 }}>
            {form.updatedAt ? (
              <>
                Last updated {new Date(form.updatedAt).toLocaleString('en-IN')}
                {form.updatedByName || form.updatedByEmail
                  ? ` by ${form.updatedByName || form.updatedByEmail}`
                  : ''}
                .
              </>
            ) : (
              'No saved configuration yet.'
            )}
            {form.credentialError ? (
              <span className="admin-note admin-note--error"> {form.credentialError}</span>
            ) : null}
          </div>
          {form.encryptionKeyConfigured === false && (
            <div className="admin-alert is-warning" style={{ marginTop: 12 }}>
              <Icon name="alert" size={16} />
              <span>
                PAYMENT_CREDENTIALS_ENCRYPTION_KEY is not configured on the server. Add it before
                saving credentials.
              </span>
            </div>
          )}
        </section>

        <section className="admin-card admin-form__section">
          <p className="admin-form__section-title">Gateway keys</p>
          <div className="admin-form__grid">
            <Field label="Key ID" hint="Public key — safe to include in the browser.">
              <Input value={form.razorpayKeyId} onChange={(event) => set('razorpayKeyId', event.target.value)} placeholder="rzp_live_…" />
            </Field>
            <Field label="Key secret" hint="Masked — full value only ever lives on the server. Leave unchanged to keep the current secret.">
              {/* SECURITY: type="password" so a freshly rotated secret is not shown in
                  cleartext on a shared screen or captured by screen sharing. */}
              <Input
                type="password"
                autoComplete="new-password"
                value={form.razorpayKeySecretMasked}
                onChange={(event) => set('razorpayKeySecretMasked', event.target.value)}
              />
            </Field>
            <Field
              label="Webhook secret"
              hint={
                form.webhookConfigured
                  ? 'Stored. Used to verify Razorpay webhook signatures. Leave unchanged to keep the current secret.'
                  : 'Not stored yet. Razorpay callbacks will be rejected until a webhook secret is saved.'
              }
            >
              <Input
                type="password"
                autoComplete="new-password"
                value={form.webhookSecretMasked}
                onChange={(event) => set('webhookSecretMasked', event.target.value)}
              />
            </Field>
            <Field label="Mode">
              <Switch label="Test mode" checked={form.testMode} onCheckedChange={(value) => set('testMode', value)} />
            </Field>
          </div>
        </section>

        <section className="admin-card admin-form__section">
          <p className="admin-form__section-title">Accepted payment methods</p>
          <div className="switch-grid">
            {Object.keys(METHOD_LABEL)
              .filter((method) => method !== 'cod')
              .map((method) => (
                <Switch
                  key={method}
                  label={METHOD_LABEL[method]}
                  checked={form.enabledMethods.includes(method as PaymentGatewaySettings['enabledMethods'][number])}
                  onCheckedChange={() => toggleMethod(method)}
                />
              ))}
          </div>
        </section>

        <section className="admin-card admin-form__section">
          <p className="admin-form__section-title">Cash on delivery</p>
          <div className="row" style={{ gap: 12 }}>
            <Switch label="Accept COD" checked={form.codEnabled} onCheckedChange={(value) => set('codEnabled', value)} />
          </div>
          {form.codEnabled && (
            <Field label="COD order limit (₹)" hint="Orders above this amount must pay online.">
              <Input type="number" min="0" value={form.codLimit} onChange={(event) => set('codLimit', Number(event.target.value))} />
            </Field>
          )}
        </section>

        {!can('settings.update') && (
          <div className="admin-alert is-warning">
            <Icon name="alert" size={16} />
            <span>You have read-only access. Only the owner or admin can change gateway settings.</span>
          </div>
        )}

        <div className="admin-form__foot">
          <Button
            type="button"
            variant="ghost"
            icon="refresh"
            loading={testing}
            disabled={!can('settings.update') || !form.configured}
            onClick={() => void runConnectionTest()}
          >
            Test connection
          </Button>
          <Button type="submit" icon="check" loading={saving} disabled={!can('settings.update')}>
            Save payment settings
          </Button>
        </div>
      </form>
    </>
  )
}