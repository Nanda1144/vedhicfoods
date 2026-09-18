import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { DEFAULT_PRODUCT_FILTERS, type ProductFilters, type ProductSortKey } from '@/types'
import { productService } from '@/services/productService'
import { useAsync, useDebounce, useMediaQuery } from '@/hooks'
import { BREAKPOINTS, PRODUCT_GRID_DEFAULT_PAGE_SIZE, SORT_OPTIONS } from '@/constants'
import type { Crumb } from '@/components/common'
import { PageHeader, ProductGridSkeleton, Pagination, EmptyShopState, Icon, IconButton, Drawer } from '@/components/common'
import { FilterPanel, ProductGrid } from '@/components/product'

const serialise = (filters: ProductFilters) =>
  JSON.stringify({
    categories: filters.categories,
    tags: filters.tags,
    minPrice: filters.minPrice,
    maxPrice: filters.maxPrice,
    inStockOnly: filters.inStockOnly,
    organicOnly: filters.organicOnly,
    minRating: filters.minRating,
    sort: filters.sort,
  })

export function ShopPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const categoryParam = searchParams.get('category') ?? ''
  const qParam = searchParams.get('q') ?? ''
  const pageParam = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1)

  const [filters, setFilters] = useState<ProductFilters>(() => ({
    ...DEFAULT_PRODUCT_FILTERS,
    categories: categoryParam ? [categoryParam] : [],
    query: qParam,
  }))
  const debouncedQuery = useDebounce(filters.query, 260)

  useEffect(() => {
    setFilters((current) => ({
      ...current,
      categories: categoryParam ? [categoryParam] : current.categories,
      query: qParam,
    }))
  }, [categoryParam, qParam])

  const isDesktop = useMediaQuery(`(min-width: ${BREAKPOINTS.lg}px)`)
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)

  const signature = serialise({ ...filters, query: debouncedQuery })
  const result = useAsync(
    () =>
      productService.list({ ...filters, query: debouncedQuery }, { page: pageParam, perPage: PRODUCT_GRID_DEFAULT_PAGE_SIZE }),
    [signature, pageParam],
  )

  const updateFilters = (patch: Partial<ProductFilters>) => {
    setFilters((current) => ({ ...current, ...patch }))
    setPage(1)
  }

  const setPage = (page: number) => {
    const params = new URLSearchParams(searchParams)
    if (page > 1) params.set('page', String(page))
    else params.delete('page')
    setSearchParams(params, { replace: true })
  }

  const resetFilters = () => {
    setFilters({ ...DEFAULT_PRODUCT_FILTERS, query: qParam })
    const params = new URLSearchParams()
    if (qParam) params.set('q', qParam)
    setSearchParams(params)
  }

  const tags = useAsync(() => productService.tags(), [])
  const categories = useAsync(() => productService.categories(), [])
  const activeCategory = useMemo(
    () => categories.data?.find((category) => category.slug === categoryParam),
    [categoryParam, categories.data],
  )
  const title = activeCategory ? activeCategory.name : 'The Vedhi shop'
  const description = activeCategory
    ? activeCategory.description
    : 'Freshly made millet laddus, heritage grains and traditional foods — all certified organic.'

  const crumbs = [
    { label: 'Home', href: '/' },
    { label: 'Shop', href: '/shop', current: !activeCategory },
    ...(activeCategory ? [{ label: activeCategory.name, current: true }] : []),
  ]

  const filterPanel = (
    <FilterPanel
      filters={filters}
      categories={categories.data ?? []}
      tags={tags.data ?? []}
      priceBounds={productService.priceBounds()}
      onChange={updateFilters}
      onReset={resetFilters}
    />
  )

  const closeMobileFilters = () => setMobileFiltersOpen(false)

  return (
    <>
      <PageHeader
        eyebrow="Farm to table"
        title={title}
        description={description}
        crumbs={crumbs as Crumb[]}
      />

      <section className="section">
        <div className="container">
          <div className="shop-layout">
            {isDesktop ? (
              <aside className="shop-layout__filters">
                {filterPanel}
              </aside>
            ) : (
              <div className="shop-layout__filters-mobile">
                <IconButton label="Open filters" onClick={() => setMobileFiltersOpen(true)} className="btn btn--outline btn--md">
                  <Icon name="sliders" size={17} /> <span className="btn__label">Filters</span>
                </IconButton>
                <Drawer open={mobileFiltersOpen} onClose={closeMobileFilters} title="Filters" side="right">
                  <FilterPanel
                    filters={filters}
                    categories={categories.data ?? []}
                    tags={tags.data ?? []}
                    priceBounds={productService.priceBounds()}
                    onChange={updateFilters}
                    onReset={resetFilters}
                    onClose={closeMobileFilters}
                  />
                </Drawer>
              </div>
            )}

            <div className="shop-layout__main">
              <div className="shop-toolbar">
                <p className="shop-toolbar__count">
                  {result.loading ? 'Counting products…' : `${result.data?.pagination.total ?? 0} products`}
                </p>
                <label className="shop-toolbar__sort">
                  <span className="visually-hidden">Sort products</span>
                  <Icon name="sort" size={16} />
                  <select
                    className="select__control select--bare"
                    value={filters.sort}
                    onChange={(event) => updateFilters({ sort: event.target.value as ProductSortKey })}
                  >
                    {SORT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {result.loading ? (
                <ProductGridSkeleton count={PRODUCT_GRID_DEFAULT_PAGE_SIZE} />
              ) : result.error ? (
                <EmptyShopState
                  title="We couldn't load this selection"
                  description={result.error.message}
                  reset={resetFilters}
                />
              ) : result.data && result.data.items.length > 0 ? (
                <ProductGrid products={result.data.items} />
              ) : (
                <EmptyShopState
                  title="No products match those filters"
                  description="Try removing a filter or two — the shelves are full of good things."
                  reset={resetFilters}
                  href="/shop"
                />
              )}

              {result.data && (
                <Pagination pagination={result.data.pagination} onPageChange={setPage} />
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  )
}