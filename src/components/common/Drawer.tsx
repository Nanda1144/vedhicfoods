import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/utils/cn'
import { useEscapeKey, useFocusFirst, useFocusTrap, useLockBodyScroll } from '@/hooks'
import { Icon } from './Icon'

interface DrawerProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  /** Drawer can be full-height panel or bottom sheet on mobile. */
  side?: 'right' | 'left' | 'bottom'
  className?: string
  footer?: ReactNode
}

export function Drawer({
  open,
  onClose,
  title,
  children,
  side = 'right',
  className,
  footer,
}: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  useLockBodyScroll(open)
  useEscapeKey(onClose, open)
  useFocusFirst(panelRef, open)
  useFocusTrap(panelRef, open)

  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    return () => previouslyFocused?.focus()
  }, [open])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div className={cn('drawer')} role="presentation">
      <div className="drawer__scrim" aria-hidden="true" onMouseDown={onClose} />
      <div
        ref={panelRef}
        className={cn('drawer__panel', `drawer__panel--${side}`, className)}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="drawer__header">
          <h2 className="drawer__title">{title}</h2>
          <button type="button" className="drawer__close icon-btn" onClick={onClose} aria-label={`Close ${title}`}>
            <Icon name="close" size={20} />
          </button>
        </header>
        <div className="drawer__body">{children}</div>
        {footer && <footer className="drawer__footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  )
}