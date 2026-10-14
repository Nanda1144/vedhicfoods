import { useMemo, useState, type ReactNode } from 'react'
import { cn } from '@/utils/cn'
import { EmptyState, Skeleton, Icon } from '../common'

export interface Column<T> {
  key: string
  header: ReactNode
  align?: 'left' | 'right' | 'center'
  width?: string
  className?: string
  render: (row: T, index: number) => ReactNode
  /** Provide a sortable scalar to enable header sorting. */
  sortValue?: (row: T) => string | number
}

interface DataTableProps<T> {
  columns: Array<Column<T>>
  rows: T[]
  rowKey: (row: T, index: number) => string
  loading?: boolean
  empty?: ReactNode
  onRowClick?: (row: T) => void
  footer?: ReactNode
  caption?: string
  skeletonRows?: number
  /** Enables checkbox selection. Controlled from the parent. */
  selectable?: boolean
  selected?: string[]
  onSelectionChange?: (selected: string[]) => void
}

type SortState = { key: string; direction: 1 | -1 } | null

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  empty,
  onRowClick,
  footer,
  caption,
  skeletonRows = 6,
  selectable = false,
  selected = [],
  onSelectionChange,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<SortState>(null)

  const sorted = useMemo(() => {
    if (!sort) return rows
    const column = columns.find((c) => c.key === sort.key)
    if (!column?.sortValue) return rows
    return [...rows].sort((a, b) => {
      const av = column.sortValue!(a)
      const bv = column.sortValue!(b)
      if (av < bv) return -1 * sort.direction
      if (av > bv) return 1 * sort.direction
      return 0
    })
  }, [rows, sort, columns])

  const showEmpty = !loading && sorted.length === 0
  const allSelected = rows.length > 0 && selected.length === rows.length

  const toggleSort = (column: Column<T>) => {
    if (!column.sortValue) return
    setSort((current) => {
      if (current?.key !== column.key) return { key: column.key, direction: -1 }
      return current.direction === -1 ? { key: column.key, direction: 1 } : null
    })
  }

  const toggleAll = () => {
    if (!onSelectionChange) return
    onSelectionChange(allSelected ? [] : rows.map(rowKey))
  }

  return (
    <div className="data-table">
      <div className="data-table__scroll">
        <table className="data-table__table">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr>
              {selectable && (
                <th scope="col" style={{ width: 44 }}>
                  <input
                    type="checkbox"
                    className="admin-check"
                    aria-label="Select all rows"
                    checked={allSelected}
                    disabled={rows.length === 0}
                    onChange={toggleAll}
                  />
                </th>
              )}
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  style={column.width ? { width: column.width } : undefined}
                  className={cn(
                    `is-${column.align ?? 'left'}`,
                    column.sortValue && 'is-sortable',
                    column.className,
                  )}
                  onClick={column.sortValue ? () => toggleSort(column) : undefined}
                  aria-sort={
                    sort?.key === column.key
                      ? sort.direction === -1
                        ? 'descending'
                        : 'ascending'
                      : undefined
                  }
                >
                  <span className="data-table__th-inner">
                    {column.header}
                    {column.sortValue && (
                      <Icon
                        name={sort?.key === column.key ? (sort.direction === -1 ? 'arrow-down' : 'arrow-up') : 'sort'}
                        size={13}
                      />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: skeletonRows }).map((_, rowIndex) => (
                <tr key={`skeleton-${rowIndex}`}>
                  {selectable && (
                    <td>
                      <Skeleton style={{ width: 16, height: 16 }} />
                    </td>
                  )}
                  {columns.map((column) => (
                    <td key={column.key} className={cn(`is-${column.align ?? 'left'}`)}>
                      <Skeleton style={{ width: '72%', height: 14 }} />
                    </td>
                  ))}
                </tr>
              ))}

            {!loading &&
              sorted.map((row, index) => (
                <tr
                  key={rowKey(row, index)}
                  className={cn(onRowClick && 'is-clickable', selected.includes(rowKey(row, index)) && 'is-selected')}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {selectable && (
                    <td>
                      <input
                        type="checkbox"
                        className="admin-check"
                        aria-label={`Select ${rowKey(row, index)}`}
                        checked={selected.includes(rowKey(row, index))}
                        onChange={(event) => {
                          if (!onSelectionChange) return
                          const key = rowKey(row, index)
                          onSelectionChange(
                            event.target.checked ? [...selected, key] : selected.filter((k) => k !== key),
                          )
                        }}
                        onClick={(event) => event.stopPropagation()}
                      />
                    </td>
                  )}
                  {columns.map((column) => (
                    <td key={column.key} className={cn(`is-${column.align ?? 'left'}`, column.className)}>
                      {column.render(row, index)}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {showEmpty && (
        <div className="data-table__empty">
          {empty ?? <EmptyState title="Nothing here yet" description="Records will appear here once they exist." />}
        </div>
      )}

      {footer && <div className="data-table__footer">{footer}</div>}
    </div>
  )
}