import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { adminAuthService } from '@/services/adminAuthService'
import { useAdminAuth } from '@/context/AdminAuthContext'
import { useToast } from '@/context'
import { AdminPageHeader } from '@/components/admin'
import { Badge, Button, Icon } from '@/components/common'
import { Field, Input } from '@/components/common/form'
import { formatDateTime } from '@/utils/format'

export function AdminSecurityPage() {
  const { session, logout } = useAdminAuth()
  const navigate = useNavigate()
  const { push } = useToast()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    if (next.length < 8) {
      setError('New password must be at least 8 characters.')
      return
    }
    if (next !== confirm) {
      setError('New passwords do not match.')
      return
    }
    setBusy(true)
    try {
      await adminAuthService.changePassword(current, next)
      push({ title: 'Password changed', description: 'Use the new password next time you sign in.' })
      setCurrent('')
      setNext('')
      setConfirm('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not change password.')
    } finally {
      setBusy(false)
    }
  }

  const signOutEverywhere = () => {
    logout()
    navigate('/admin/login')
  }

  return (
    <>
      <AdminPageHeader title="Security" description="Change your password and review your session." />

      <div className="admin-grid admin-grid--2" style={{ marginBottom: 16 }}>
        <section className="admin-card">
          <header className="admin-card__head">
            <h2>Your session</h2>
          </header>
          <dl className="detail-grid">
            <dt>Name</dt>
            <dd>{session?.name}</dd>
            <dt>Role</dt>
            <dd>
              {session?.role}{' '}
              {session?.isOwner && <Badge tone="accent" dot>Owner</Badge>}
            </dd>
            <dt>Email</dt>
            <dd>{session?.email}</dd>
            <dt>Signed in</dt>
            <dd>{session ? formatDateTime(session.signedInAt) : '—'}</dd>
            <dt>Session</dt>
            <dd>{session?.remember ? 'Persistent (this device)' : 'Temporary'}</dd>
          </dl>
        </section>

        <section className="admin-card">
          <header className="admin-card__head">
            <h2>Protections</h2>
          </header>
          <ul className="precise-list">
            <li>
              <Icon name="check" size={13} /> Passwords hashed on the server (never stored plain-text)
            </li>
            <li>
              <Icon name="check" size={13} /> Suspended accounts lose access instantly
            </li>
            <li>
              <Icon name="check" size={13} /> Every sign-in and change is written to the audit log
            </li>
            <li>
              <Icon name="check" size={13} /> Permissions enforced on API calls in production
            </li>
          </ul>
          {session && (
            <Button variant="danger" size="sm" icon="logout" onClick={signOutEverywhere}>
              Sign out on this device
            </Button>
          )}
        </section>
      </div>

      <section className="admin-card">
        <header className="admin-card__head">
          <h2>Change password</h2>
          <span className="admin-card__hint">prototype — shared demo password</span>
        </header>
        <form className="admin-form" onSubmit={submit} noValidate style={{ maxWidth: 480 }}>
          <Field label="Current password" required>
            <Input
              type={show ? 'text' : 'password'}
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
              required
              autoComplete="current-password"
              suffix={
                <button type="button" className="input-suffix-btn" aria-label="Show passwords" onClick={() => setShow((s) => !s)}>
                  <Icon name={show ? 'eye-off' : 'eye'} size={17} />
                </button>
              }
            />
          </Field>
          <Field label="New password" required hint="Minimum 8 characters.">
            <Input type={show ? 'text' : 'password'} value={next} onChange={(event) => setNext(event.target.value)} required autoComplete="new-password" />
          </Field>
          <Field label="Confirm new password" required>
            <Input type={show ? 'text' : 'password'} value={confirm} onChange={(event) => setConfirm(event.target.value)} required autoComplete="new-password" />
          </Field>
          {error && (
            <div className="admin-alert is-danger">
              <Icon name="alert" size={16} />
              <span>{error}</span>
            </div>
          )}
          <div className="row" style={{ gap: 8 }}>
            <Button type="submit" icon="check" loading={busy}>
              Change password
            </Button>
          </div>
        </form>
      </section>
    </>
  )
}