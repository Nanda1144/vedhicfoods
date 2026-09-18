import { Icon } from '../common'
import { cn } from '@/utils/cn'

interface PaginationBarProps {
  page: number
  pageCount: number
  total: number
  pageSize: number
  onPageChange: (page: number) => void
}

export function PaginationBar({ page, pageCount, total, pageSize, onPageChange }: PaginationBarProps) {
  if (pageCount <= 1) {
    return (
      <div className="pagination-bar">
        <p className="pagination-bar__info">{total} record{total === 1 ? '' : 's'}</p>
      </div>
    )
  }

  const from = (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)
  const pages = Array.from({ length: pageCount }, (_, index) => index + 1)

  return (
    <div className="pagination-bar">
      <p className="pagination-bar__info">
        Showing {from}–{to} of {total}
      </p>
      <div className="pagination-bar__controls">
        <button
          type="button"
          className="icon-btn"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <Icon name="chevron-left" size={17} />
        </button>
        {pages.map((pageNumber) => (
          <button
            key={pageNumber}
            type="button"
            className={cn('pagination-bar__page', pageNumber === page && 'is-active')}
            aria-current={pageNumber === page ? 'page' : undefined}
            onClick={() => onPageChange(pageNumber)}
          >
            {pageNumber}
          </button>
        ))}
        <button
          type="button"
          className="icon-btn"
          aria-label="Next page"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
        >
          <Icon name="chevron-right" size={17} />
        </button>
      </div>
    </div>
  )
}