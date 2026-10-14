import { useEffect, useState } from 'react'
import type { Category, ProductFilters } from '@/types'
import { Checkbox, Select, Switch, Icon, Button } from '../common'
import { formatNumber } from '@/utils/format'
import { RATING_OPTIONS, PRICE_PRESETS } from './filterOptions'

interface FilterPanelProps {
  filters: ProductFilters
  categories: Category[]
  tags: string[]
  priceBounds: { min: number; max: number }
  onChange: (patch: Partial<ProductFilters>) => void
  onReset: () => void
  /** When set, the primary CTA closes the enclosing drawer (mobile). */
  onClose?: () => void
}

export function FilterPanel({ filters, categories, tags, priceBounds, onChange, onReset, onClose }: FilterPanelProps) {
  const [minInput, setMinInput] = useState(filters.minPrice ?? '')
  const [maxInput, setMaxInput] = useState(filters.maxPrice ?? '')
  const activeCount = countActive(filters)
  const presetPrice = PRICE_PRESETS.filter(
    (preset) => preset.min === filters.minPrice && preset.max === filters.maxPrice && preset.min !== null,
  )[0]

  useEffect(() => {
    setMinInput(filters.minPrice ?? '')
    setMaxInput(filters.maxPrice ?? '')
  }, [filters.minPrice, filters.maxPrice])

  const commitPrice = () => {
    const min = minInput === '' ? null : Number(minInput)
    const max = maxInput === '' ? null : Number(maxInput)
    onChange({ minPrice: Number.isFinite(min) ? min : null, maxPrice: Number.isFinite(max) ? max : null })
  }

  return (
    <div className="filter-panel">
      <div className="filter-panel__head">
        <p className="filter-panel__title"><Icon name="sliders" size={16} /> Filters</p>
        {activeCount > 0 && (
          <button type="button" className="link-button" onClick={onReset}>
            Reset ({activeCount})
          </button>
        )}
      </div>

      <fieldset className="filter-group">
        <legend className="filter-group__title">Category</legend>
        <div className="filter-group__list">
          {categories.map((category) => {
            const checked = filters.categories.includes(category.slug)
            return (
              <Checkbox
                key={category.slug}
                label={category.name}
                checked={checked}
                onChange={() => {
                  const next = checked
                    ? filters.categories.filter((slug) => slug !== category.slug)
                    : [...filters.categories, category.slug]
                  onChange({ categories: next })
                }}
              />
            )
          })}
        </div>
      </fieldset>

      <fieldset className="filter-group">
        <legend className="filter-group__title">Price</legend>
        <div className="filter-group__presets">
          {PRICE_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className={presetPrice?.label === preset.label ? 'chip is-active' : 'chip'}
              onClick={() => {
                setMinInput(preset.min ?? '')
                setMaxInput(preset.max ?? '')
                onChange({ minPrice: preset.min, maxPrice: preset.max })
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="filter-group__range">
          <input
            type="number"
            className="input__control input--bare"
            placeholder={`${formatNumber(priceBounds.min)}`}
            value={minInput}
            aria-label="Minimum price"
            onChange={(event) => setMinInput(event.target.value)}
            onBlur={commitPrice}
          />
          <span aria-hidden="true">—</span>
          <input
            type="number"
            className="input__control input--bare"
            placeholder={`${formatNumber(priceBounds.max)}`}
            value={maxInput}
            aria-label="Maximum price"
            onChange={(event) => setMaxInput(event.target.value)}
            onBlur={commitPrice}
          />
        </div>
      </fieldset>

      <fieldset className="filter-group">
        <legend className="filter-group__title">Rating</legend>
        <Select
          aria-label="Minimum rating"
          options={[...RATING_OPTIONS]}
          value={filters.minRating === 0 ? '0' : String(filters.minRating)}
          onChange={(event) => onChange({ minRating: Number(event.target.value) })}
        />
      </fieldset>

      <fieldset className="filter-group">
        <legend className="filter-group__title">Requirements</legend>
        <div className="filter-group__switches">
          <Switch
            label="In stock only"
            checked={filters.inStockOnly}
            onCheckedChange={(checked) => onChange({ inStockOnly: checked })}
          />
          <Switch
            label="Certified organic"
            checked={filters.organicOnly}
            onCheckedChange={(checked) => onChange({ organicOnly: checked })}
          />
        </div>
      </fieldset>

      <fieldset className="filter-group">
        <legend className="filter-group__title">Tags</legend>
        <div className="filter-group__presets filter-group__presets--wrap">
          {tags.map((tag) => {
            const checked = filters.tags.includes(tag)
            return (
              <button
                key={tag}
                type="button"
                className={checked ? 'chip is-active' : 'chip'}
                aria-pressed={checked}
                onClick={() => {
                  const next = checked
                    ? filters.tags.filter((value) => value !== tag)
                    : [...filters.tags, tag]
                  onChange({ tags: next })
                }}
              >
                {tag}
              </button>
            )
          })}
        </div>
      </fieldset>

      {onClose && (
        <Button fullWidth variant="primary" iconRight="arrow-right" onClick={onClose}>
          Show matching products
        </Button>
      )}
    </div>
  )
}

function countActive(filters: ProductFilters): number {
  let count = 0
  if (filters.query) count += 1
  count += filters.categories.length
  count += filters.tags.length
  if (filters.minPrice !== null || filters.maxPrice !== null) count += 1
  if (filters.inStockOnly) count += 1
  if (filters.organicOnly) count += 1
  if (filters.minRating > 0) count += 1
  return count
}