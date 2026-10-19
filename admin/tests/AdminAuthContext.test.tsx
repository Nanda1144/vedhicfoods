// @vitest-environment jsdom
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminAuthProvider, useAdminAuth } from '@/context/AdminAuthContext'

/**
 * Regression coverage for the admin console hanging on
 * "Restoring your session…" forever.
 *
 * Root cause: the session-validation effect was guarded by a `useRef` "already
 * ran" flag. React's `<StrictMode>` deliberately double-invokes effects in
 * development (mount -> cleanup -> mount) to surface exactly this class of bug,
 * and a ref is *not* reset between those two invocations. So the second run hit
 * the guard, returned early, and never reached `setLoading(false)`. The loading
 * state was therefore never cleared and the console rendered its boot
 * placeholder indefinitely.
 *
 * These tests run under jsdom with `react-dom/client` so the real effect
 * scheduling — including StrictMode's double invocation — is exercised rather
 * than approximated.
 */

const SESSION = {
  id: 'usr_1',
  name: 'Vedhic Krishnan',
  email: 'vedhic@vedhifoods.example',
  role: 'owner' as const,
  title: 'Owner',
  permissions: [] as string[],
  token: 'token-abc',
  remember: true,
  signedInAt: new Date(0).toISOString(),
}

const authService = vi.hoisted(() => ({
  session: vi.fn(),
  validateSession: vi.fn(),
  logout: vi.fn(),
  can: vi.fn(() => true),
  login: vi.fn(),
}))

vi.mock('@/services/adminAuthService', () => ({
  adminAuthService: authService,
}))

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

/** Renders the provider and captures what the consumer sees. */
function renderConsole() {
  const seen: { session: unknown; loading: boolean }[] = []

  function Probe() {
    const { session, loading } = useAdminAuth()
    seen.push({ session, loading })
    return null
  }

  act(() => {
    root.render(
      <StrictMode>
        <AdminAuthProvider>
          <Probe />
        </AdminAuthProvider>
      </StrictMode>,
    )
  })

  return seen
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  authService.session.mockReset()
  authService.validateSession.mockReset()
  authService.logout.mockReset()
  authService.can.mockReset()
  authService.can.mockReturnValue(true)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('AdminAuthProvider session restoration', () => {
  it('clears loading after validation resolves under StrictMode', async () => {
    authService.session.mockReturnValue(SESSION)
    let release: (value: unknown) => void = () => {}
    authService.validateSession.mockReturnValue(
      new Promise(resolve => {
        release = resolve
      }),
    )

    const seen = renderConsole()

    // Still validating — the console shows its placeholder.
    expect(seen.some(s => s.loading === true)).toBe(true)

    await act(async () => {
      release(SESSION)
    })

    // THE REGRESSION: this was never reached, because the StrictMode remount
    // short-circuited on the ref guard and `loading` stayed true forever.
    expect(seen.at(-1)?.loading).toBe(false)
    expect(seen.at(-1)?.session).toBeTruthy()
  })

  it('preserves the session when validation fails during a transient outage', async () => {
    authService.session.mockReturnValue(SESSION)
    authService.validateSession.mockRejectedValue(new Error('network down'))

    const seen = renderConsole()
    await act(async () => {})

    expect(seen.at(-1)?.loading).toBe(false)
    // The API still enforces permissions; a network failure must not discard
    // the refresh-cookie session before the service can be reached again.
    expect(seen.at(-1)?.session).toEqual(SESSION)
    expect(authService.logout).not.toHaveBeenCalled()
  })

  it('clears loading when the server downgrades the session to null', async () => {
    authService.session.mockReturnValue(SESSION)
    authService.validateSession.mockResolvedValue(null)

    const seen = renderConsole()
    await act(async () => {})

    expect(seen.at(-1)?.loading).toBe(false)
    expect(seen.at(-1)?.session).toBeNull()
    expect(authService.logout).toHaveBeenCalled()
  })

  it('does not call the API at all when there is no stored session', async () => {
    authService.session.mockReturnValue(null)

    const seen = renderConsole()
    await act(async () => {})

    expect(authService.validateSession).not.toHaveBeenCalled()
    expect(seen.at(-1)?.loading).toBe(false)
    expect(seen.at(-1)?.session).toBeNull()
  })

  it('is not permanently loading even if the API promise resolves late', async () => {
    authService.session.mockReturnValue(SESSION)
    authService.validateSession.mockResolvedValue(SESSION)

    const seen = renderConsole()
    await act(async () => {})

    expect(seen.some(s => s.loading === true)).toBe(true)
    expect(seen.at(-1)?.loading).toBe(false)
  })
})
