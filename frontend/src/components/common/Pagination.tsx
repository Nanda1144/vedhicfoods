import { cn } from '@/utils/cn'
import { Icon } from './Icon'
import type { Pagination } from '@/types'

interface PaginationProps {
  pagination: Pagination
  onPageChange: (page: number) => void
  /** Render nothing when there is only one page. */
  autoHide?: boolean
  className?: string
}

function pageWindow(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: (number | '…')[] = [1]
  const start = Math.max(2, current - 1)
  const end = Math.min(total - 1, current + 1)
  if (start > 2) pages.push('…')
  for (let i = start; i <= end; i += 1) pages.push(i)
  if (end < total - 1) pages.push('…')
  pages.push(total)
  return pages
}

export function Pagination({
  pagination,
  onPageChange,
  autoHide = true,
  className,
}: PaginationProps) {
  const { page, totalPages } = pagination
  if (autoHide && totalPages <= 1) return null

  return (
    <nav className={cn('pagination', className)} aria-label="Pagination">
      <button
        type="button"
        className="pagination__btn pagination__btn--nav"
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        aria-label="Previous page"
      >
        <Icon name="chevron-left" size={18} />
      </button>
      <ol className="pagination__list">
        {pageWindow(page, totalPages).map((item, index) =>
          item === '…' ? (
            <li key={`gap-${index}`} className="pagination__gap" aria-hidden="true">
              …
            </li>
          ) : (
            <li key={item}>
              <button
                type="button"
                className={cn('pagination__btn', item === page && 'is-active')}
                onClick={() => onPageChange(item)}
                aria-current={item === page ? 'page' : undefined}
                aria-label={`Page ${item}`}
              >
                {item}
              </button>
            </li>
          ),
        )}
      </ol>
      <button
        type="button"
        className="pagination__btn pagination__btn--nav"
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        aria-label="Next page"
      >
        <Icon name="chevron-right" size={18} />
      </button>
    </nav>
  )
}