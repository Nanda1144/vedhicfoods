import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useLockBodyScroll } from '@/hooks/useLockBodyScroll'
import { TOAST_DURATIONS } from '@/constants'
import type { StatusTone } from '@/types'

export interface ToastDraft {
  title: string
  description?: string
  tone?: StatusTone
  duration?: number
}

export interface ToastItem extends Required<Pick<ToastDraft, 'title' | 'tone'>> {
  id: number
  description?: string
  duration: number
}

interface ToastContextValue {
  toasts: ToastItem[]
  push: (draft: ToastDraft) => number
  dismiss: (id: number) => void
  clear: () => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

let toastId = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const timers = useRef<Record<number, number>>({})

  const clearTimer = useCallback((id: number) => {
    if (timers.current[id] !== undefined) {
      window.clearTimeout(timers.current[id])
      delete timers.current[id]
    }
  }, [])

  const dismiss = useCallback(
    (id: number) => {
      clearTimer(id)
      setToasts((current) => current.filter((toast) => toast.id !== id))
    },
    [clearTimer],
  )

  const push = useCallback(
    (draft: ToastDraft) => {
      const id = ++toastId
      const tone = draft.tone ?? 'success'
      const duration =
        draft.duration ??
        (tone === 'danger' ? TOAST_DURATIONS.long : TOAST_DURATIONS.normal)
      const toast: ToastItem = {
        id,
        title: draft.title,
        description: draft.description,
        tone,
        duration,
      }
      setToasts((current) => [...current, toast])
      if (draft.tone !== 'danger') {
        timers.current[id] = window.setTimeout(() => dismiss(id), duration)
      }
      return id
    },
    [dismiss],
  )

  const clear = useCallback(() => {
    for (const id of Object.keys(timers.current)) clearTimer(Number(id))
    setToasts([])
  }, [clearTimer])

  const value = useMemo(
    () => ({ toasts, push, dismiss, clear }),
    [toasts, push, dismiss, clear],
  )

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used within a ToastProvider')
  return context
}

/** Grounded below the app chrome so navigation never loses its position. */
export function ToastViewport() {
  const { toasts, dismiss } = useToast()
  useLockBodyScroll(false)

  return (
    <div className="toast-viewport" role="region" aria-label="Notifications" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast toast--${toast.tone}`}
          role={toast.tone === 'danger' ? 'alert' : 'status'}
        >
          <div className="toast__body">
            <p className="toast__title">{toast.title}</p>
            {toast.description && <p className="toast__desc">{toast.description}</p>}
          </div>
          <button
            type="button"
            className="toast__dismiss"
            onClick={() => dismiss(toast.id)}
            aria-label="Dismiss notification"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}