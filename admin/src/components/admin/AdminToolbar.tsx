import type { ReactNode } from 'react'
import { Icon, Button } from '../common'
import { Input } from '../common/form'

interface ToolbarFilter {
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
}

interface AdminToolbarProps {
  search: string
  onSearch: (value: string) => void
  searchPlaceholder?: string
  filters?: ToolbarFilter[]
  children?: ReactNode
}

export function AdminToolbar({ search, onSearch, searchPlaceholder = 'Search…', filters, children }: AdminToolbarProps) {
  return (
    <div className="admin-toolbar">
      <div className="admin-toolbar__search">
        <Input
          type="search"
          placeholder={searchPlaceholder}
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          icon="search"
          aria-label={searchPlaceholder}
        />
      </div>
      {filters?.map((filter) => (
        <div className="admin-toolbar__filter" key={filter.label}>
          {filter.label}
          <div className="admin-filter-btn">
            <span>{filter.value || 'All'}</span>
            <Icon name="chevron-down" size={14} />
          </div>
          <select
            aria-label={`Filter by ${filter.label.toLowerCase()}`}
            value={filter.value}
            onChange={(event) => filter.onChange(event.target.value)}
          >
            <option value="">All {filter.label}</option>
            {filter.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      ))}
      {children && <div className="admin-toolbar__actions">{children}</div>}
    </div>
  )
}

export function ToolbarButton({
  icon = 'plus',
  children,
  onClick,
  variant = 'outline',
}: {
  icon?: Parameters<typeof Icon>[0]['name']
  children: ReactNode
  onClick?: () => void
  variant?: 'outline' | 'primary'
}) {
  return (
    <Button size="sm" variant={variant} icon={icon} onClick={onClick}>
      {children}
    </Button>
  )
}