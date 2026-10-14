import { useId, useState, type ReactNode } from 'react'
import { cn } from '@/utils/cn'
import { Icon } from './Icon'

export interface AccordionItem {
  id: string
  label: string
  content: ReactNode
}

interface AccordionProps {
  items: AccordionItem[]
  /** One open accordion at a time when true (like an FAQ). */
  exclusive?: boolean
  defaultOpenId?: string
  className?: string
}

export function Accordion({ items, exclusive = true, defaultOpenId, className }: AccordionProps) {
  const uid = useId()
  const [openIds, setOpenIds] = useState<Set<string>>(() =>
    new Set(defaultOpenId ? [defaultOpenId] : []),
  )

  const isOpen = (id: string) => openIds.has(id)

  const toggle = (id: string) => {
    setOpenIds((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
      } else if (exclusive) {
        return new Set([id])
      } else {
        next.add(id)
      }
      return next
    })
  }

  return (
    <div className={cn('accordion', className)}>
      {items.map((item) => {
        const open = isOpen(item.id)
        return (
          <div className={cn('accordion__item', open && 'is-open')} key={item.id}>
            <h3 className="accordion__header">
              <button
                type="button"
                className="accordion__trigger"
                aria-expanded={open}
                aria-controls={`${uid}-panel-${item.id}`}
                id={`${uid}-trigger-${item.id}`}
                onClick={() => toggle(item.id)}
              >
                <span className="accordion__label">{item.label}</span>
                <Icon name="chevron-down" size={20} className="accordion__icon" />
              </button>
            </h3>
            <div
              id={`${uid}-panel-${item.id}`}
              role="region"
              aria-labelledby={`${uid}-trigger-${item.id}`}
              className="accordion__panel"
              hidden={!open}
            >
              <div className="accordion__content">{item.content}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}