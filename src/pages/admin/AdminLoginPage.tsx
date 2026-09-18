import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { adminAuthService } from '@/services/adminAuthService'
import { useToast } from '@/context'
import { Logo, Icon, Button } from '@/components/common'
import { Input, Switch } from '@/components/common/form'

const OWNER_EMAIL = 'vedhi@vedhifoods.example'

export function AdminLoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { push } = useToast()
  const [email, setEmail] = useState(OWNER_EMAIL)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [forgotOpen, setForgotOpen] = useState(false)
  const [resetEmail, setResetEmail] = useState('')
  const [resetDone, setResetDone] = useState(false)
  const [resetError, setResetError] = useState('')

  if (adminAuthService.isAuthenticated()) {
    return <Navigate to="/admin" replace />
  }

  const from = (location.state as { from?: string } | null)?.from

  const fillDemo = () => {
    setEmail(OWNER_EMAIL)
    setPassword(adminAuthService.DEMO_PASSWORD)
    setForgotOpen(false)
    setResetDone(false)
    setError('')
  }

  const submit = async (event: { preventDefault: () => void }) => {
    event.preventDefault()
    if (!email.trim() || !password) {
      setError('Enter both your email and password.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await adminAuthService.login(email.trim(), password, remember)
      push({ title: 'Welcome back', description: 'You are signed in to the admin console.' })
      navigate(from || '/admin', { replace: true })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Sign in failed. Please try again.')
      setBusy(false)
    }
  }

  const requestReset = async (event: { preventDefault: () => void }) => {
    event.preventDefault()
    setResetError('')
    setBusy(true)
    try {
      await adminAuthService.forgotPassword(resetEmail)
      setResetDone(true)
      push({ title: 'Reset link sent', description: 'Check your inbox for steps to reset your password.' })
    } catch (caught) {
      setResetError(caught instanceof Error ? caught.message : 'Could not send reset link.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="admin-login">
      <div className="admin-login__panel">
        <Logo size="sm" to="/admin/login" />
        <h1>Admin console</h1>
        <p className="admin-login__sub">Sign in to manage products, orders and the storefront.</p>

        {!forgotOpen ? (
          <form className="admin-login__form" onSubmit={submit} noValidate>
            <Input
              label="Email address"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoComplete="username"
              placeholder="you@vedhifoods.example"
            />
            <div className="field">
              <Input
                label="Password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                autoComplete="current-password"
placeholder="••••••••"
              />
            </div>

            <div className="admin-login__row">
              <Switch label="Remember me" checked={remember} onCheckedChange={setRemember} />
              <button
                type="button"
                className="admin-login__link"
                onClick={() => {
                  setForgotOpen(true)
                  setResetEmail(email)
                  setResetError('')
                  setResetDone(false)
                }}
              >
                Forgot password?
              </button>
            </div>

            {error && (
              <div className="admin-alert is-danger" role="alert">
                <Icon name="alert" size={16} />
                <span>{error}</span>
              </div>
            )}

            <Button type="submit" fullWidth size="lg" iconRight="arrow-right" loading={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        ) : (
          <form className="admin-login__form" onSubmit={requestReset} noValidate>
            <p className="admin-muted" style={{ marginTop: 0 }}>
              Enter your staff email and we’ll send a reset link. (Prototype preview — no email is actually sent.)
            </p>
            <Input
              label="Email address"
              type="email"
              value={resetEmail}
              onChange={(event) => setResetEmail(event.target.value)}
              required
              autoComplete="email"
              placeholder="you@vedhifoods.example"
            />
            {resetDone && (
              <div className="admin-alert is-success" role="status">
                <Icon name="check-circle" size={16} />
                <span>Reset link sent to {resetEmail}.</span>
              </div>
            )}
            {resetError && (
              <div className="admin-alert is-danger" role="alert">
                <Icon name="alert" size={16} />
                <span>{resetError}</span>
              </div>
            )}
            <Button type="submit" fullWidth size="lg" loading={busy}>
              Send reset link
            </Button>
            <button type="button" className="admin-login__back" onClick={() => setForgotOpen(false)}>
              <Icon name="arrow-left" size={15} /> Back to sign in
            </button>
          </form>
        )}

        <div className="admin-login__creds">
          <p className="admin-login__creds-title">Demo credentials</p>
          <dl className="admin-login__creds-row">
            <div>
              <dt>Owner</dt>
              <dd>{OWNER_EMAIL}</dd>
            </div>
            <div>
              <dt>All staff</dt>
              <dd>{adminAuthService.DEMO_PASSWORD}</dd>
            </div>
          </dl>
          <button type="button" className="admin-login__creds-fill" onClick={fillDemo}>
            <Icon name="sparkles" size={13} /> Fill demo credentials
          </button>
        </div>

        <a href="/" className="admin-login__back">
          <Icon name="arrow-left" size={15} /> Back to storefront
        </a>
      </div>
    </main>
  )
}
