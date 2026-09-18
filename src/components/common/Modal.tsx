import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/utils/cn'
import { useEscapeKey, useFocusFirst, useFocusTrap, useLockBodyScroll } from '@/hooks'
import { Icon } from './Icon'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  size?: 'sm' | 'md' | 'lg'
  footer?: ReactNode
}

export function Modal({ open, onClose, title, children, size = 'md', footer }: ModalProps) {
  const id = useId()
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
    <div className="modal" role="presentation">
      <div className="modal__scrim" aria-hidden="true" onMouseDown={onClose} />
      <div
        ref={panelRef}
        className={cn('modal__panel', `modal__panel--${size}`)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
      >
        <header className="modal__header">
          <h2 className="modal__title" id={`${id}-title`}>
            {title}
          </h2>
          <button type="button" className="modal__close icon-btn" onClick={onClose} aria-label="Close dialog">
            <Icon name="close" size={20} />
          </button>
        </header>
        <div className="modal__body">{children}</div>
        {footer && <footer className="modal__footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  )
}