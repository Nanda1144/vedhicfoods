import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { productService } from '@/services/productService'
import { useDebounce, useEscapeKey, useFocusFirst, useFocusTrap, useLockBodyScroll } from '@/hooks'
import type { Product } from '@/types'
import { Icon, Spinner, SmartImage, PriceDisplay } from '../common'

interface SearchOverlayProps {
  open: boolean
  onClose: () => void
}

const QUICK_TAGS = ['Ragi', 'Millet', 'Laddu', 'Roti', 'Organic']

export function SearchOverlay({ open, onClose }: SearchOverlayProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Product[]>([])
  const [loading, setLoading] = useState(false)
  const debouncedQuery = useDebounce(query, 220)

  useLockBodyScroll(open)
  useEscapeKey(onClose, open)
  useFocusFirst(panelRef, open)
  useFocusTrap(panelRef, open)

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) {
      setQuery('')
      setResults([])
      return
    }
    if (!debouncedQuery.trim()) {
      setResults([])
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    productService
      .search(debouncedQuery, 6)
      .then((items) => {
        if (!cancelled) setResults(items)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [debouncedQuery, open])

  const go = (path: string) => {
    onClose()
    navigate(path)
  }

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div className="search-overlay" role="presentation">
      <div className="search-overlay__scrim" aria-hidden="true" onMouseDown={onClose} />
      <div
        ref={panelRef}
        className="search-overlay__panel"
        role="dialog"
        aria-modal="true"
        aria-label="Search products"
      >
        <div className="search-overlay__bar">
          <Icon name="search" size={20} className="search-overlay__lead" />
          <input
            ref={inputRef}
            type="search"
            className="search-overlay__input"
            aria-label="Search products"
            placeholder="Search laddus, ragi, millets, rotis…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {loading ? (
            <Spinner size={18} className="search-overlay__spinner" />
          ) : (
            query && (
              <button
                type="button"
                className="search-overlay__clear"
                aria-label="Clear search"
                onClick={() => setQuery('')}
              >
                <Icon name="close" size={16} />
              </button>
            )
          )}
        </div>

        <div className="search-overlay__body">
          {!query.trim() ? (
            <div className="search-overlay__hint">
              <p className="type-label">Popular right now</p>
              <div className="cluster search-overlay__tags">
                {QUICK_TAGS.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className="chip"
                    onClick={() => setQuery(tag)}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          ) : loading ? (
            <p className="search-overlay__status">Searching…</p>
          ) : results.length === 0 ? (
            <p className="search-overlay__status">
              No results for “{query}”. Try <button type="button" className="link-button" onClick={() => go('/shop')}>browsing the shop</button>.
            </p>
          ) : (
            <ul className="search-overlay__results">
              {results.map((product) => (
                <li key={product.id}>
                  <button
                    type="button"
                    className="search-result"
                    onClick={() => go(`/product/${product.slug}`)}
                  >
                    <SmartImage src={product.images[0] ?? ''} alt="" aspect="square" ratio="4 / 5" className="search-result__thumb" seed={product.slug} />
                    <span className="search-result__copy">
                      <span className="search-result__name">{product.name}</span>
                      <span className="search-result__meta">{product.unit}</span>
                    </span>
                    <PriceDisplay price={product.price} mrp={product.mrp} size="sm" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="search-overlay__footer">
          <button type="button" className="link-button" onClick={() => go(`/shop?q=${encodeURIComponent(query)}`)}>
            View all results in shop
          </button>
          <span className="type-caption">Press ESC to close</span>
        </footer>
      </div>
    </div>,
    document.body,
  )
}