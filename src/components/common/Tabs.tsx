import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from '@/utils/cn'

export interface TabItem {
  id: string
  label: string
  content: ReactNode
  icon?: string
}

interface TabsProps {
  items: TabItem[]
  activeId?: string
  onChange?: (id: string) => void
  variant?: 'underline' | 'pill'
  className?: string
}

export function Tabs({ items, activeId, onChange, variant = 'underline', className }: TabsProps) {
  const generatedId = useId()
  const listRef = useRef<HTMLDivElement>(null)
  const [internal, setInternal] = useState<string | null>(null)
  const active = activeId ?? internal ?? (items[0]?.id ?? '')

  const select = (id: string) => {
    if (onChange) onChange(id)
    else setInternal(id)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = items.findIndex((item) => item.id === active)
    if (index === -1) return
    let next: number | null = null
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % items.length
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length
    if (next === null) return
    event.preventDefault()
    const tab = listRef.current?.querySelector<HTMLButtonElement>(`[data-tab-key="${items[next]!.id}"]`)
    tab?.focus()
    select(items[next]!.id)
  }

  return (
    <div className={cn('tabs', `tabs--${variant}`, className)}>
      <div
        ref={listRef}
        className="tabs__list"
        role="tablist"
        aria-label="Sections"
        onKeyDown={onKeyDown}
      >
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`${generatedId}-tab-${item.id}`}
            aria-selected={active === item.id}
            aria-controls={`${generatedId}-panel-${item.id}`}
            tabIndex={active === item.id ? 0 : -1}
            data-tab-key={item.id}
            className={cn('tabs__tab', active === item.id && 'is-active')}
            onClick={() => select(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div
        id={`${generatedId}-panel-${active}`}
        role="tabpanel"
        aria-labelledby={`${generatedId}-tab-${active}`}
        className="tabs__panel"
      >
        {items.find((item) => item.id === active)?.content}
      </div>
    </div>
  )
}